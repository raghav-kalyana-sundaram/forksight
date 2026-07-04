import { ClampKLabel } from '@shared/types'
import type {
  CardState,
  ConfirmedLabels,
  Flashcard,
  ReviewRating
} from '@shared/types'

const MIN_EASE = 1.3
const MAX_EASE = 2.8

export interface ScheduleResult {
  intervalDays: number
  ease: number
  dueDate: string
  lapses: number
  state: CardState
}

/**
 * SM-2 based scheduler.
 *
 * New/learning cards:
 *   Again → same session (due now), Hard → 1d, Good → 3d, Easy → 6d
 *
 * Review cards:
 *   Again → reset to 1d + lapse++ + ease−0.2
 *   Hard  → interval × 1.2
 *   Good  → interval × ease
 *   Easy  → interval × ease × 1.3 + ease+0.15
 *   Ease clamped [1.3, 2.8]
 */
export function schedule(card: Flashcard, rating: ReviewRating): ScheduleResult {
  const isNew = card.state === 'new' || card.state === 'learning'
  let intervalDays: number
  let ease = card.ease
  let lapses = card.lapses
  let state: CardState

  if (isNew) {
    switch (rating) {
      case 'again':
        intervalDays = 0
        state = 'learning'
        break
      case 'hard':
        intervalDays = 1
        state = 'review'
        break
      case 'good':
        intervalDays = 3
        state = 'review'
        break
      case 'easy':
        intervalDays = 6
        state = 'review'
        break
    }
  } else {
    const prev = Math.max(card.intervalDays, 1)
    switch (rating) {
      case 'again':
        intervalDays = 1
        lapses++
        ease = clampEase(ease - 0.2)
        state = 'learning'
        break
      case 'hard':
        intervalDays = Math.max(1, Math.round(prev * 1.2))
        state = 'review'
        break
      case 'good':
        intervalDays = Math.max(1, Math.round(prev * ease))
        state = 'review'
        break
      case 'easy':
        intervalDays = Math.max(1, Math.round(prev * ease * 1.3))
        ease = clampEase(ease + 0.15)
        state = 'review'
        break
    }
  }

  const dueDate = computeDueDate(intervalDays)
  return { intervalDays, ease, dueDate, lapses, state }
}

function clampEase(e: number): number {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, e))
}

function computeDueDate(intervalDays: number): string {
  if (intervalDays === 0) return new Date().toISOString()
  const ms = Date.now() + intervalDays * 86400_000
  return new Date(ms).toISOString()
}

/**
 * Draft a cloze prompt + answer from position labels and PV data.
 * Prompt has a blank the user fills in; answer reveals the full explanation.
 */
export function draftCloze(ctx: {
  labels: ConfirmedLabels | null
  bestMove: string | null
  playedMove: string
  engineLine: string[]
  evalLoss: number | null
}): { prompt: string; answer: string } {
  const { labels, bestMove, playedMove, engineLine, evalLoss } = ctx

  const labelNames = labels
    ? [labels.primary, ...labels.secondary].map(formatLabel)
    : ['a tactical pattern']

  const lossStr = evalLoss != null ? `${(evalLoss / 100).toFixed(1)} pawns` : 'significant eval'

  const prompt =
    `You played ${playedMove}, losing ${lossStr}. ` +
    `The pattern involved was ${labelNames[0]}. ` +
    `What was the best move? ___`

  const pvStr = engineLine.length > 0 ? engineLine.slice(0, 5).join(' ') : ''
  const answer =
    `Best move: ${bestMove ?? '(unknown)'}` +
    (pvStr ? `\nLine: ${pvStr}` : '') +
    (labelNames.length > 1 ? `\nRelated themes: ${labelNames.slice(1).join(', ')}` : '')

  return { prompt, answer }
}

const LABEL_DISPLAY: Record<ClampKLabel, string> = {
  [ClampKLabel.Checks]: 'Checks',
  [ClampKLabel.LoosePieces]: 'Loose Pieces',
  [ClampKLabel.Alignments]: 'Alignments',
  [ClampKLabel.Mobility]: 'Mobility',
  [ClampKLabel.PassedPawns]: 'Passed Pawns',
  [ClampKLabel.KingSafety]: 'King Safety'
}

function formatLabel(label: ClampKLabel): string {
  return LABEL_DISPLAY[label] ?? label
}
