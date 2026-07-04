import type { AnalysisPreset } from '@shared/types'
import type { UciEvalResult, UciLine } from '../../engine/types'
import { getDb } from '../index'

interface EvalCacheRow {
  fen: string
  preset: string
  lines_json: string
  bestmove: string
}

export function getCachedEval(fen: string, preset: AnalysisPreset): UciEvalResult | null {
  const row = getDb()
    .prepare('SELECT * FROM eval_cache WHERE fen = ? AND preset = ?')
    .get(fen, preset) as EvalCacheRow | undefined
  if (!row) return null
  return {
    fen: row.fen,
    lines: JSON.parse(row.lines_json) as UciLine[],
    bestmove: row.bestmove
  }
}

export function setCachedEval(
  fen: string,
  preset: AnalysisPreset,
  result: UciEvalResult
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO eval_cache (fen, preset, lines_json, bestmove)
       VALUES (@fen, @preset, @linesJson, @bestmove)`
    )
    .run({
      fen,
      preset,
      linesJson: JSON.stringify(result.lines),
      bestmove: result.bestmove
    })
}
