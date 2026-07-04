import type { ClampKLabel, ReviewAttempt, ReviewRating, SubmitReviewInput } from '@shared/types'
import { getDb } from '../index'

interface ReviewAttemptRow {
  id: number
  card_id: number
  reviewed_at: string
  move_attempted: string | null
  move_correct: number | null
  labels_answer: string | null
  labels_correct: number | null
  cloze_answer: string | null
  rating: string
  time_spent_ms: number | null
}

function rowToAttempt(row: ReviewAttemptRow): ReviewAttempt {
  return {
    id: row.id,
    cardId: row.card_id,
    reviewedAt: row.reviewed_at,
    moveAttempted: row.move_attempted,
    moveCorrect: row.move_correct == null ? null : row.move_correct === 1,
    labelsAnswer: row.labels_answer ? (JSON.parse(row.labels_answer) as ClampKLabel[]) : null,
    labelsCorrect: row.labels_correct == null ? null : row.labels_correct === 1,
    clozeAnswer: row.cloze_answer,
    rating: row.rating as ReviewRating,
    timeSpentMs: row.time_spent_ms
  }
}

export function insertReviewAttempt(input: SubmitReviewInput): ReviewAttempt {
  const result = getDb()
    .prepare(
      `INSERT INTO review_attempts
         (card_id, move_attempted, move_correct, labels_answer, labels_correct, cloze_answer, rating, time_spent_ms)
       VALUES
         (@cardId, @moveAttempted, @moveCorrect, @labelsAnswer, @labelsCorrect, @clozeAnswer, @rating, @timeSpentMs)`
    )
    .run({
      cardId: input.cardId,
      moveAttempted: input.moveAttempted ?? null,
      moveCorrect: input.moveCorrect == null ? null : input.moveCorrect ? 1 : 0,
      labelsAnswer: input.labelsAnswer ? JSON.stringify(input.labelsAnswer) : null,
      labelsCorrect: input.labelsCorrect == null ? null : input.labelsCorrect ? 1 : 0,
      clozeAnswer: input.clozeAnswer ?? null,
      rating: input.rating,
      timeSpentMs: input.timeSpentMs ?? null
    })
  const row = getDb()
    .prepare('SELECT * FROM review_attempts WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as ReviewAttemptRow
  return rowToAttempt(row)
}

export function getAttemptsForCard(cardId: number): ReviewAttempt[] {
  const rows = getDb()
    .prepare('SELECT * FROM review_attempts WHERE card_id = ? ORDER BY reviewed_at DESC, id DESC')
    .all(cardId) as ReviewAttemptRow[]
  return rows.map(rowToAttempt)
}
