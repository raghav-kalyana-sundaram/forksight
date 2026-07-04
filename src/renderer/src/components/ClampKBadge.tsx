import { ClampKLabel } from '@shared/types'

export const LABEL_DISPLAY: Record<ClampKLabel, string> = {
  [ClampKLabel.Checks]: 'Checks',
  [ClampKLabel.LoosePieces]: 'Loose Pieces',
  [ClampKLabel.Alignments]: 'Alignments',
  [ClampKLabel.Mobility]: 'Mobility',
  [ClampKLabel.PassedPawns]: 'Passed Pawns',
  [ClampKLabel.KingSafety]: 'King Safety'
}

export const LABEL_STYLES: Record<ClampKLabel, string> = {
  [ClampKLabel.Checks]: 'bg-red-500/15 text-red-400 border-red-500/30',
  [ClampKLabel.LoosePieces]: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  [ClampKLabel.Alignments]: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  [ClampKLabel.Mobility]: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  [ClampKLabel.PassedPawns]: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  [ClampKLabel.KingSafety]: 'bg-rose-500/15 text-rose-400 border-rose-500/30'
}

export const LABEL_COLORS: Record<ClampKLabel, string> = {
  [ClampKLabel.Checks]: '#f87171',
  [ClampKLabel.LoosePieces]: '#fbbf24',
  [ClampKLabel.Alignments]: '#a78bfa',
  [ClampKLabel.Mobility]: '#60a5fa',
  [ClampKLabel.PassedPawns]: '#34d399',
  [ClampKLabel.KingSafety]: '#fb7185'
}

interface Props {
  label: ClampKLabel
  primary?: boolean
  className?: string
}

export default function ClampKBadge({ label, primary, className }: Props): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${LABEL_STYLES[label]} ${className ?? ''}`}
    >
      {primary && <span className="text-[10px]">★</span>}
      {LABEL_DISPLAY[label]}
    </span>
  )
}
