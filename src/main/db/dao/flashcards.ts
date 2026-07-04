import type { CardState, ClampKLabel, Color, ConfirmedLabels, Flashcard, SuggestedLabel } from '@shared/types'
import { getDb } from '../index'

interface FlashcardRow {
  id: number
  position_id: number
  fen: string
  correct_move: string
  accepted_moves: string
  played_move: string
  user_color: string | null
  move_number: number
  game_white: string | null
  game_black: string | null
  game_id: number | null
  time_control: string | null
  opening_name: string | null
  engine_line: string
  suggested_labels: string
  labels: string | null
  cloze_prompt: string | null
  cloze_answer: string | null
  takeaway: string | null
  interval_days: number
  ease: number
  due_date: string
  lapses: number
  state: string
}

function rowToFlashcard(row: FlashcardRow): Flashcard {
  let topSuggestedLabel: ClampKLabel | null = null
  try {
    const suggested = JSON.parse(row.suggested_labels) as SuggestedLabel[]
    topSuggestedLabel = suggested[0]?.label ?? null
  } catch {
    /* ignore */
  }

  return {
    id: row.id,
    positionId: row.position_id,
    fen: row.fen,
    correctMove: row.correct_move,
    acceptedMoves: JSON.parse(row.accepted_moves) as string[],
    playedMove: row.played_move,
    userColor: (row.user_color as Color) ?? null,
    moveNumber: row.move_number,
    gameWhite: row.game_white,
    gameBlack: row.game_black,
    gameId: row.game_id,
    timeControl: row.time_control,
    openingName: row.opening_name,
    engineLine: JSON.parse(row.engine_line) as string[],
    topSuggestedLabel,
    labels: row.labels ? (JSON.parse(row.labels) as ConfirmedLabels) : null,
    clozePrompt: row.cloze_prompt,
    clozeAnswer: row.cloze_answer,
    takeaway: row.takeaway,
    intervalDays: row.interval_days,
    ease: row.ease,
    dueDate: row.due_date,
    lapses: row.lapses,
    state: row.state as CardState
  }
}

export interface NewFlashcard {
  positionId: number
  fen: string
  correctMove: string
  acceptedMoves: string[]
  labels: ConfirmedLabels | null
  clozePrompt: string | null
  clozeAnswer: string | null
  takeaway: string | null
}

export function insertFlashcard(card: NewFlashcard): Flashcard {
  const result = getDb()
    .prepare(
      `INSERT INTO flashcards
         (position_id, fen, correct_move, accepted_moves, labels, cloze_prompt, cloze_answer, takeaway)
       VALUES
         (@positionId, @fen, @correctMove, @acceptedMoves, @labels, @clozePrompt, @clozeAnswer, @takeaway)`
    )
    .run({
      positionId: card.positionId,
      fen: card.fen,
      correctMove: card.correctMove,
      acceptedMoves: JSON.stringify(card.acceptedMoves),
      labels: card.labels ? JSON.stringify(card.labels) : null,
      clozePrompt: card.clozePrompt,
      clozeAnswer: card.clozeAnswer,
      takeaway: card.takeaway
    })
  return getFlashcard(Number(result.lastInsertRowid))!
}

const FLASHCARD_SELECT = `
  SELECT f.*, p.played_move, p.move_number, p.engine_line, p.suggested_labels,
         g.id AS game_id, g.user_color, g.white AS game_white, g.black AS game_black,
         g.time_control, g.opening_name
  FROM flashcards f
  JOIN positions p ON p.id = f.position_id
  JOIN games g ON g.id = p.game_id`

export function getFlashcard(id: number): Flashcard | null {
  const row = getDb()
    .prepare(`${FLASHCARD_SELECT} WHERE f.id = ?`)
    .get(id) as FlashcardRow | undefined
  return row ? rowToFlashcard(row) : null
}

export function getDueFlashcards(limit?: number): Flashcard[] {
  const sql = `${FLASHCARD_SELECT}
               WHERE f.due_date <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               ORDER BY f.due_date
               ${limit != null ? 'LIMIT @limit' : ''}`
  const rows = getDb()
    .prepare(sql)
    .all(limit != null ? { limit } : {}) as FlashcardRow[]
  return rows.map(rowToFlashcard)
}

export function getDueFlashcardCount(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM flashcards
       WHERE due_date <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .get() as { count: number }
  return row.count
}

/** Persist the SRS scheduling state after a review. */
export function updateFlashcardSchedule(
  id: number,
  schedule: {
    intervalDays: number
    ease: number
    dueDate: string
    lapses: number
    state: CardState
  }
): void {
  getDb()
    .prepare(
      `UPDATE flashcards
       SET interval_days = @intervalDays, ease = @ease, due_date = @dueDate,
           lapses = @lapses, state = @state
       WHERE id = @id`
    )
    .run({ id, ...schedule })
}
