import { MATE_CP } from '@shared/types'
import type { UciLine } from './types'

/**
 * Parse a UCI `info` line into a structured result.
 * Returns null for non-eval info lines (e.g. "info string ...").
 */
export function parseInfoLine(line: string, sideToMove: 'white' | 'black'): UciLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null
  if (line.includes(' upperbound') || line.includes(' lowerbound')) return null

  const tokens = line.split(/\s+/)
  let depth = 0
  let multipv = 1
  let scoreCpRaw = 0
  let mate: number | null = null
  const pv: string[] = []
  let inPv = false

  for (let i = 0; i < tokens.length; i++) {
    if (inPv) {
      pv.push(tokens[i])
      continue
    }
    switch (tokens[i]) {
      case 'depth':
        depth = parseInt(tokens[++i], 10)
        break
      case 'multipv':
        multipv = parseInt(tokens[++i], 10)
        break
      case 'score':
        if (tokens[i + 1] === 'cp') {
          scoreCpRaw = parseInt(tokens[i + 2], 10)
          i += 2
        } else if (tokens[i + 1] === 'mate') {
          mate = parseInt(tokens[i + 2], 10)
          scoreCpRaw = mate > 0 ? MATE_CP : -MATE_CP
          i += 2
        }
        break
      case 'pv':
        inPv = true
        break
    }
  }

  if (pv.length === 0) return null

  const scoreCp = sideToMove === 'white' ? scoreCpRaw : -scoreCpRaw
  const adjustedMate = mate != null ? (sideToMove === 'white' ? mate : -mate) : null

  return { multipv, depth, scoreCp, mate: adjustedMate, pv }
}

/**
 * Parse a UCI `bestmove` line. Returns the move in UCI notation, or null.
 */
export function parseBestmove(line: string): string | null {
  const match = line.match(/^bestmove\s+(\S+)/)
  return match ? match[1] : null
}

/**
 * Given accumulated info lines from a single `go` invocation, keep only
 * the highest-depth result for each MultiPV index.
 */
export function consolidateLines(lines: UciLine[]): UciLine[] {
  const best = new Map<number, UciLine>()
  for (const line of lines) {
    const existing = best.get(line.multipv)
    if (!existing || line.depth > existing.depth) {
      best.set(line.multipv, line)
    }
  }
  return Array.from(best.values()).sort((a, b) => a.multipv - b.multipv)
}
