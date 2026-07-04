import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'
import type { Color } from '@shared/types'

export interface ReplayMove {
  san: string
  from: string
  to: string
  color: 'w' | 'b'
}

export interface GameReplay {
  moves: ReplayMove[]
  fens: string[]
}

export function replayPgn(pgn: string): GameReplay {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn)
  } catch {
    return { moves: [], fens: [chess.fen()] }
  }

  const moves: ReplayMove[] = chess.history({ verbose: true }).map((m) => ({
    san: m.san,
    from: m.from,
    to: m.to,
    color: m.color
  }))

  const replay = new Chess()
  const fens: string[] = [replay.fen()]
  for (const move of moves) {
    replay.move(move.san)
    fens.push(replay.fen())
  }

  return { moves, fens }
}

export function getLegalDests(fen: string): Map<Key, Key[]> {
  const chess = new Chess(fen)
  const dests = new Map<Key, Key[]>()
  for (const move of chess.moves({ verbose: true })) {
    const from = move.from as Key
    const to = move.to as Key
    if (!dests.has(from)) dests.set(from, [])
    dests.get(from)!.push(to)
  }
  return dests
}

export function fenTurnColor(fen: string): Color {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black'
}

export function fenIsCheck(fen: string): boolean {
  return new Chess(fen).isCheck()
}

export function formatEval(cp: number | null): string {
  if (cp === null) return '–'
  if (Math.abs(cp) >= 9000) {
    const mateIn = Math.ceil((10000 - Math.abs(cp)) / 2)
    return cp > 0 ? `M${mateIn}` : `-M${mateIn}`
  }
  const pawns = cp / 100
  return pawns >= 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1)
}

/**
 * Convert a White-POV centipawn eval to the requested perspective.
 * DB stores White-POV; pass userColor for player-relative display.
 */
export function toPovEval(
  cp: number | null,
  pov: Color | 'white' | 'black' | null
): number | null {
  if (cp === null) return null
  if (pov === 'black') return -cp
  return cp
}

/** Resolve which perspective to use for display. */
export function resolveEvalPov(
  evalPerspective: 'user' | 'white',
  userColor: Color | null
): Color {
  if (evalPerspective === 'white') return 'white'
  return userColor ?? 'white'
}

/**
 * Format engine PV as numbered SAN main line, e.g. "13...Nc5 14.Qd2 Nf6".
 */
export function formatMainLine(
  engineLine: string[],
  startMoveNumber: number,
  startSide: Color
): string {
  if (!engineLine.length) return ''
  const parts: string[] = []
  let moveNum = startMoveNumber
  let whiteTurn = startSide === 'white'

  for (let i = 0; i < engineLine.length; i++) {
    const san = engineLine[i]
    if (whiteTurn) {
      parts.push(`${moveNum}.${san}`)
    } else {
      parts.push(`${moveNum}...${san}`)
      moveNum++
    }
    whiteTurn = !whiteTurn
  }
  return parts.join(' ')
}

/** Infer piece type from SAN for hint text (K/Q/R/B/N/P). */
export function sanPieceHint(san: string): string {
  const c = san[0]
  if (c === 'O') return 'castling'
  if ('KQRBN'.includes(c)) {
    const names: Record<string, string> = {
      K: 'king',
      Q: 'queen',
      R: 'rook',
      B: 'bishop',
      N: 'knight'
    }
    return names[c] ?? 'piece'
  }
  return 'pawn'
}

export function clampEval(cp: number | null, maxPawns = 5): number {
  if (cp === null) return 0
  const pawns = cp / 100
  return Math.max(-maxPawns, Math.min(maxPawns, pawns))
}

export function tryMove(
  fen: string,
  from: string,
  to: string,
  promotion?: string
): { san: string; newFen: string } | null {
  try {
    const chess = new Chess(fen)
    const move = chess.move({ from, to, promotion: promotion || 'q' })
    if (!move) return null
    return { san: move.san, newFen: chess.fen() }
  } catch {
    return null
  }
}

/**
 * Apply a SAN move to a FEN and return the resulting FEN.
 * Returns null if the move is invalid.
 */
export function applyMove(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen)
    const move = chess.move(san)
    if (!move) return null
    return chess.fen()
  } catch {
    return null
  }
}

/**
 * Convert a SAN move into [from, to] square keys for chessground lastMove highlighting.
 * Returns undefined if the move can't be parsed against the given FEN.
 */
export function sanToSquares(fen: string, san: string): [Key, Key] | undefined {
  try {
    const chess = new Chess(fen)
    const move = chess.move(san)
    if (!move) return undefined
    return [move.from as Key, move.to as Key]
  } catch {
    return undefined
  }
}
