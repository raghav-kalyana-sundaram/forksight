import type {
  AnalyticsFilters,
  AnalyticsResult,
  GamePhase,
  LabelBreakdownEntry,
  PhaseBreakdownEntry,
  RetentionByLabelEntry
} from '@shared/types'
import { ALL_CLAMPK_LABELS, type ClampKLabel, type ConfirmedLabels } from '@shared/types'
import { getDb } from '../db'
import { handle } from './typed'

const MAX_EVAL_LOSS_FOR_AVG = 500

export function registerAnalyticsHandlers(): void {
  handle('analytics:query', ({ filters }): AnalyticsResult => {
    return runAnalyticsQuery(filters)
  })
}

function runAnalyticsQuery(filters?: AnalyticsFilters): AnalyticsResult {
  const db = getDb()
  const { where, params } = buildWhereClause(filters)
  const gameWhere = buildGameWhereClause(filters)

  const gameCount = db
    .prepare(
      `SELECT COUNT(DISTINCT g.id) AS cnt FROM games g ${gameWhere.join}
       ${gameWhere.clauses.length > 0 ? 'WHERE ' + gameWhere.clauses.join(' AND ') : ''}`
    )
    .get(gameWhere.params) as { cnt: number }

  const blunderStats = db
    .prepare(
      `SELECT
         COALESCE(SUM(p.is_blunder), 0) AS total_blunders,
         COALESCE(SUM(p.is_missed_punishment), 0) AS total_missed,
         AVG(CASE WHEN (p.is_blunder = 1 OR p.is_missed_punishment = 1)
           THEN MIN(p.eval_loss, ${MAX_EVAL_LOSS_FOR_AVG}) END) AS avg_eval_loss
       FROM positions p
       JOIN games g ON g.id = p.game_id
       ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}`
    )
    .get(params) as {
    total_blunders: number
    total_missed: number
    avg_eval_loss: number | null
  }

  const totalGames = gameCount.cnt
  const totalBlunders = blunderStats.total_blunders
  const totalMissedPunishments = blunderStats.total_missed
  const blundersPerGame = totalGames > 0 ? totalBlunders / totalGames : null
  const avgEvalLossCp =
    blunderStats.avg_eval_loss != null ? Math.round(blunderStats.avg_eval_loss) : null

  const labelBreakdown = computeLabelBreakdown(db, where, params)
  const retentionByLabel = computeRetentionByLabel(db)
  const blundersByPhase = computeBlundersByPhase(db, where, params)

  return {
    totalGames,
    totalBlunders,
    totalMissedPunishments,
    blundersPerGame,
    avgEvalLossCp,
    labelBreakdown,
    retentionByLabel,
    blundersByPhase
  }
}

function computeBlundersByPhase(
  db: ReturnType<typeof getDb>,
  where: string[],
  params: Record<string, unknown>
): PhaseBreakdownEntry[] {
  const flaggedWhere = [...where]
  if (!flaggedWhere.some((c) => c.includes('is_blunder') || c.includes('is_missed_punishment'))) {
    flaggedWhere.push('(p.is_blunder = 1 OR p.is_missed_punishment = 1)')
  }

  const rows = db
    .prepare(
      `SELECT
         CASE
           WHEN p.move_number <= 15 THEN 'opening'
           WHEN p.move_number <= 35 THEN 'middlegame'
           ELSE 'endgame'
         END AS phase,
         COUNT(*) AS cnt
       FROM positions p
       JOIN games g ON g.id = p.game_id
       ${flaggedWhere.length > 0 ? 'WHERE ' + flaggedWhere.join(' AND ') : ''}
       GROUP BY phase`
    )
    .all(params) as { phase: GamePhase; cnt: number }[]

  const order: GamePhase[] = ['opening', 'middlegame', 'endgame']
  const map = new Map(rows.map((r) => [r.phase, r.cnt]))
  return order.map((phase) => ({ phase, count: map.get(phase) ?? 0 }))
}

function buildWhereClause(filters?: AnalyticsFilters): {
  where: string[]
  params: Record<string, unknown>
} {
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (!filters) return { where, params }

  if (filters.timeControl) {
    where.push('g.time_control = @timeControl')
    params.timeControl = filters.timeControl
  }
  if (filters.color) {
    where.push('g.user_color = @userColor')
    params.userColor = filters.color
  }
  if (filters.dateFrom) {
    where.push('g.date >= @dateFrom')
    params.dateFrom = filters.dateFrom
  }
  if (filters.dateTo) {
    where.push('g.date <= @dateTo')
    params.dateTo = filters.dateTo
  }
  if (filters.blunderType === 'blunder') {
    where.push('p.is_blunder = 1')
  } else if (filters.blunderType === 'missed_punishment') {
    where.push('p.is_missed_punishment = 1')
  }
  if (filters.gamePhase) {
    const phaseRange = getPhaseRange(filters.gamePhase)
    where.push('p.move_number >= @phaseStart AND p.move_number <= @phaseEnd')
    params.phaseStart = phaseRange.start
    params.phaseEnd = phaseRange.end
  }

  return { where, params }
}

