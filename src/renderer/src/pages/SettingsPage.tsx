import { useEffect, useState } from 'react'
import type { Settings, AnalysisPreset, EvalPerspective } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

export default function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [lichessUsername, setLichessUsername] = useState('')
  const [chesscomUsername, setChesscomUsername] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    window.api.settings
      .get()
      .then((s) => {
        setSettings(s)
        setLichessUsername(s.lichessUsername ?? '')
        setChesscomUsername(s.chesscomUsername ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(t)
  }, [message])

  const save = async (patch: Partial<Settings>) => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await window.api.settings.set(patch)
      setSettings(updated)
      setLichessUsername(updated.lichessUsername ?? '')
      setChesscomUsername(updated.chesscomUsername ?? '')
      setMessage({ type: 'success', text: 'Settings saved.' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save settings.'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleReanalyzeAll = async () => {
    if (!confirm('Re-analyze all games? This will re-run engine analysis on every imported game.'))
      return
    setSaving(true)
    try {
      const { queued } = await window.api.settings.reanalyzeAll()
      setMessage({ type: 'success', text: `Queued ${queued} game(s) for analysis.` })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to queue re-analysis.'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    try {
      const result = await window.api.settings.exportDatabase()
      if (result.exported && result.path) {
        setMessage({ type: 'success', text: `Database exported to ${result.path}` })
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Export failed.'
      })
    }
  }

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    try {
      await window.api.settings.clearDatabase()
      setConfirmClear(false)
      setMessage({ type: 'success', text: 'Database cleared.' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to clear database.'
      })
    }
  }

  if (loading) {
    return <div className="p-10 text-sm text-zinc-500">Loading settings…</div>
  }

  return (
    <div className="max-w-2xl px-10 py-8">
      <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Configure your usernames, engine, analysis preferences, and data actions.
      </p>

      {message && (
        <div
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/20 bg-red-500/10 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-8 space-y-8">
        <Field label="Lichess Username" hint="Used to auto-detect your color when importing games.">
          <input
            type="text"
            value={lichessUsername}
            onChange={(e) => setLichessUsername(e.target.value)}
            onBlur={(e) => save({ lichessUsername: e.target.value.trim() })}
            placeholder="e.g. DrNykterstein"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </Field>

        <Field label="Chess.com Username" hint="Used to auto-detect your color when importing games.">
          <input
            type="text"
            value={chesscomUsername}
            onChange={(e) => setChesscomUsername(e.target.value)}
            onBlur={(e) => save({ chesscomUsername: e.target.value.trim() })}
            placeholder="e.g. MagnusCarlsen"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </Field>

        <Field label="Engine Binary Path" hint="Path to native Stockfish. Leave empty for bundled WASM.">
          <input
            type="text"
            value={settings.engineBinaryPath ?? ''}
            onChange={(e) =>
              setSettings((s) => ({ ...s, engineBinaryPath: e.target.value || null }))
            }
            onBlur={(e) => save({ engineBinaryPath: e.target.value || null })}
            placeholder="/usr/local/bin/stockfish"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </Field>

        <Field label="Analysis Preset" hint="Fast ≈ 150 ms, Balanced ≈ 400 ms, Deep ≈ 1 200 ms per position.">
          <div className="mt-2 flex gap-2">
            {(['fast', 'balanced', 'deep'] as AnalysisPreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => save({ analysisPreset: preset })}
                className={`rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  settings.analysisPreset === preset
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Eval Perspective" hint="Show evaluations from your perspective or always from White.">
          <div className="mt-2 flex gap-2">
            {(
              [
                { value: 'user' as EvalPerspective, label: 'My perspective' },
                { value: 'white' as EvalPerspective, label: 'White always' }
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => save({ evalPerspective: value })}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  settings.evalPerspective === value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Severity Thresholds" hint="Centipawns for inaccuracy / mistake / blunder tiers (display + flagging).">
          <div className="mt-2 grid grid-cols-3 gap-3">
            <ThresholdInput
              label="Inaccuracy"
              value={settings.inaccuracyThresholdCp}
              onChange={(v) => setSettings((s) => ({ ...s, inaccuracyThresholdCp: v }))}
              onBlur={(v) => save({ inaccuracyThresholdCp: v })}
            />
            <ThresholdInput
              label="Mistake"
              value={settings.mistakeThresholdCp}
              onChange={(v) => setSettings((s) => ({ ...s, mistakeThresholdCp: v }))}
              onBlur={(v) => save({ mistakeThresholdCp: v })}
            />
            <ThresholdInput
              label="Blunder"
              value={settings.blunderThresholdCp}
              onChange={(v) => setSettings((s) => ({ ...s, blunderThresholdCp: v }))}
              onBlur={(v) => save({ blunderThresholdCp: v })}
            />
          </div>
        </Field>

        <div className="border-t border-zinc-800 pt-8">
          <h3 className="text-sm font-medium text-zinc-300">Data Actions</h3>
          <p className="mt-1 text-xs text-zinc-500">Manage your local database.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={handleReanalyzeAll}
              disabled={saving}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              Re-analyze All Games
            </button>
            <button
              onClick={handleExport}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
            >
              Export Database
            </button>
            <button
              onClick={handleClear}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                confirmClear
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-zinc-800 text-red-400 hover:bg-zinc-700'
              }`}
            >
              {confirmClear ? 'Confirm Clear Database' : 'Clear Database'}
            </button>
            {confirmClear && (
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded-md px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {saving && <p className="mt-6 text-xs text-zinc-500">Saving…</p>}
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300">{label}</label>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
      {children}
    </div>
  )
}

function ThresholdInput({
  label,
  value,
  onChange,
  onBlur
}: {
  label: string
  value: number
  onChange: (v: number) => void
  onBlur: (v: number) => void
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500">{label}</label>
      <input
        type="number"
        min={20}
        max={500}
        step={10}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || value)}
        onBlur={(e) => onBlur(parseInt(e.target.value) || value)}
        className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
      <span className="text-[10px] text-zinc-600">{(value / 100).toFixed(1)} pawns</span>
    </div>
  )
}
