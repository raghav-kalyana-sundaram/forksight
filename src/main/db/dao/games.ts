import type {
  AnalysisPreset,
  AnalysisStatus,
  Color,
  Game,
  GameListItem,
  GameResult,
  GamesListFilter,
  ImportGameInput,
  ImportResult
} from '@shared/types'
import { getDb } from '../index'
import { backfillOpeningName, hashMovetext } from '../../pgn'

interface GameRow {
  id: number
  pgn: string
  source: string | null
  date: string | null
  event: string | null
  white: string | null
  black: string | null
  user_color: string | null
  result: string | null
  time_control: string | null
  opening_name: string | null
  analysis_status: string
  move_count: number
  takeaway: string | null
  analysis_preset: string | null
  analyzed_at: string | null
  movetext_hash: string | null
  created_at: string
}

type GameListRow = GameRow & { blunder_count: number; missed_punishment_count: number }

function rowToGame(row: GameRow): Game {
  return {
    id: row.id,
    pgn: row.pgn,
    source: row.source,
    date: row.date,
    event: row.event,
    white: row.white,
    black: row.black,
    userColor: (row.user_color as Color) ?? null,
    result: (row.result as GameResult) ?? null,
    timeControl: row.time_control,
    openingName: row.opening_name,
    analysisStatus: row.analysis_status as AnalysisStatus,
    moveCount: row.move_count,
    takeaway: row.takeaway,
    analysisPreset: (row.analysis_preset as AnalysisPreset) ?? null,
    analyzedAt: row.analyzed_at,
    movetextHash: row.movetext_hash,
    createdAt: row.created_at
  }
}

export interface GameMetadata {
  date: string | null
  event: string | null
  white: string | null
  black: string | null
  result: GameResult | null
  timeControl: string | null
  openingName: string | null
  moveCount: number
  movetextHash: string
}

export function insertGame(input: ImportGameInput, meta: GameMetadata): Game | null {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM games WHERE movetext_hash = ?')
    .get(meta.movetextHash) as { id: number } | undefined
  if (existing) return null

  const result = db
    .prepare(
      `INSERT INTO games
         (pgn, source, date, event, white, black, user_color, result, time_control,
          opening_name, move_count, movetext_hash)
       VALUES
         (@pgn, @source, @date, @event, @white, @black, @userColor, @result, @timeControl,
          @openingName, @moveCount, @movetextHash)`
    )
    .run({
      pgn: input.pgn,
      source: input.source,
      date: meta.date,
      event: meta.event,
      white: meta.white,
      black: meta.black,
      userColor: input.userColor,
      result: meta.result,
      timeControl: meta.timeControl,
      openingName: meta.openingName,
      moveCount: meta.moveCount,
      movetextHash: meta.movetextHash
    })
  return getGame(Number(result.lastInsertRowid))!
}

export function importGames(
  inputs: ImportGameInput[],
  buildMeta: (input: ImportGameInput, index: number) => GameMetadata | null
): ImportResult {
  const imported: Game[] = []
  let duplicatesSkipped = 0
  const parseFailures: ImportResult['parseFailures'] = []

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    const meta = buildMeta(input, i)
    if (!meta) continue
    const game = insertGame(input, meta)
    if (game) imported.push(game)
    else duplicatesSkipped++
  }

  return { imported, duplicatesSkipped, parseFailures }
}

export function recordImportParseFailure(
  result: ImportResult,
  index: number,
  reason: string
): void {
  result.parseFailures.push({ index, reason })
}

export function getGame(id: number): Game | null {
  const row = getDb().prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined
  return row ? rowToGame(row) : null
}

export function listGames(filter?: GamesListFilter): GameListItem[] {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.analysisStatus) {
    clauses.push('g.analysis_status = @analysisStatus')
    params.analysisStatus = filter.analysisStatus
  }
  if (filter?.search) {
    clauses.push('(g.white LIKE @search OR g.black LIKE @search OR g.event LIKE @search OR g.opening_name LIKE @search)')
    params.search = `%${filter.search}%`
  }
  if (filter?.color) {
    clauses.push('g.user_color = @userColor')
    params.userColor = filter.color
  }
  if (filter?.result) {
    clauses.push('g.result = @result')
    params.result = filter.result
  }
  if (filter?.analyzed === true) {
    clauses.push("g.analysis_status = 'analyzed'")
  } else if (filter?.analyzed === false) {
    clauses.push("g.analysis_status != 'analyzed'")
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

  let having = ''
  if (filter?.hasBlunders === true) {
    having = 'HAVING (COALESCE(SUM(p.is_blunder), 0) + COALESCE(SUM(p.is_missed_punishment), 0)) > 0'
  } else if (filter?.hasBlunders === false) {
    having =
      "HAVING g.analysis_status = 'analyzed' AND (COALESCE(SUM(p.is_blunder), 0) + COALESCE(SUM(p.is_missed_punishment), 0)) = 0"
  }

  const rows = getDb()
    .prepare(
      `SELECT g.*,
              COALESCE(SUM(p.is_blunder), 0) AS blunder_count,
              COALESCE(SUM(p.is_missed_punishment), 0) AS missed_punishment_count
       FROM games g
       LEFT JOIN positions p ON p.game_id = g.id
       ${where}
       GROUP BY g.id
       ${having}
       ORDER BY g.created_at DESC, g.id DESC`
    )
    .all(params) as GameListRow[]

  return rows.map((row) => {
    const { pgn: _pgn, ...game } = rowToGame(row)
    return {
      ...game,
      blunderCount: row.blunder_count,
      missedPunishmentCount: row.missed_punishment_count
    }
  })
}

export function deleteGame(id: number): void {
  getDb().prepare('DELETE FROM games WHERE id = ?').run(id)
}

export function updateGameAnalysisStatus(id: number, status: AnalysisStatus): void {
  getDb().prepare('UPDATE games SET analysis_status = ? WHERE id = ?').run(status, id)
}

export function updateGameAnalysisMetadata(
  id: number,
  preset: AnalysisPreset,
  analyzedAt: string
): void {
  getDb()
    .prepare('UPDATE games SET analysis_preset = ?, analyzed_at = ? WHERE id = ?')
    .run(preset, analyzedAt, id)
}

export function updateGameOpeningName(id: number, openingName: string | null): void {
  getDb().prepare('UPDATE games SET opening_name = ? WHERE id = ?').run(openingName, id)
}

export function backfillGameOpening(id: number, pgn: string, currentName: string | null): void {
  const name = backfillOpeningName(pgn, currentName)
  if (name && name !== currentName) {
    updateGameOpeningName(id, name)
  }
}

export function updateGameTakeaway(id: number, takeaway: string): void {
  getDb().prepare('UPDATE games SET takeaway = ? WHERE id = ?').run(takeaway, id)
}

export function listGameIdsByStatus(statuses: AnalysisStatus[]): number[] {
  if (statuses.length === 0) return []
  const placeholders = statuses.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(`SELECT id FROM games WHERE analysis_status IN (${placeholders}) ORDER BY id`)
    .all(...statuses) as { id: number }[]
  return rows.map((r) => r.id)
}

export function clearAllData(): void {
  const db = getDb()
  db.exec(`
    DELETE FROM review_attempts;
    DELETE FROM flashcards;
    DELETE FROM positions;
    DELETE FROM eval_cache;
    DELETE FROM games;
  `)
}

export function buildGameMetadataFromPgn(
  pgn: string,
  parsed: Omit<GameMetadata, 'movetextHash'>
): GameMetadata {
  return { ...parsed, movetextHash: hashMovetext(pgn) }
}
