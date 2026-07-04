import { useState } from 'react'
import {
  ClampKLabel,
  ALL_CLAMPK_LABELS,
  type SuggestedLabel,
  type ConfirmedLabels
} from '@shared/types'
import { LABEL_DISPLAY, LABEL_STYLES } from './ClampKBadge'

interface Props {
  suggestedLabels: SuggestedLabel[]
  confirmedLabels: ConfirmedLabels | null
  onConfirm: (labels: ConfirmedLabels) => void
  compact?: boolean
}

export default function ClampKEditor({
  suggestedLabels,
  confirmedLabels,
  onConfirm,
  compact
}: Props): React.JSX.Element {
  const [selected, setSelected] = useState<ClampKLabel[]>(() => {
    if (confirmedLabels) return [confirmedLabels.primary, ...confirmedLabels.secondary]
    return suggestedLabels.map((sl) => sl.label).slice(0, 3)
  })

  const toggle = (label: ClampKLabel) => {
    setSelected((prev) => {
      if (prev.includes(label)) return prev.filter((l) => l !== label)
      if (prev.length >= 3) return prev
      return [...prev, label]
    })
  }

  const handleConfirm = () => {
    if (!selected.length) return
    onConfirm({ primary: selected[0], secondary: selected.slice(1) })
  }

  const isConfirmed = confirmedLabels !== null

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${compact ? '' : 'mt-1'}`}>
      {ALL_CLAMPK_LABELS.map((label) => {
        const isSuggested = suggestedLabels.some((sl) => sl.label === label)
        const isSelected = selected.includes(label)
        const isPrimary = selected[0] === label

        let cls =
          'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer '
        if (isSelected) {
          cls += LABEL_STYLES[label] + ' '
          if (isPrimary) cls += 'ring-1 ring-emerald-500/40 '
        } else if (isSuggested) {
          cls += 'border-dashed border-zinc-600 text-zinc-500 hover:text-zinc-300 '
        } else {
          cls += 'border-zinc-800 text-zinc-700 hover:border-zinc-700 hover:text-zinc-500 '
        }

        return (
          <button key={label} onClick={() => toggle(label)} className={cls}>
            {isPrimary && '★ '}
            {LABEL_DISPLAY[label]}
          </button>
        )
      })}
      {!isConfirmed && (
        <button
          onClick={handleConfirm}
          disabled={selected.length === 0}
          className="ml-1 rounded-md bg-emerald-600/80 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
        >
          Confirm
        </button>
      )}
    </div>
  )
}
