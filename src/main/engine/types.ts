import type { AnalysisPreset } from '@shared/types'

export interface UciLine {
  /** MultiPV index (1-based from UCI, stored as-is). */
  multipv: number
  depth: number
  /** Centipawns from White's perspective (mate clamped to ±MATE_CP). */
  scoreCp: number
  /** Mate-in-N from side-to-move's perspective; null when no mate. */
  mate: number | null
  /** Principal variation in UCI long algebraic notation. */
  pv: string[]
}

export interface UciEvalResult {
  fen: string
  lines: UciLine[]
  /** Best move in UCI notation (e.g. "e2e4"). */
  bestmove: string
}

export interface EvalOptions {
  multipv: number
  movetimeMs: number
}

/**
 * Unified Stockfish engine interface.
 * Both the bundled WASM and optional native binary implement this.
 */
export interface UciEngine {
  init(): Promise<void>
  evaluate(fen: string, options: EvalOptions): Promise<UciEvalResult>
  quit(): Promise<void>
}

export function presetToMovetime(preset: AnalysisPreset): number {
  const map: Record<AnalysisPreset, number> = { fast: 150, balanced: 400, deep: 1200 }
  return map[preset]
}