function buildGameWhereClause(filters?: AnalyticsFilters): {
  join: string
  clauses: string[]
  params: Record<string, unknown>
} {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  let join = ''

  if (!filters) return { join, clauses, params }

  if (filters.timeControl) {
    clauses.push('g.time_control = @timeControl')
    params.timeControl = filters.timeControl
  }
  if (filters.color) {
    clauses.push('g.user_color = @userColor')
    params.userColor = filters.color
  }
  if (filters.dateFrom) {
    clauses.push('g.date >= @dateFrom')
    params.dateFrom = filters.dateFrom
  }
  if (filters.dateTo) {
    clauses.push('g.date <= @dateTo')
    params.dateTo = filters.dateTo
  }

  if (filters.blunderType || filters.gamePhase) {
    join = 'JOIN positions p ON p.game_id = g.id'
    if (filters.blunderType === 'blunder') clauses.push('p.is_blunder = 1')
    else if (filters.blunderType === 'missed_punishment') clauses.push('p.is_missed_punishment = 1')
    if (filters.gamePhase) {
      const range = getPhaseRange(filters.gamePhase)
      clauses.push('p.move_number >= @phaseStart AND p.move_number <= @phaseEnd')
      params.phaseStart = range.start
      params.phaseEnd = range.end
    }
  }

  return { join, clauses, params }
}

function getPhaseRange(phase: string): { start: number; end: number } {
  switch (phase) {
    case 'opening':
      return { start: 1, end: 15 }
    case 'middlegame':
      return { start: 16, end: 35 }
    case 'endgame':
      return { start: 36, end: 999 }
    default:
      return { start: 1, end: 999 }
  }
}

function computeLabelBreakdown(
  db: ReturnType<typeof getDb>,
  where: string[],
  params: Record<string, unknown>
): LabelBreakdownEntry[] {
  const flaggedWhere = [...where]
  if (!flaggedWhere.some((c) => c.includes('is_blunder') || c.includes('is_missed_punishment'))) {
    flaggedWhere.push('(p.is_blunder = 1 OR p.is_missed_punishment = 1)')
  }
  flaggedWhere.push("p.confirmed_labels IS NOT NULL AND p.confirmed_labels != 'null'")

  const rows = db
    .prepare(
      `SELECT p.confirmed_labels FROM positions p
       JOIN games g ON g.id = p.game_id
       ${flaggedWhere.length > 0 ? 'WHERE ' + flaggedWhere.join(' AND ') : ''}`
    )
    .all(params) as { confirmed_labels: string }[]

  const counts = new Map<ClampKLabel, number>()
  for (const label of ALL_CLAMPK_LABELS) counts.set(label, 0)

  for (const row of rows) {
    try {
      const labels = JSON.parse(row.confirmed_labels) as ConfirmedLabels
      counts.set(labels.primary, (counts.get(labels.primary) ?? 0) + 1)
      for (const sec of labels.secondary) {
        counts.set(sec, (counts.get(sec) ?? 0) + 1)
      }
    } catch {
      /* skip bad data */
    }
  }

  const result: LabelBreakdownEntry[] = []
  for (const [label, count] of counts) {
    if (count > 0) result.push({ label, count })
  }
  return result.sort((a, b) => b.count - a.count)
}

function computeRetentionByLabel(
  db: ReturnType<typeof getDb>
): RetentionByLabelEntry[] {
  const rows = db
    .prepare(
      `SELECT f.labels, ra.move_correct
       FROM review_attempts ra
       JOIN flashcards f ON f.id = ra.card_id
       WHERE f.labels IS NOT NULL AND f.labels != 'null'
         AND ra.move_correct IS NOT NULL`
    )
    .all() as { labels: string; move_correct: number }[]

  const stats = new Map<ClampKLabel, { attempts: number; correct: number }>()
  for (const label of ALL_CLAMPK_LABELS) stats.set(label, { attempts: 0, correct: 0 })

  for (const row of rows) {
    try {
      const labels = JSON.parse(row.labels) as ConfirmedLabels
      const allLabels = [labels.primary, ...labels.secondary]
      for (const label of allLabels) {
        const s = stats.get(label)!
        s.attempts++
        if (row.move_correct === 1) s.correct++
      }
    } catch {
      /* skip */
    }
  }

  const result: RetentionByLabelEntry[] = []
  for (const [label, s] of stats) {
    result.push({
      label,
      attempts: s.attempts,
      correct: s.correct,
      retention: s.attempts > 0 ? s.correct / s.attempts : null
    })
  }
  return result
}
