import { useEffect, useRef, useMemo, forwardRef } from 'react'
import type { ReplayMove } from '../lib/chess-utils'
import type { SeverityTier } from '@shared/types'
import { severityAnnotation } from '../lib/severity'

interface Props {
  moves: ReplayMove[]
  currentPly: number
  blunderPlies: Set<number>
  plySeverity?: Map<number, SeverityTier>
  onClickPly: (ply: number) => void
}

export default function MoveList({
  moves,
  currentPly,
  blunderPlies,
  plySeverity,
  onClickPly
}: Props): React.JSX.Element {
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentPly])

  const pairs = useMemo(() => {
    const result: [ReplayMove | null, ReplayMove | null][] = []
    for (let i = 0; i < moves.length; i += 2) {
      result.push([moves[i] ?? null, moves[i + 1] ?? null])
    }
    return result
  }, [moves])

  if (!moves.length) {
    return <p className="py-4 text-center text-sm text-zinc-600">No moves</p>
  }

  return (
    <div className="max-h-[360px] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="grid grid-cols-[2rem_1fr_1fr] gap-x-1 gap-y-px text-[13px] font-mono">
        {pairs.map(([white, black], rowIdx) => {
          const whitePly = rowIdx * 2 + 1
          const blackPly = rowIdx * 2 + 2
          return (
            <div key={rowIdx} className="contents">
              <span className="pr-1 text-right text-zinc-600">{rowIdx + 1}.</span>
              {white ? (
                <MoveButton
                  ref={currentPly === whitePly ? activeRef : null}
                  san={white.san}
                  active={currentPly === whitePly}
                  isBlunder={blunderPlies.has(whitePly)}
                  tier={plySeverity?.get(whitePly) ?? null}
                  onClick={() => onClickPly(whitePly)}
                />
              ) : (
                <span />
              )}
              {black ? (
                <MoveButton
                  ref={currentPly === blackPly ? activeRef : null}
                  san={black.san}
                  active={currentPly === blackPly}
                  isBlunder={blunderPlies.has(blackPly)}
                  tier={plySeverity?.get(blackPly) ?? null}
                  onClick={() => onClickPly(blackPly)}
                />
              ) : (
                <span />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const MoveButton = forwardRef<
  HTMLButtonElement,
  {
    san: string
    active: boolean
    isBlunder: boolean
    tier: SeverityTier | null
    onClick: () => void
  }
>(function MoveButton({ san, active, isBlunder, tier, onClick }, ref) {
  const annotation = tier ? severityAnnotation(tier) : isBlunder ? '?' : ''
  let cls = 'rounded px-1.5 py-0.5 text-left transition-colors cursor-pointer '
  if (active) {
    cls += 'bg-emerald-500/20 text-emerald-300 '
  } else if (tier === 'blunder' || (isBlunder && !tier)) {
    cls += 'text-red-400 hover:bg-red-500/10 '
  } else if (tier === 'mistake') {
    cls += 'text-orange-400 hover:bg-orange-500/10 '
  } else if (tier === 'inaccuracy') {
    cls += 'text-yellow-400 hover:bg-yellow-500/10 '
  } else {
    cls += 'text-zinc-300 hover:bg-zinc-800 '
  }
  return (
    <button ref={ref} onClick={onClick} className={cls}>
      {san}
      {annotation && (
        <span
          className={
            tier === 'inaccuracy'
              ? 'text-yellow-500'
              : tier === 'mistake'
                ? 'text-orange-500'
                : 'text-red-500'
          }
        >
          {annotation}
        </span>
      )}
    </button>
  )
})
