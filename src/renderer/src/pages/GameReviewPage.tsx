import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  Game,
  AnalyzedPosition,
  ConfirmedLabels,
  CreateFlashcardInput,
  Settings,
  SeverityTier
} from '@shared/types'
import { ClampKLabel, DEFAULT_SETTINGS } from '@shared/types'
import ChessBoard from '../components/ChessBoard'
import MoveList from '../components/MoveList'
import EvalGraph from '../components/EvalGraph'
import type { EvalDataPoint } from '../components/EvalGraph'
import ClampKBadge, { LABEL_DISPLAY } from '../components/ClampKBadge'
import ClampKEditor from '../components/ClampKEditor'
import {
  replayPgn,
  clampEval,
  formatEval,
  fenTurnColor,
  fenIsCheck,
  toPovEval,
  resolveEvalPov,
  formatMainLine
} from '../lib/chess-utils'
import {
  getSeverityTier,
  severityBadgeClass,
  severityBorderClass,
  severityLabel
} from '../lib/severity'
import type { Config } from 'chessground/config'
import type { Key } from 'chessground/types'

export default function GameReviewPage(): React.JSX.Element {
  const { gameId } = useParams()
  const navigate = useNavigate()

  const [game, setGame] = useState<Game | null>(null)
  const [positions, setPositions] = useState<AnalyzedPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPly, setCurrentPly] = useState(0)
  const [takeaway, setTakeaway] = useState('')
  const [takeawayDirty, setTakeawayDirty] = useState(false)
  const [savingTakeaway, setSavingTakeaway] = useState(false)
  const [cardSaving, setCardSaving] = useState<number | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [cardsCreated, setCardsCreated] = useState(0)

  useEffect(() => {
    window.api.settings.get().then(setSettings).catch(() => {})
  }, [])

  const replay = useMemo(
    () => (game ? replayPgn(game.pgn) : { moves: [], fens: ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'] }),
    [game]
  )

  const loadGame = useCallback(async (id: number) => {
    setLoading(true)
    setError(null)
    try {
      const g = await window.api.games.get(id)
      if (!g) {
        setError('Game not found.')
        setLoading(false)
        return
      }
      setGame(g)
      setTakeaway(g.takeaway ?? '')
      try {
        const pos = await window.api.analysis.getPositions(g.id)
        setPositions(pos)
        setCardsCreated(pos.filter((p) => p.savedAsCard).length)
      } catch {
        /* analysis may not be ready */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!gameId) return
    const id = parseInt(gameId)
    if (!isNaN(id)) loadGame(id)
  }, [gameId, loadGame])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowLeft') setCurrentPly((p) => Math.max(0, p - 1))
      else if (e.key === 'ArrowRight')
        setCurrentPly((p) => Math.min(replay.moves.length, p + 1))
      else if (e.key === 'Home') setCurrentPly(0)
      else if (e.key === 'End') setCurrentPly(replay.moves.length)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [replay.moves.length])

  useEffect(() => {
    if (!notification) return
    const t = setTimeout(() => setNotification(null), 3000)
    return () => clearTimeout(t)
  }, [notification])

  // Derived data
  const currentFen = replay.fens[currentPly] ?? replay.fens[0]
  const lastMove =
    currentPly > 0
      ? [replay.moves[currentPly - 1].from, replay.moves[currentPly - 1].to]
      : undefined

  const blunders = useMemo(() => positions.filter((p) => p.isBlunder), [positions])
  const missedPunishments = useMemo(
    () => positions.filter((p) => p.isMissedPunishment),
    [positions]
  )
  const criticalPositions = useMemo(() => positions.filter((p) => p.isCritical), [positions])

  const positionToPly = useCallback(
    (pos: AnalyzedPosition) => (pos.moveNumber - 1) * 2 + (pos.sideToMove === 'white' ? 1 : 2),
    []
  )

  const blunderPlySet = useMemo(() => {
    const set = new Set<number>()
    for (const pos of positions) {
      if (pos.isBlunder || pos.isMissedPunishment) set.add(positionToPly(pos))
    }
    return set
  }, [positions, positionToPly])

  const thresholds = useMemo(
    () => ({
      inaccuracyThresholdCp: settings.inaccuracyThresholdCp,
      mistakeThresholdCp: settings.mistakeThresholdCp,
      blunderThresholdCp: settings.blunderThresholdCp
    }),
    [settings]
  )

  const evalPov = useMemo(
    () => resolveEvalPov(settings.evalPerspective, game?.userColor ?? null),
    [settings.evalPerspective, game?.userColor]
  )
  const povIsUser = settings.evalPerspective === 'user' && !!game?.userColor

  const plySeverity = useMemo(() => {
    const map = new Map<number, SeverityTier>()
    for (const pos of positions) {
      const tier = getSeverityTier(pos.evalLoss, thresholds)
      if (tier) map.set(positionToPly(pos), tier)
    }
    return map
  }, [positions, positionToPly, thresholds])

  const selectedPosition = useMemo(() => {
    if (currentPly === 0) return null
    return positions[currentPly - 1] ?? null
  }, [positions, currentPly])

  const evalAtPly = useMemo(() => {
    if (!positions.length || currentPly === 0) return null
    const pos = positions[currentPly - 1]
    return toPovEval(pos?.evalAfter ?? null, evalPov)
  }, [positions, currentPly, evalPov])

  const evalData: EvalDataPoint[] = useMemo(
    () =>
      positions.map((pos, i) => {
        const povCp = toPovEval(pos.evalAfter, evalPov)
        return {
          ply: i + 1,
          eval: clampEval(povCp),
          evalCp: povCp,
          move: pos.playedMove,
          isBlunder: pos.isBlunder
        }
      }),
    [positions, evalPov]
  )

  const topMistakePattern = useMemo(() => {
    const labels = new Map<ClampKLabel, number>()
    for (const pos of [...blunders, ...missedPunishments]) {
      const primary = pos.confirmedLabels?.primary ?? pos.suggestedLabels[0]?.label
      if (primary) labels.set(primary, (labels.get(primary) ?? 0) + 1)
    }
    const sorted = [...labels.entries()].sort((a, b) => b[1] - a[1])
    return sorted[0]?.[0] ?? null
  }, [blunders, missedPunishments])

  const biggestSwing = useMemo(() => {
    const flagged = [...blunders, ...missedPunishments]
    if (!flagged.length) return null
    return flagged.reduce((best, pos) =>
      (pos.evalLoss ?? 0) > (best.evalLoss ?? 0) ? pos : best
    )
  }, [blunders, missedPunishments])

  const draftTakeaway = useMemo(() => {
    if (!blunders.length && !missedPunishments.length) return 'Clean game — no blunders found!'
    const labels = new Map<ClampKLabel, number>()
    for (const b of [...blunders, ...missedPunishments]) {
      for (const sl of b.suggestedLabels) {
        labels.set(sl.label, (labels.get(sl.label) ?? 0) + 1)
      }
    }
    const sorted = [...labels.entries()].sort((a, b) => b[1] - a[1])
    const top = sorted
      .slice(0, 3)
      .map(([l]) => LABEL_DISPLAY[l])
      .join(', ')
    const total = blunders.length + missedPunishments.length
    return `This game had ${total} flagged position${total > 1 ? 's' : ''}. Key themes: ${top || 'none detected'}. Focus on recognizing these patterns in your games.`
  }, [blunders, missedPunishments])

  const handleSaveTakeaway = async () => {
    if (!game) return
    setSavingTakeaway(true)
    try {
      await window.api.games.saveTakeaway(game.id, takeaway)
      setTakeawayDirty(false)
      setNotification('Takeaway saved.')
    } catch (err) {
      setNotification(err instanceof Error ? err.message : 'Failed to save takeaway.')
    } finally {
      setSavingTakeaway(false)
    }
  }

  const handleConfirmLabels = async (positionId: number, labels: ConfirmedLabels) => {
    try {
      await window.api.analysis.confirmLabels(positionId, labels)
      setPositions((prev) =>
        prev.map((p) => (p.id === positionId ? { ...p, confirmedLabels: labels } : p))
      )
      setNotification('Labels confirmed.')
    } catch (err) {
      setNotification(err instanceof Error ? err.message : 'Failed to confirm labels.')
    }
  }

  const handleSaveCard = async (pos: AnalyzedPosition) => {
    setCardSaving(pos.id)
    try {
      const input: CreateFlashcardInput = { positionId: pos.id }
      await window.api.flashcards.createFromPosition(input)
      setPositions((prev) =>
        prev.map((p) => (p.id === pos.id ? { ...p, savedAsCard: true } : p))
      )
      setCardsCreated((c) => c + 1)
      setNotification('Flashcard created!')
    } catch (err) {
      setNotification(err instanceof Error ? err.message : 'Failed to create flashcard.')
    } finally {
      setCardSaving(null)
    }
  }

  // Board orientation: show from the user's perspective if known
  const orientation = game?.userColor ?? 'white'

  const boardConfig: Config = useMemo(
    () => ({
      fen: currentFen,
      orientation,
      viewOnly: true,
      lastMove: lastMove as Key[] | undefined,
      turnColor: fenTurnColor(currentFen),
      check: fenIsCheck(currentFen) ? fenTurnColor(currentFen) : false,
      coordinates: true,
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 }
    }),
    [currentFen, lastMove, orientation]
  )

  // ---- Render ----

  if (!gameId) {
    return (
      <div className="px-10 py-8">
        <h2 className="text-xl font-semibold tracking-tight">Game Review</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Select a game from the Games page to review it.
        </p>
        <button
          onClick={() => navigate('/games')}
          className="mt-4 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
        >
          Go to Games
        </button>
      </div>
    )
  }

  if (loading) return <div className="p-10 text-sm text-zinc-500">Loading game…</div>
  if (error)
    return (
      <div className="p-10 text-sm text-red-400">
        {error}{' '}
        <button onClick={() => navigate('/games')} className="text-emerald-400 hover:underline">
          Back
        </button>
      </div>
    )
  if (!game) return <div className="p-10 text-sm text-zinc-500">No game data.</div>

  return (
    <div className="px-6 py-6">
      {notification && (
        <div className="mb-4 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
          {notification}
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/games')}
            className="mb-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            ← Back to Games
          </button>
          <h2 className="text-xl font-semibold tracking-tight">
            {game.white ?? '?'} vs {game.black ?? '?'}
          </h2>
          <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-zinc-500">
            {game.date && <span>{game.date}</span>}
            {game.timeControl && <span>{game.timeControl}</span>}
            <span>{game.result ?? '*'}</span>
            {game.openingName && <span>{game.openingName}</span>}
            {game.analyzedAt && game.analysisPreset && (
              <span>
                Analysis: {game.analysisPreset} preset,{' '}
                {new Date(game.analyzedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Game report card */}
      {game.analysisStatus === 'analyzed' && (
        <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <ReportStat label="Result" value={game.result ?? '*'} />
          <ReportStat label="Opening" value={game.openingName ?? 'Unknown'} small />
          <ReportStat
            label="Blunders"
            value={String(blunders.length + missedPunishments.length)}
          />
          <ReportStat
            label="Biggest Swing"
            value={
              biggestSwing
                ? `${biggestSwing.moveNumber}${biggestSwing.sideToMove === 'white' ? '.' : '...'} ${biggestSwing.playedMove}`
                : '—'
            }
            small
          />
          <ReportStat
            label="Top Mistake Pattern"
            value={topMistakePattern ? LABEL_DISPLAY[topMistakePattern] : '—'}
            small
          />
          <ReportStat label="Cards Created" value={String(cardsCreated)} />
        </div>
      )}

      {/* Board + Move List row */}
      <div className="flex gap-4">
        {/* Board + eval bar */}
        <div className="shrink-0">
          <div className="flex gap-2">
            <ChessBoard config={boardConfig} className="h-[400px] w-[400px]" />
            <EvalBar evalCp={evalAtPly} userPerspective={settings.evalPerspective === 'user' && !!game.userColor} />
          </div>
          {/* Nav buttons */}
          <div className="mt-2 flex gap-1.5">
            {(['⏮', '◀', '▶', '⏭'] as const).map((label, i) => {
              const actions = [
                () => setCurrentPly(0),
                () => setCurrentPly((p) => Math.max(0, p - 1)),
                () => setCurrentPly((p) => Math.min(replay.moves.length, p + 1)),
                () => setCurrentPly(replay.moves.length)
              ]
              return (
                <button
                  key={i}
                  onClick={actions[i]}
                  className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  {label}
                </button>
              )
            })}
            <span className="ml-2 self-center text-xs text-zinc-500">
              {currentPly}/{replay.moves.length}
            </span>
          </div>
        </div>

        {/* Move list */}
        <div className="min-w-0 flex-1">
          <MoveList
            moves={replay.moves}
            currentPly={currentPly}
            blunderPlies={blunderPlySet}
            plySeverity={plySeverity}
            onClickPly={setCurrentPly}
          />
        </div>
      </div>

      {/* Eval Graph */}
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-zinc-500">
          Evaluation
        </h3>
        <EvalGraph
          data={evalData}
          currentPly={currentPly}
          onClickPly={setCurrentPly}
          perspectiveNote={
            settings.evalPerspective === 'user' && game.userColor
              ? `Evals shown from your perspective (${game.userColor === 'white' ? 'White' : 'Black'})`
              : "Evals shown from White's perspective"
          }
        />
      </div>

      {/* Selected-move explanation panel */}
      {selectedPosition &&
        (selectedPosition.isBlunder ||
          selectedPosition.isMissedPunishment ||
          getSeverityTier(selectedPosition.evalLoss, thresholds)) && (
          <ExplanationPanel
            pos={selectedPosition}
            evalPov={evalPov}
            povIsUser={povIsUser}
            thresholds={thresholds}
          />
        )}

      {/* OBIT Sections */}
      <div className="mt-8 space-y-8">
        {/* O — Opening */}
        <Section title="Opening">
          {game.openingName ? (
            <p className="text-sm text-zinc-300">{game.openingName}</p>
          ) : (
            <p className="text-sm text-zinc-500">No opening detected.</p>
          )}
          {positions.length > 0 && (() => {
            const firstInaccuracy = positions.find(
              (p) => (p.evalLoss ?? 0) > 50 && p.moveNumber <= 15
            )
            if (!firstInaccuracy) return null
            return (
              <p className="mt-1 text-sm text-amber-400/80">
                First inaccuracy: {firstInaccuracy.moveNumber}
                {firstInaccuracy.sideToMove === 'white' ? '.' : '...'}{' '}
                {firstInaccuracy.playedMove} (best: {firstInaccuracy.bestMove ?? '?'}, −
                {((firstInaccuracy.evalLoss ?? 0) / 100).toFixed(1)} pawns)
              </p>
            )
          })()}
        </Section>

        {/* B — Blunders */}
        <Section title={`Blunders (${blunders.length})`}>
          {blunders.length === 0 ? (
            <p className="text-sm text-zinc-500">No blunders found. Great game!</p>
          ) : (
            <div className="space-y-3">
              {blunders.map((pos) => (
                <BlunderRow
                  key={pos.id}
                  pos={pos}
                  evalPov={evalPov}
                  povIsUser={povIsUser}
                  thresholds={thresholds}
                  onNavigate={() => setCurrentPly(positionToPly(pos))}
                  onConfirmLabels={(labels) => handleConfirmLabels(pos.id, labels)}
                  onSaveCard={() => handleSaveCard(pos)}
                  savingCard={cardSaving === pos.id}
                />
              ))}
            </div>
          )}
          {missedPunishments.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium text-amber-400">
                Missed Punishments ({missedPunishments.length})
              </h4>
              <div className="space-y-3">
                {missedPunishments.map((pos) => (
                  <BlunderRow
                    key={pos.id}
                    pos={pos}
                    missed
                    evalPov={evalPov}
                    povIsUser={povIsUser}
                    thresholds={thresholds}
                    onNavigate={() => setCurrentPly(positionToPly(pos))}
                    onConfirmLabels={(labels) => handleConfirmLabels(pos.id, labels)}
                    onSaveCard={() => handleSaveCard(pos)}
                    savingCard={cardSaving === pos.id}
                  />
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* I — Interesting */}
        <Section title={`Interesting Positions (${criticalPositions.length})`}>
          {criticalPositions.length === 0 ? (
            <p className="text-sm text-zinc-500">No critical positions detected.</p>
          ) : (
            <div className="space-y-2">
              {criticalPositions.slice(0, 4).map((pos) => (
                <div
                  key={pos.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3"
                >
                  <div>
                    <button
                      onClick={() => setCurrentPly(positionToPly(pos))}
                      className="text-sm font-medium text-zinc-200 hover:text-emerald-400"
                    >
                      Move {pos.moveNumber}
                      {pos.sideToMove === 'white' ? '.' : '...'} {pos.playedMove}
                    </button>
                    <p className="text-xs text-zinc-500">
                      Best: {pos.bestMove ?? '?'} · Eval:{' '}
                      {formatEval(toPovEval(pos.evalBefore, evalPov))}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSaveCard(pos)}
                    disabled={pos.savedAsCard || cardSaving === pos.id}
                    className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
                  >
                    {pos.savedAsCard ? 'Saved' : cardSaving === pos.id ? '…' : 'Save as Card'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* T — Takeaway */}
        <Section title="Takeaway">
          {!takeaway && !takeawayDirty && (
            <button
              onClick={() => {
                setTakeaway(draftTakeaway)
                setTakeawayDirty(true)
              }}
              className="mb-2 text-xs text-emerald-400 hover:text-emerald-300"
            >
              Auto-draft from blunder analysis →
            </button>
          )}
          <textarea
            value={takeaway}
            onChange={(e) => {
              setTakeaway(e.target.value)
              setTakeawayDirty(true)
            }}
            placeholder="Write your takeaway from this game…"
            rows={4}
            className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
          {takeawayDirty && (
            <button
              onClick={handleSaveTakeaway}
              disabled={savingTakeaway}
              className="mt-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {savingTakeaway ? 'Saving…' : 'Save Takeaway'}
            </button>
          )}
        </Section>
      </div>
    </div>
  )
}

// ---- Sub-components ----

function ReportStat({
  label,
  value,
  small
}: {
  label: string
  value: string
  small?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 font-medium text-zinc-100 ${small ? 'text-xs leading-snug' : 'text-sm'}`}>
        {value}
      </p>
    </div>
  )
}

function ExplanationPanel({
  pos,
  evalPov,
  povIsUser,
  thresholds
}: {
  pos: AnalyzedPosition
  evalPov: 'white' | 'black'
  povIsUser: boolean
  thresholds: import('@shared/types').SeverityThresholds
}) {
  const tier = getSeverityTier(pos.evalLoss, thresholds)
  const before = toPovEval(pos.evalBefore, evalPov)
  const after = toPovEval(pos.evalAfter, evalPov)
  const topLabel = pos.confirmedLabels?.primary ?? pos.suggestedLabels[0]
  const mainLine = formatMainLine(pos.engineLine, pos.moveNumber, pos.sideToMove)

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 border-l-4 border-l-emerald-600 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-200">
          Move {pos.moveNumber}
          {pos.sideToMove === 'white' ? '.' : '...'} {pos.playedMove}
        </h3>
        {tier && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityBadgeClass(tier)}`}
          >
            {severityLabel(tier)}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-zinc-300">
        {povIsUser ? 'Your position' : 'Eval'}: {formatEval(before)} → {formatEval(after)}
        {pos.evalLoss != null && (
          <span className="text-red-400">
            {' '}
            · Lost {((pos.evalLoss ?? 0) / 100).toFixed(1)} pawns
          </span>
        )}
      </p>
      {pos.bestMove && (
        <p className="mt-1 text-sm text-zinc-400">
          Best move: <span className="font-mono text-emerald-400">{pos.bestMove}</span>
        </p>
      )}
      {mainLine && (
        <p className="mt-1 text-xs text-zinc-500">
          Main line: <span className="font-mono text-zinc-400">{mainLine}</span>
        </p>
      )}
      {topLabel && (
        <p className="mt-2 text-xs text-zinc-500">
          {typeof topLabel === 'object' ? (
            <>
              Label: <ClampKBadge label={topLabel.label} primary />{' '}
              <span className="text-zinc-600">
                ({Math.round(topLabel.confidence * 100)}% confidence)
              </span>
            </>
          ) : (
            <>
              Label: <ClampKBadge label={topLabel} primary />
            </>
          )}
        </p>
      )}
    </div>
  )
}

function EvalBar({
  evalCp,
  userPerspective
}: {
  evalCp: number | null
  userPerspective?: boolean
}) {
  const pawns = clampEval(evalCp, 5)
  const whitePercent = Math.max(3, Math.min(97, 50 + (pawns / 5) * 50))
  const noData = evalCp === null
  return (
    <div className="flex flex-col items-center gap-1">
      {userPerspective && (
        <span className="text-[9px] text-zinc-600 [writing-mode:vertical-rl] rotate-180">
          your POV
        </span>
      )}
      <div className="relative flex h-[400px] w-5 flex-col overflow-hidden rounded-sm">
        <div
          className={`transition-all duration-300 ${noData ? 'bg-zinc-700' : 'bg-zinc-600'}`}
          style={{ height: `${100 - whitePercent}%` }}
        />
        <div
          className={`transition-all duration-300 ${noData ? 'bg-zinc-400' : 'bg-zinc-200'}`}
          style={{ height: `${whitePercent}%` }}
        />
        {noData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-px w-3 bg-zinc-500" />
          </div>
        )}
      </div>
      {!noData && (
        <span className="text-[10px] font-mono text-zinc-500">{formatEval(evalCp)}</span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">{title}</h3>
      {children}
    </div>
  )
}

function BlunderRow({
  pos,
  missed,
  evalPov,
  povIsUser,
  thresholds,
  onNavigate,
  onConfirmLabels,
  onSaveCard,
  savingCard
}: {
  pos: AnalyzedPosition
  missed?: boolean
  evalPov: 'white' | 'black'
  povIsUser: boolean
  thresholds: import('@shared/types').SeverityThresholds
  onNavigate: () => void
  onConfirmLabels: (labels: ConfirmedLabels) => void
  onSaveCard: () => void
  savingCard: boolean
}) {
  const tier = getSeverityTier(pos.evalLoss, thresholds)
  const before = toPovEval(pos.evalBefore, evalPov)
  const after = toPovEval(pos.evalAfter, evalPov)

  return (
    <div
      className={`rounded-lg border border-l-4 border-zinc-800 bg-zinc-900/50 px-4 py-3 ${severityBorderClass(tier, missed)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={onNavigate}
              className="text-sm font-medium text-zinc-200 hover:text-emerald-400"
            >
              {pos.moveNumber}
              {pos.sideToMove === 'white' ? '.' : '...'} {pos.playedMove}
            </button>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityBadgeClass(tier, missed)}`}
            >
              {severityLabel(tier, missed)}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500">
            <span>
              Best: <span className="text-zinc-300">{pos.bestMove ?? '?'}</span>
            </span>
            <span>
              {povIsUser ? 'Your position' : 'Eval'}: {formatEval(before)} → {formatEval(after)}
              {pos.evalLoss != null && (
                <span className="text-red-400">
                  {' '}
                  · Lost {((pos.evalLoss ?? 0) / 100).toFixed(1)} pawns
                </span>
              )}
            </span>
          </div>
          {pos.engineLine.length > 0 && (
            <p className="mt-1 text-xs text-zinc-600">
              Main line: {formatMainLine(pos.engineLine, pos.moveNumber, pos.sideToMove)}
            </p>
          )}
        </div>
        <button
          onClick={onSaveCard}
          disabled={pos.savedAsCard || savingCard}
          className="shrink-0 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
        >
          {pos.savedAsCard ? '✓ Card Saved' : savingCard ? '…' : 'Save as Card'}
        </button>
      </div>
      {/* Labels */}
      <div className="mt-2">
        {pos.confirmedLabels ? (
          <div className="flex gap-1.5 flex-wrap">
            <ClampKBadge label={pos.confirmedLabels.primary} primary />
            {pos.confirmedLabels.secondary.map((l) => (
              <ClampKBadge key={l} label={l} />
            ))}
          </div>
        ) : (
          <ClampKEditor
            suggestedLabels={pos.suggestedLabels}
            confirmedLabels={pos.confirmedLabels}
            onConfirm={onConfirmLabels}
            compact
          />
        )}
      </div>
    </div>
  )
}
