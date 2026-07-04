import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GameListItem, AnalysisProgressEvent, ClampKLabel } from '@shared/types'
import { LABEL_DISPLAY } from '../components/ClampKBadge'

interface ProgressState {
  event: AnalysisProgressEvent
  startedAt: number
  gamesTotal: number
  gamesCompleted: number
}

export default function DashboardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [games, setGames] = useState<GameListItem[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [commonLabel, setCommonLabel] = useState<ClampKLabel | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [progressState, setProgressState] = useState<ProgressState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const analysisStartTime = useRef<number>(0)
  const analysisGameCount = useRef<number>(0)
  const gamesCompleted = useRef<number>(0)

  const loadData = useCallback(async () => {
    try {
      const [g, due] = await Promise.all([
        window.api.games.list(),
        window.api.flashcards.getDueCount()
      ])
      setGames(g)
      setDueCount(due)
      try {
        const analytics = await window.api.analytics.query()
        if (analytics.labelBreakdown.length > 0) {
          setCommonLabel(analytics.labelBreakdown[0].label)
        }
      } catch {
        /* analytics might not be implemented yet */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const unsub1 = window.api.analysis.onProgress((e) => {
      setProgressState((prev) => ({
        event: e,
        startedAt: prev?.startedAt ?? analysisStartTime.current,
        gamesTotal: prev?.gamesTotal ?? analysisGameCount.current,
        gamesCompleted: gamesCompleted.current
      }))
    })
    const unsub2 = window.api.analysis.onComplete(() => {
      gamesCompleted.current++
      setProgressState((prev) =>
        prev ? { ...prev, gamesCompleted: gamesCompleted.current } : null
      )
      if (gamesCompleted.current >= analysisGameCount.current) {
        setAnalyzing(false)
        setProgressState(null)
        gamesCompleted.current = 0
        loadData()
      }
    })
    const unsub3 = window.api.analysis.onError((e) => {
      setError(`Analysis error (game #${e.gameId}): ${e.message}`)
      gamesCompleted.current++
      if (gamesCompleted.current >= analysisGameCount.current) {
        setAnalyzing(false)
        setProgressState(null)
        gamesCompleted.current = 0
        loadData()
      }
    })
    return () => {
      unsub1()
      unsub2()
      unsub3()
    }
  }, [loadData])

  const pendingGames = games.filter(
    (g) => g.analysisStatus === 'pending' || g.analysisStatus === 'queued'
  )
  const analyzingGames = games.filter((g) => g.analysisStatus === 'analyzing')
  const analyzedCount = games.filter((g) => g.analysisStatus === 'analyzed').length

  const handleAnalyze = async () => {
    const ids = pendingGames.map((g) => g.id)
    if (!ids.length) return
    setAnalyzing(true)
    setError(null)
    analysisStartTime.current = Date.now()
    analysisGameCount.current = ids.length
    gamesCompleted.current = 0
    try {
      await window.api.analysis.start({ gameIds: ids })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis.')
      setAnalyzing(false)
    }
  }

  const nextStep = dueCount > 0
    ? { label: 'Review due flashcards', action: () => navigate('/flashcards'), detail: `${dueCount} card(s) waiting` }
    : pendingGames.length > 0
      ? { label: 'Analyze pending games', action: handleAnalyze, detail: `${pendingGames.length} game(s) need analysis` }
      : games.length === 0
        ? { label: 'Import your first games', action: () => navigate('/import'), detail: 'Get started with PGN import' }
        : null

  if (loading) return <div className="p-10 text-sm text-zinc-500">Loading…</div>

  if (games.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 py-20 text-center">
        <h2 className="text-xl font-semibold text-zinc-100">Welcome to BlunderCheck</h2>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Import your games, analyze them with Stockfish, and drill your mistakes with spaced
          repetition flashcards.
        </p>
        <button
          onClick={() => navigate('/import')}
          className="mt-6 rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Import Games
        </button>
      </div>
    )
  }

  return (
    <div className="px-10 py-8">
      <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-1 text-sm text-zinc-400">Your chess improvement at a glance.</p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Recommended next step */}
      {nextStep && (
        <div className="mt-6 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-500/80">
            Recommended Next Step
          </p>
          <div className="mt-2 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-zinc-100">{nextStep.label}</p>
              <p className="text-sm text-zinc-400">{nextStep.detail}</p>
            </div>
            <button
              onClick={nextStep.action}
              className="shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Go →
            </button>
          </div>
        </div>
      )}

      {/* Analysis status */}
      {(pendingGames.length > 0 || analyzingGames.length > 0) && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
          <span className="text-zinc-300">Analysis status: </span>
          {analyzingGames.length > 0 && (
            <span>{analyzingGames.length} analyzing · </span>
          )}
          {pendingGames.length > 0 && <span>{pendingGames.length} pending</span>}
          {analyzedCount > 0 && <span> · {analyzedCount} analyzed</span>}
        </div>
      )}

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <StatCard label="Total Games" value={games.length} />
        <StatCard label="Analyzed" value={analyzedCount} />
        <StatCard label="Review Due" value={dueCount} />
        <StatCard
          label="Top Mistake Pattern"
          value={commonLabel ? LABEL_DISPLAY[commonLabel] : '—'}
          small
        />
      </div>

      {/* Quick actions */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={handleAnalyze}
          disabled={analyzing || pendingGames.length === 0}
          className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {analyzing
            ? 'Analyzing…'
            : `Analyze Recent (${pendingGames.length})`}
        </button>
        <button
          onClick={() => navigate('/flashcards')}
          disabled={dueCount === 0}
          className="rounded-md bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          Review Due Cards ({dueCount})
        </button>
        <button
          onClick={() => navigate('/import')}
          className="rounded-md bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
        >
          Import Games
        </button>
      </div>

      {/* Analysis progress */}
      {progressState && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-300">
              Analyzing game {progressState.gamesCompleted + 1} of {progressState.gamesTotal}
            </span>
            <span className="text-zinc-500">
              {progressState.event.positionsAnalyzed}/{progressState.event.totalPositions} moves
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{
                width: `${(progressState.event.positionsAnalyzed / Math.max(1, progressState.event.totalPositions)) * 100}%`
              }}
            />
          </div>
          {progressState.gamesTotal > 1 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-700 transition-all"
                style={{
                  width: `${((progressState.gamesCompleted + progressState.event.positionsAnalyzed / Math.max(1, progressState.event.totalPositions)) / progressState.gamesTotal) * 100}%`
                }}
              />
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {progressState.gamesTotal > 1
                ? `Overall: ${progressState.gamesCompleted}/${progressState.gamesTotal} games complete`
                : `Position ${progressState.event.positionsAnalyzed} of ${progressState.event.totalPositions}`}
            </span>
            <EtaDisplay
              startedAt={progressState.startedAt}
              batchProgress={
                (progressState.gamesCompleted + progressState.event.positionsAnalyzed / Math.max(1, progressState.event.totalPositions)) / progressState.gamesTotal
              }
            />
          </div>
        </div>
      )}

      {/* Recent games summary */}
      {games.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
            Recent Games
          </h3>
          <div className="space-y-1.5">
            {games.slice(0, 5).map((game) => (
              <button
                key={game.id}
                onClick={() => navigate(`/review/${game.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-4 py-2.5 text-left text-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <span className="min-w-0 flex-1 truncate text-zinc-200">
                  {game.white ?? '?'} vs {game.black ?? '?'}
                </span>
                <span className="text-xs text-zinc-500">{game.date ?? '—'}</span>
                <span className="text-xs text-zinc-500">{game.result ?? '*'}</span>
                {game.analysisStatus === 'analyzed' && game.blunderCount > 0 && (
                  <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-400">
                    {game.blunderCount}
                  </span>
                )}
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] capitalize ${
                    game.analysisStatus === 'analyzed'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {game.analysisStatus}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  small
}: {
  label: string
  value: number | string
  small?: boolean
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p
        className={`mt-1.5 font-semibold text-zinc-100 ${small ? 'text-base' : 'text-2xl'}`}
      >
        {value}
      </p>
    </div>
  )
}

function EtaDisplay({ startedAt, batchProgress }: { startedAt: number; batchProgress: number }) {
  if (batchProgress <= 0.01) return <span>Estimating…</span>
  const elapsed = Date.now() - startedAt
  const estimatedTotal = elapsed / batchProgress
  const remaining = Math.max(0, estimatedTotal - elapsed)
  const secs = Math.round(remaining / 1000)
  if (secs < 60) return <span>~{secs}s remaining</span>
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  return <span>~{mins}m {remSecs}s remaining</span>
}
