import { useCallback, useState } from 'react'
import type { ParsedPgnGame, Color, ImportGameInput, ImportResult, ParseFailure } from '@shared/types'

interface ParsedGameRow extends ParsedPgnGame {
  userColor: Color | null
  selected: boolean
}

interface ImportSummary {
  gamesFound: number
  imported: number
  duplicatesSkipped: number
  parseFailures: ParseFailure[]
}

export default function ImportPage(): React.JSX.Element {
  const [pgnText, setPgnText] = useState('')
  const [parsedGames, setParsedGames] = useState<ParsedGameRow[]>([])
  const [parseFailures, setParseFailures] = useState<ParseFailure[]>([])
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const addParsed = (games: ParsedPgnGame[], failures: ParseFailure[] = []) => {
    setParsedGames((prev) => [
      ...prev,
      ...games.map((g) => ({ ...g, userColor: g.detectedUserColor, selected: true }))
    ])
    if (failures.length) {
      setParseFailures((prev) => [...prev, ...failures])
    }
    setImportSummary(null)
  }

  const handleParse = async () => {
    if (!pgnText.trim()) return
    setParsing(true)
    setError(null)
    try {
      const result = await window.api.games.parsePgn(pgnText)
      addParsed(result.games, result.parseFailures)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse PGN.')
    } finally {
      setParsing(false)
    }
  }

  const parseFiles = async (files: File[]) => {
    setParsing(true)
    setError(null)
    try {
      const paths = files
        .map((f) => (f as unknown as { path?: string }).path)
        .filter((p): p is string => !!p)
      if (paths.length) {
        const result = await window.api.games.parsePgnFiles(paths)
        addParsed(result.games, result.parseFailures)
      } else {
        const texts = await Promise.all(files.map((f) => f.text()))
        for (const text of texts) {
          const result = await window.api.games.parsePgn(text)
          addParsed(result.games, result.parseFailures)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse files.')
    } finally {
      setParsing(false)
    }
  }

  const handleFileOpen = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pgn'
    input.multiple = true
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      if (!files.length) return
      await parseFiles(files)
    }
    input.click()
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith('.pgn')
    )
    if (!files.length) {
      setError('Drop .pgn files only.')
      return
    }
    await parseFiles(files)
  }, [])

  const handleImport = async () => {
    const toImport = parsedGames.filter((g) => g.selected)
    if (!toImport.length) return
    setImporting(true)
    setError(null)
    try {
      const inputs: ImportGameInput[] = toImport.map((g) => ({
        pgn: g.pgn,
        source: 'import',
        userColor: g.userColor
      }))
      const result: ImportResult = await window.api.games.import(inputs)
      setImportSummary({
        gamesFound: toImport.length + parseFailures.length,
        imported: result.imported.length,
        duplicatesSkipped: result.duplicatesSkipped,
        parseFailures: [...parseFailures, ...result.parseFailures]
      })
      setParsedGames([])
      setParseFailures([])
      setPgnText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import games.')
    } finally {
      setImporting(false)
    }
  }

  const toggleGame = (idx: number) =>
    setParsedGames((prev) => prev.map((g, i) => (i === idx ? { ...g, selected: !g.selected } : g)))

  const setUserColor = (idx: number, color: Color | null) =>
    setParsedGames((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, userColor: color } : g))
    )

  const selectedCount = parsedGames.filter((g) => g.selected).length

  return (
    <div className="px-10 py-8">
      <h2 className="text-xl font-semibold tracking-tight">Import Games</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Paste PGN text, open files, or drag .pgn files here. Multi-game PGNs are split automatically.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {importSummary && (
        <div className="mt-4 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <p className="font-medium">Import complete</p>
          <ul className="mt-2 space-y-1 text-emerald-400/90">
            <li>Games found: {importSummary.gamesFound}</li>
            <li>Imported: {importSummary.imported}</li>
            <li>Duplicates skipped: {importSummary.duplicatesSkipped}</li>
            <li>Parse failures: {importSummary.parseFailures.length}</li>
          </ul>
          {importSummary.parseFailures.length > 0 && (
            <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-amber-400/90">
              {importSummary.parseFailures.map((f, i) => (
                <li key={i}>
                  Game #{f.index + 1}: {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {parseFailures.length > 0 && parsedGames.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          {parseFailures.length} game(s) could not be parsed during preview.
        </div>
      )}

      <div
        className={`mt-6 space-y-4 rounded-lg border-2 border-dashed p-1 transition-colors ${
          dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'border-transparent'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <textarea
          value={pgnText}
          onChange={(e) => setPgnText(e.target.value)}
          placeholder={
            'Paste PGN here or drop .pgn files…\n\n[Event "Casual Game"]\n[White "Player1"]\n[Black "Player2"]\n\n1. e4 e5 2. Nf3 Nc6 *'
          }
          rows={8}
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
        />
        <div className="flex gap-3 px-1 pb-1">
          <button
            onClick={handleParse}
            disabled={parsing || !pgnText.trim()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {parsing ? 'Parsing…' : 'Parse PGN'}
          </button>
          <button
            onClick={handleFileOpen}
            disabled={parsing}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            Open .pgn File(s)
          </button>
          {parsedGames.length > 0 && (
            <button
              onClick={() => {
                setParsedGames([])
                setParseFailures([])
                setImportSummary(null)
              }}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-700"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {parsedGames.length > 0 && (
        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-medium">Parsed Games ({parsedGames.length})</h3>
            <button
              onClick={handleImport}
              disabled={importing || selectedCount === 0}
              className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing
                ? 'Importing…'
                : `Import ${selectedCount} Game${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <th className="w-10 px-4 py-3" />
                  <th className="px-4 py-3">White</th>
                  <th className="px-4 py-3">Black</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Opening</th>
                  <th className="px-4 py-3">Moves</th>
                  <th className="px-4 py-3">I Played</th>
                </tr>
              </thead>
              <tbody>
                {parsedGames.map((game, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-zinc-800/50 transition-opacity ${game.selected ? '' : 'opacity-40'}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={game.selected}
                        onChange={() => toggleGame(idx)}
                        className="accent-emerald-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-zinc-100">{game.white ?? '?'}</td>
                    <td className="px-4 py-3 text-zinc-100">{game.black ?? '?'}</td>
                    <td className="px-4 py-3 text-zinc-300">{game.result ?? '*'}</td>
                    <td className="px-4 py-3 text-zinc-400">{game.date ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{game.openingName ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{game.moveCount}</td>
                    <td className="px-4 py-3">
                      <select
                        value={game.userColor ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          setUserColor(idx, v === 'white' || v === 'black' ? v : null)
                        }}
                        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="">Unknown</option>
                        <option value="white">White</option>
                        <option value="black">Black</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
