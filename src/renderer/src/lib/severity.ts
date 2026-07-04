import type { SeverityTier, SeverityThresholds } from '@shared/types'

/** Chess annotation suffix for a severity tier. */
export function severityAnnotation(tier: SeverityTier | null): string {
  switch (tier) {
    case 'inaccuracy':
      return '?!'
    case 'mistake':
      return '?'
    case 'blunder':
      return '??'
    default:
      return ''
  }
}

/** Derive display severity from eval loss and configured thresholds. */
export function getSeverityTier(
  evalLoss: number | null,
  thresholds: SeverityThresholds
): SeverityTier | null {
  if (evalLoss == null || evalLoss < thresholds.inaccuracyThresholdCp) return null
  if (evalLoss >= thresholds.blunderThresholdCp) return 'blunder'
  if (evalLoss >= thresholds.mistakeThresholdCp) return 'mistake'
  return 'inaccuracy'
}

export function severityBorderClass(tier: SeverityTier | null, missed?: boolean): string {
  if (missed) return 'border-l-amber-500'
  switch (tier) {
    case 'inaccuracy':
      return 'border-l-yellow-500'
    case 'mistake':
      return 'border-l-orange-500'
    case 'blunder':
      return 'border-l-red-500'
    default:
      return 'border-l-zinc-600'
  }
}

export function severityBadgeClass(tier: SeverityTier | null, missed?: boolean): string {
  if (missed) return 'bg-amber-500/15 text-amber-400'
  switch (tier) {
    case 'inaccuracy':
      return 'bg-yellow-500/15 text-yellow-400'
    case 'mistake':
      return 'bg-orange-500/15 text-orange-400'
    case 'blunder':
      return 'bg-red-500/15 text-red-400'
    default:
      return 'bg-zinc-800 text-zinc-400'
  }
}

export function severityLabel(tier: SeverityTier | null, missed?: boolean): string {
  if (missed) return 'Missed Punishment'
  switch (tier) {
    case 'inaccuracy':
      return 'Inaccuracy'
    case 'mistake':
      return 'Mistake'
    case 'blunder':
      return 'Blunder'
    default:
      return 'Flagged'
  }
}
