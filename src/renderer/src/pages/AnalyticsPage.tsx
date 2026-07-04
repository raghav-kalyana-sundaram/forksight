import { useCallback, useEffect, useState } from 'react'
import type {
  AnalyticsResult,
  AnalyticsFilters,
  GameListItem,
  Color,
  BlunderKind,
  GamePhase
} from '@shared/types'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line
} from 'recharts'
import { LABEL_DISPLAY, LABEL_COLORS } from '../components/ClampKBadge'

const EMPTY_RESULT: AnalyticsResult = {
  totalGames: 0,
  totalBlunders: 0,
  totalMissedPunishments: 0,
  blundersPerGame: null,
  avgEvalLossCp: null,
  labelBreakdown: [],
  retentionByLabel: [],
  blundersByPhase: []
}

export default function AnalyticsPage(): React.JSX.Element {
  const [result, setResult] = useState<AnalyticsResult>(EMPTY_RESULT)
  const [games, setGames] = useState<GameListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filters, setFilters] = useState<AnalyticsFilters>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [analytics, gamesList] = await Promise.all([
        window.api.analytics.query(filters),
        window.api.games.list()
      ])
      setResult(analytics)
      setGames(gamesList.filter((g) => g.analysisStatus === 'analyzed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    load()
  }, [load])

  const patchFilter = (patch: Partial<AnalyticsFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch }))

  // Bar chart data: blunders by CLAMP/K label
  const barData = result.labelBreakdown.map((entry) => ({
    label: LABEL_DISPLAY[entry.label],
    count: entry.count,
    fill: LABEL_COLORS[entry.label]
  }))

  // Line chart data: blunders per game over time
  const lineData = games
    .filter((g) => g.date)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .map((g) => ({
      date: g.date,
      blunders: g.blunderCount,
      missed: g.missedPunishmentCount
    }))

  // Retention chart data
  const retentionData = result.retentionByLabel
    .filter((entry) => entry.attempts > 0)
    .map((entry) => ({
      label: LABEL_DISPLAY[entry.label],
      retention: entry.retention !== null ? Math.round(entry.retention * 100) : 0,
      attempts: entry.attempts,
      fill: LABEL_COLORS[entry.label]
    }))

  const phaseData = result.blundersByPhase.map((entry) => ({
    phase: entry.phase.charAt(0).toUpperCase() + entry.phase.slice(1),
    count: entry.count
  }))

  const hasRetentionData = result.retentionByLabel.some((r) => r.attempts > 0)
  const showPatternStats = result.totalGames >= 5
  const showSampleWarning = result.totalGames > 0 && result.totalGames < 25

  if (loading) return <div className="p-10 text-sm text-zinc-500">Loading analytics…</div>

  return (
    <div className="px-10 py-8">
      <h2 className="text-xl font-semibold tracking-tight">Analytics</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Visualize your blunder patterns and improvement over time.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Filters */}
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
          label="Blunder Type"
          value={filters.blunderType ?? ''}
          onChange={(v) => patchFilter({ blunderType: (v as BlunderKind) || undefined })}
          options={[
            { value: '', label: 'Any' },
            { value: 'blunder', label: 'Direct Blunder' },
            { value: 'missed_punishment', label: 'Missed Punishment' }
          ]}
        />
        <FilterSelect
          label="Phase"
          value={filters.gamePhase ?? ''}
          onChange={(v) => patchFilter({ gamePhase: (v as GamePhase) || undefined })}
          options={[
            { value: '', label: 'Any' },
            { value: 'opening', label: 'Opening' },
            { value: 'middlegame', label: 'Middlegame' },
            { value: 'endgame', label: 'Endgame' }
          ]}
        />
        <FilterInput
          label="Time Control"
          value={filters.timeControl ?? ''}
          placeholder="e.g. 600"
          onChange={(v) => patchFilter({ timeControl: v || undefined })}
        />
        <FilterInput
          label="From"
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(v) => patchFilter({ dateFrom: v || undefined })}
        />
        <FilterInput
          label="To"
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(v) => patchFilter({ dateTo: v || undefined })}
        />
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-5 gap-3">
        <StatCard label="Total Games" value={result.totalGames} />
        <StatCard label="Blunders" value={result.totalBlunders} />
        <StatCard label="Missed Punishes" value={result.totalMissedPunishments} />
        <StatCard
          label="Blunders/Game"
          value={result.blundersPerGame !== null ? result.blundersPerGame.toFixed(1) : '—'}
        />
        <StatCard
          label="Eval Loss"
          value={
            result.avgEvalLossCp !== null
              ? `${(result.avgEvalLossCp / 100).toFixed(1)} pawns`
              : '—'
          }
        />
      </div>

      {showSampleWarning && (
        <p className="mt-3 text-xs text-amber-400/80">
          Sample: {result.totalGames} games — early signal. Pattern claims are more reliable
          with 25+ analyzed games.
        </p>
      )}

      {/* Charts */}
      <div className="mt-8 grid grid-cols-2 gap-6">
        {/* Bar: CLAMP/K breakdown */}
        <ChartCard title="Top Mistake Pattern">
          {!showPatternStats ? (
            <div className="flex h-[200px] items-center justify-center text-sm text-zinc-600">
              Need at least 5 analyzed games for pattern stats.
            </div>
          ) : barData.length === 0 ? (
            <EmptyChart message="No labeled blunders yet." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof barData)[0]
                    return (
                      <div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs">
                        <p className="text-zinc-200">{d.label}</p>
                        <p className="text-zinc-400">{d.count} blunders</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Retention by category */}
        <ChartCard title="Retention by Category">
          {!hasRetentionData ? (
            <div className="flex h-[200px] items-center justify-center text-sm text-zinc-500">
              No retention data yet. Review cards to see this chart.
            </div>
          ) : retentionData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={retentionData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof retentionData)[0]
                    return (
                      <div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs">
                        <p className="text-zinc-200">{d.label}</p>
                        <p className="text-zinc-400">
                          {d.retention}% ({d.attempts} attempts)
                        </p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="retention" fill="#34d399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Blunders by phase */}
      <div className="mt-6">
        <ChartCard title="Blunders by Phase">
          {phaseData.every((d) => d.count === 0) ? (
            <EmptyChart message="No flagged positions in this filter." />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={phaseData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="phase"
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof phaseData)[0]
                    return (
                      <div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs">
                        <p className="text-zinc-200">{d.phase}</p>
                        <p className="text-zinc-400">{d.count} flagged positions</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="count" fill="#34d399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Line chart: blunders over time */}
      <div className="mt-6">
        <ChartCard title="Blunders per Game Over Time">
          {lineData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={lineData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  tickLine={false}
                  axisLine={{ stroke: '#3f3f46' }}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof lineData)[0]
                    return (
                      <div className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs">
                        <p className="text-zinc-200">{d.date}</p>
                        <p className="text-zinc-400">
                          {d.blunders} blunders · {d.missed} missed
                        </p>
                      </div>
                    )
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="blunders"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#ef4444' }}
                />
                <Line
                  type="monotone"
                  dataKey="missed"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#fbbf24' }}
                  strokeDasharray="4 2"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ---- Sub-components ----

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-100">{value}</p>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-400">{title}</h3>
      {children}
    </div>
  )
}

function EmptyChart({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-zinc-600">
      {message}
    </div>
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

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text'
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-600">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
      />
    </div>
  )
}

