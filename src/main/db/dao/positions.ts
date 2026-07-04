import type {
  AnalyzedPosition,
  Color,
  ConfirmedLabels,
  NewPosition,
  SuggestedLabel
} from '@shared/types'
import { getDb } from '../index'

interface PositionRow {
  id: number
  game_id: number
  fen: string
  move_number: number
  side_to_move: string
  played_move: string
  best_move: string | null
  engine_line: string
  eval_before: number | null
  eval_after: number | null
  eval_loss: number | null
  is_blunder: number
  is_missed_punishment: number
  suggested_labels: string
  confirmed_labels: string | null
  is_critical: number
  saved_as_card: number
}

function rowToPosition(row: PositionRow): AnalyzedPosition {
  return {
    id: row.id,
    gameId: row.game_id,
    fen: row.fen,
    moveNumber: row.move_number,
    sideToMove: row.side_to_move as Color,
    playedMove: row.played_move,
    bestMove: row.best_move,
    engineLine: JSON.parse(row.engine_line) as string[],
    evalBefore: row.eval_before,
    evalAfter: row.eval_after,
    evalLoss: row.eval_loss,
    isBlunder: row.is_blunder === 1,
    isMissedPunishment: row.is_missed_punishment === 1,
    suggestedLabels: JSON.parse(row.suggested_labels) as SuggestedLabel[],
    confirmedLabels: row.confirmed_labels
      ? (JSON.parse(row.confirmed_labels) as ConfirmedLabels)
      : null,
    isCritical: row.is_critical === 1,
    savedAsCard: row.saved_as_card === 1
  }
}

export function insertPosition(position: NewPosition): AnalyzedPosition {
  const result = getDb()
    .prepare(
      `INSERT INTO positions
         (game_id, fen, move_number, side_to_move, played_move, best_move, engine_line,
          eval_before, eval_after, eval_loss, is_blunder, is_missed_punishment,
          suggested_labels, confirmed_labels, is_critical, saved_as_card)
       VALUES
         (@gameId, @fen, @moveNumber, @sideToMove, @playedMove, @bestMove, @engineLine,
          @evalBefore, @evalAfter, @evalLoss, @isBlunder, @isMissedPunishment,
          @suggestedLabels, @confirmedLabels, @isCritical, @savedAsCard)`
    )
    .run({
      gameId: position.gameId,
      fen: position.fen,
      moveNumber: position.moveNumber,
      sideToMove: position.sideToMove,
      playedMove: position.playedMove,
      bestMove: position.bestMove,
      engineLine: JSON.stringify(position.engineLine),
      evalBefore: position.evalBefore,
      evalAfter: position.evalAfter,
      evalLoss: position.evalLoss,
      isBlunder: position.isBlunder ? 1 : 0,
      isMissedPunishment: position.isMissedPunishment ? 1 : 0,
      suggestedLabels: JSON.stringify(position.suggestedLabels),
      confirmedLabels: position.confirmedLabels ? JSON.stringify(position.confirmedLabels) : null,
      isCritical: position.isCritical ? 1 : 0,
      savedAsCard: position.savedAsCard ? 1 : 0
    })
  return getPosition(Number(result.lastInsertRowid))!
}

export function getPosition(id: number): AnalyzedPosition | null {
  const row = getDb().prepare('SELECT * FROM positions WHERE id = ?').get(id) as
    | PositionRow
    | undefined
  return row ? rowToPosition(row) : null
}

export function getPositionsForGame(gameId: number): AnalyzedPosition[] {
  const rows = getDb()
    .prepare('SELECT * FROM positions WHERE game_id = ? ORDER BY move_number, id')
    .all(gameId) as PositionRow[]
  return rows.map(rowToPosition)
}

export function getFlaggedPositionsForGame(gameId: number): AnalyzedPosition[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM positions
       WHERE game_id = ? AND (is_blunder = 1 OR is_missed_punishment = 1)
       ORDER BY move_number, id`
    )
    .all(gameId) as PositionRow[]
  return rows.map(rowToPosition)
}

export function deletePositionsForGame(gameId: number): void {
  getDb().prepare('DELETE FROM positions WHERE game_id = ?').run(gameId)
}

export function setConfirmedLabels(positionId: number, labels: ConfirmedLabels): void {
  getDb()
    .prepare('UPDATE positions SET confirmed_labels = ? WHERE id = ?')
    .run(JSON.stringify(labels), positionId)
}

export function markSavedAsCard(positionId: number, saved: boolean): void {
  getDb()
    .prepare('UPDATE positions SET saved_as_card = ? WHERE id = ?')
    .run(saved ? 1 : 0, positionId)
}
