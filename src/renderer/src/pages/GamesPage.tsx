import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GameListItem, GamesListFilter, AnalysisStatus, Color, GameResult } from '@shared/types'

export default function GamesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [games, setGames] = useState<GameListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<GamesListFilter>({})

  useEffect(() => {
    setLoading(true)
    window.api.games
      .list(filters)
      .then((g) => {
        setGames(g)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load games.')
        setLoading(false)
      })
  }, [filters])

  const patchFilter = (patch: Partial<GamesListFilter>) =>
    setFilters((prev) => {
      const next = { ...prev, ...patch }
      for (const key of Object.keys(patch) as (keyof GamesListFilter)[]) {
        if (patch[key] === undefined || patch[key] === '') {
          delete next[key]
        }
      }
      return next
    })

  const analyzed = useMemo(
    () => games.filter((g) => g.analysisStatus === 'analyzed'),
    [games]
  )
  const unanalyzed = useMemo(
    () => games.filter((g) => g.analysisStatus !== 'analyzed'),
    [games]
  )

  if (loading) return <div className="p-10 text-sm text-zinc-500">Loading games…</div>

  return (
    <div className="px-10 py-8">
      <h2 className="text-xl font-semibold tracking-tight">Games</h2>
      <p className="mt-1 text-sm text-zinc-400">All imported games. Click a game to review it.</p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect
          label="Color"
          value={filters.color ?? ''}
          onChange={(v) => patchFilter({ color: (v as Color) || undefined })}
          options={[
            { value: '', label: 'Any' },
            { value: 'white', label: 'White' },
            { value: 'black', label: 'Black' }
          ]}
        />
        <FilterSelect
          label="Result"
          value={filters.result ?? ''}
          onChange={(v) => patchFilter({ result: (v as GameResult) || undefined })}
          options={[
            { value: '', label: 'Any' },
            { value: '1-0', label: '1-0' },
            { value: '0-1', label: '0-1' },
            { value: '1/2-1/2', label: 'Draw' }
          ]}
        />
        <FilterSelect
          label="Analyzed"
          value={
            filters.analyzed === true ? 'yes' : filters.analyzed === false ? 'no' : ''
          }
          onChange={(v) =>
            patchFilter({
              analyzed: v === 'yes' ? true : v === 'no' ? false : undefined
            })
          }
          options={[
            { value: '', label: 'Any' },
            { value: 'yes', label: 'Analyzed' },
            { value: 'no', label: 'Not analyzed' }
          ]}
        />
        <FilterSelect
          label="Blunders"
          value={
            filters.hasBlunders === true
              ? 'yes'
              : filters.hasBlunders === false
                ? 'no'
                : ''
          }
          onChange={(v) =>
            patchFilter({
              hasBlunders: v === 'yes' ? true : v === 'no' ? false : undefined
            })
          }
          options={[
            { value: '', label: 'Any' },
            { value: 'yes', label: 'Has blunders' },
            { value: 'no', label: 'Clean' }
          ]}
        />
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            Search
          </label>
          <input
            type="text"
            value={filters.search ?? ''}
            onChange={(e) => patchFilter({ search: e.target.value || undefined })}
            placeholder="Player, event, opening…"
            className="w-48 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {games.length === 0 ? (
        <div className="mt-8 flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40">
          <div className="text-center">
            <p className="text-sm text-zinc-500">No games match your filters.</p>
            <button
              onClick={() => navigate('/import')}
              className="mt-2 text-sm text-emerald-400 hover:text-emerald-300"
            >
              Import games →
            </button>
          </div>
        </div>
      ) : (
        <>
          {unanalyzed.length > 0 && (
            <GameSection
              title="Awaiting Analysis"
              games={unanalyzed}
              onSelect={(id) => navigate(`/review/${id}`)}
            />
          )}
          {analyzed.length > 0 && (
            <GameSection
              title="Analyzed"
              games={analyzed}
              onSelect={(id) => navigate(`/review/${id}`)}
            />
          )}
        </>
      )}
    </div>
  )
}

function GameSection({
  title,
  games,
  onSelect
}: {
  title: string
  games: GameListItem[]
  onSelect: (id: number) => void
}) {
  return (
    <div className="mt-6">
      <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
        {title} ({games.length})
      </h3>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Players</th>
              <th className="px-4 py-3">Opening</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">Blunders</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr
                key={game.id}
                onClick={() => onSelect(game.id)}
                className="cursor-pointer border-b border-zinc-800/50 transition-colors hover:bg-zinc-900/80"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">
                    {game.white ?? '?'} vs {game.black ?? '?'}
                  </div>
                  {game.userColor && (
                    <span className="text-[11px] text-zinc-500">You: {game.userColor}</span>
                  )}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-zinc-400">
                  {game.openingName ?? '—'}
                </td>
                <td className="px-4 py-3 text-zinc-500">{game.date ?? '—'}</td>
                <td className="px-4 py-3 text-zinc-400">{game.result ?? '*'}</td>
                <td className="px-4 py-3">
                  {game.analysisStatus === 'analyzed' ? (
                    game.blunderCount + game.missedPunishmentCount > 0 ? (
                      <span className="text-red-400">
                        {game.blunderCount + game.missedPunishmentCount}
                      </span>
                    ) : (
                      <span className="text-emerald-400">0</span>
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={game.analysisStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: AnalysisStatus }) {
  const styles: Record<AnalysisStatus, string> = {
    pending: 'bg-zinc-800 text-zinc-400',
    queued: 'bg-blue-500/10 text-blue-400',
    analyzing: 'bg-amber-500/10 text-amber-400',
    analyzed: 'bg-emerald-500/10 text-emerald-400',
    error: 'bg-red-500/10 text-red-400'
  }
  return (
    <span
      className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-600">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
