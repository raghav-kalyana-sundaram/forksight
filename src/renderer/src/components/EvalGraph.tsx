import { useMemo } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  CartesianGrid
} from 'recharts'
import { formatEval } from '../lib/chess-utils'

export interface EvalDataPoint {
  ply: number
  eval: number
  evalCp?: number | null
  move: string
  isBlunder?: boolean
}

interface Props {
  data: EvalDataPoint[]
  currentPly: number
  onClickPly: (ply: number) => void
  /** Small note saying which perspective evals are shown from. */
  perspectiveNote?: string
}

export default function EvalGraph({
  data,
  currentPly,
  onClickPly,
  perspectiveNote
}: Props): React.JSX.Element {
  const gradientOffset = useMemo(() => {
    if (!data.length) return 0.5
    const maxVal = Math.max(...data.map((d) => d.eval), 0.1)
    const minVal = Math.min(...data.map((d) => d.eval), -0.1)
    if (maxVal <= 0) return 0
    if (minVal >= 0) return 1
    return maxVal / (maxVal - minVal)
  }, [data])

  if (!data.length) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-sm text-zinc-600">
        No analysis data
      </div>
    )
  }

  return (
    <div>
      {perspectiveNote && <p className="mb-1 text-[11px] text-zinc-500">{perspectiveNote}</p>}
      <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
          onClick={(e) => {
            const state = e as unknown as { activePayload?: { payload: EvalDataPoint }[] }
            const payload = state?.activePayload?.[0]?.payload
            if (payload) onClickPly(payload.ply)
          }}
        >
          <defs>
            <linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset={gradientOffset} stopColor="#34d399" stopOpacity={0.5} />
              <stop offset={gradientOffset} stopColor="#ef4444" stopOpacity={0.5} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="ply"
            tick={{ fontSize: 10, fill: '#71717a' }}
            tickLine={false}
            axisLine={{ stroke: '#3f3f46' }}
          />
          <YAxis
            domain={[-5, 5]}
            ticks={[-5, -2.5, 0, 2.5, 5]}
            tick={{ fontSize: 10, fill: '#71717a' }}
            tickLine={false}
            axisLine={{ stroke: '#3f3f46' }}
          />
          <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 2" />
          {currentPly > 0 && currentPly <= data.length && (
            <ReferenceLine x={currentPly} stroke="#a3e635" strokeDasharray="3 3" strokeWidth={1.5} />
          )}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as EvalDataPoint
              return (
                <div className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg">
                  <p className="text-zinc-200">
                    Move {Math.ceil(d.ply / 2)}
                    {d.ply % 2 === 1 ? '.' : '...'} {d.move}
                  </p>
                  <p className="text-zinc-400">
                    Eval:{' '}
                    {d.evalCp != null
                      ? formatEval(d.evalCp)
                      : `${d.eval >= 0 ? '+' : ''}${d.eval.toFixed(1)}`}
                  </p>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="eval"
            fill="url(#evalGrad)"
            stroke="#6ee7b7"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, fill: '#34d399', stroke: '#064e3b', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}
