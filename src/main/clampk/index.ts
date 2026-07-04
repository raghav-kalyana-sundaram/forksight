import { Chess, type Square, type PieceSymbol, type Color as ChessColor } from 'chess.js'
import { ClampKLabel, MATE_CP, type SuggestedLabel } from '@shared/types'

const FILES = 'abcdefgh'
const RANKS = '12345678'

function allSquares(): Square[] {
  const squares: Square[] = []
  for (const f of FILES) {
    for (const r of RANKS) {
      squares.push((f + r) as Square)
    }
  }
  return squares
}

const ALL_SQUARES = allSquares()

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0
}

interface HeuristicContext {
  chess: Chess
  fen: string
  playedMove: string
  bestMove: string | null
  pv: string[]
  evalBefore: number | null
  evalAfter: number | null
  sideToMove: ChessColor
}

/**
 * Run all CLAMP/K heuristics on a flagged position.
 * Returns up to 3 suggested labels ranked by confidence.
 */
export function suggestClampKLabels(ctx: {
  fen: string
  playedMove: string
  bestMove: string | null
  pv: string[]
  evalBefore: number | null
  evalAfter: number | null
}): SuggestedLabel[] {
  const chess = new Chess(ctx.fen)
  const sideToMove = chess.turn() === 'w' ? 'w' : 'b'
  const hCtx: HeuristicContext = {
    chess,
    fen: ctx.fen,
    playedMove: ctx.playedMove,
    bestMove: ctx.bestMove,
    pv: ctx.pv,
    evalBefore: ctx.evalBefore,
    evalAfter: ctx.evalAfter,
    sideToMove: sideToMove as ChessColor
  }

  const scores: { label: ClampKLabel; confidence: number }[] = [
    { label: ClampKLabel.Checks, confidence: detectChecks(hCtx) },
    { label: ClampKLabel.LoosePieces, confidence: detectLoosePieces(hCtx) },
    { label: ClampKLabel.Alignments, confidence: detectAlignments(hCtx) },
    { label: ClampKLabel.Mobility, confidence: detectMobility(hCtx) },
    { label: ClampKLabel.PassedPawns, confidence: detectPassedPawns(hCtx) },
    { label: ClampKLabel.KingSafety, confidence: detectKingSafety(hCtx) }
  ]

  return scores
    .filter((s) => s.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
}

function detectChecks(ctx: HeuristicContext): number {
  let score = 0
  const { bestMove, pv, sideToMove } = ctx

  if (bestMove) {
    const test = new Chess(ctx.fen)
    try {
      test.move(bestMove)
      if (test.isCheck()) score += 0.6
    } catch {
      /* invalid move format */
    }
  }

  if (pv.length > 0) {
    const test = new Chess(ctx.fen)
    let checksInPv = 0
    for (const m of pv.slice(0, 6)) {
      try {
        test.move(m)
        if (test.isCheck()) {
          const mover = test.turn() === 'w' ? 'b' : 'w'
          if (mover === sideToMove) checksInPv++
        }
      } catch {
        break
      }
    }
    if (checksInPv >= 2) score += 0.3
    else if (checksInPv === 1) score += 0.1
  }

  return Math.min(score, 1.0)
}

function detectLoosePieces(ctx: HeuristicContext): number {
  const { chess, sideToMove, playedMove } = ctx
  let score = 0
  const opponent = sideToMove === 'w' ? 'b' : 'w'

  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq)
    if (!piece || piece.type === 'k' || piece.type === 'p') continue

    const attackers = getAttackers(chess, sq, opponent)
    const defenders = getAttackers(chess, sq, sideToMove)

    if (piece.color === sideToMove && attackers.length > defenders.length) {
      score += 0.4
    }
  }

  if (playedMove) {
    const afterMove = new Chess(ctx.fen)
    try {
      afterMove.move(playedMove)
      for (const sq of ALL_SQUARES) {
        const piece = afterMove.get(sq)
        if (!piece || piece.color !== sideToMove || piece.type === 'k' || piece.type === 'p')
          continue
        const attackers = getAttackers(afterMove, sq, opponent)
        const defenders = getAttackers(afterMove, sq, sideToMove)
        if (attackers.length > 0 && defenders.length === 0) {
          score += 0.5
          break
        }
      }
    } catch {
      /* invalid move */
    }
  }

  return Math.min(score, 1.0)
}

function getAttackers(chess: Chess, sq: Square, byColor: ChessColor): Square[] {
  const attackers: Square[] = []
  for (const from of ALL_SQUARES) {
    const piece = chess.get(from)
    if (!piece || piece.color !== byColor) continue
    try {
      const moves = chess.moves({ square: from, verbose: true })
      if (moves.some((m) => m.to === sq)) {
        attackers.push(from)
      }
    } catch {
      /* no moves */
    }
  }
  return attackers
}

function detectAlignments(ctx: HeuristicContext): number {
  const { chess, sideToMove } = ctx
  let score = 0
  const opponent = sideToMove === 'w' ? 'b' : 'w'

  const valuablePieces: { sq: Square; type: PieceSymbol }[] = []
  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq)
    if (piece && piece.color === sideToMove && (piece.type === 'k' || piece.type === 'q' || piece.type === 'r')) {
      valuablePieces.push({ sq, type: piece.type })
    }
  }

  for (let i = 0; i < valuablePieces.length; i++) {
    for (let j = i + 1; j < valuablePieces.length; j++) {
      const a = valuablePieces[i].sq
      const b = valuablePieces[j].sq
      if (onSameLineOrDiag(a, b)) {
        const hasSlider = hasEnemySliderOnRay(chess, a, b, opponent)
        if (hasSlider) score += 0.5
      }
    }
  }

  if (ctx.pv.length > 0) {
    const test = new Chess(ctx.fen)
    for (const m of ctx.pv.slice(0, 4)) {
      try {
        const move = test.move(m)
        if (move.flags.includes('c') || move.flags.includes('e')) {
          score += 0.1
        }
      } catch {
        break
      }
    }
  }

  return Math.min(score, 1.0)
}

function onSameLineOrDiag(a: Square, b: Square): boolean {
  const af = a.charCodeAt(0), ar = a.charCodeAt(1)
  const bf = b.charCodeAt(0), br = b.charCodeAt(1)
  return af === bf || ar === br || Math.abs(af - bf) === Math.abs(ar - br)
}

function hasEnemySliderOnRay(chess: Chess, a: Square, b: Square, enemy: ChessColor): boolean {
  const af = a.charCodeAt(0) - 97, ar = parseInt(a[1]) - 1
  const bf = b.charCodeAt(0) - 97, br = parseInt(b[1]) - 1

  const isRankFile = af === bf || ar === br
  const isDiag = Math.abs(af - bf) === Math.abs(ar - br)
  if (!isRankFile && !isDiag) return false

  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq)
    if (!piece || piece.color !== enemy) continue
    const sf = sq.charCodeAt(0) - 97, sr = parseInt(sq[1]) - 1

    if (isRankFile && (piece.type === 'r' || piece.type === 'q')) {
      if ((sf === af && sf === bf) || (sr === ar && sr === br)) return true
    }
    if (isDiag && (piece.type === 'b' || piece.type === 'q')) {
      if (Math.abs(sf - af) === Math.abs(sr - ar) && Math.abs(sf - bf) === Math.abs(sr - br)) {
        return true
      }
    }
  }
  return false
}

function detectMobility(ctx: HeuristicContext): number {
  const { chess, sideToMove, pv } = ctx
  let score = 0

  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq)
    if (!piece || piece.color !== sideToMove) continue
    if (piece.type === 'p' || piece.type === 'k') continue

    const moves = chess.moves({ square: sq, verbose: true })
    if (moves.length <= 2 && PIECE_VALUES[piece.type] >= 3) {
      score += 0.4
    }
  }

  if (pv.length >= 3) {
    const test = new Chess(ctx.fen)
    for (const m of pv.slice(0, 6)) {
      try {
        test.move(m)
      } catch {
        break
      }
    }
    const kingSquare = findKing(test, sideToMove)
    if (kingSquare) {
      const kingMoves = test.moves({ square: kingSquare, verbose: true })
      if (kingMoves.length <= 1) score += 0.2
    }
  }

  return Math.min(score, 1.0)
}

function findKing(chess: Chess, color: ChessColor): Square | null {
  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq)
    if (piece && piece.type === 'k' && piece.color === color) return sq
  }
  return null
}

function detectPassedPawns(ctx: HeuristicContext): number {
  const { chess, pv } = ctx
  let score = 0
  const opponent = ctx.sideToMove === 'w' ? 'b' : 'w'

  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq)
    if (!piece || piece.type !== 'p') continue

    const file = sq.charCodeAt(0) - 97
    const rank = parseInt(sq[1])

    if (piece.color === opponent) continue

    if (isPassedPawn(chess, file, rank, piece.color)) {
      const promoDistance = piece.color === 'w' ? 8 - rank : rank - 1
      score += promoDistance <= 3 ? 0.6 : 0.3
    }
  }

  if (pv.length > 0) {
    for (const m of pv) {
      if (m.length === 5 && 'qrbn'.includes(m[4])) {
        score += 0.4
        break
      }
    }
  }

  return Math.min(score, 1.0)
}

function isPassedPawn(chess: Chess, file: number, rank: number, color: ChessColor): boolean {
  const dir = color === 'w' ? 1 : -1
  const enemyPawnColor = color === 'w' ? 'b' : 'w'

  for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
    let r = rank + dir
    while (r >= 1 && r <= 8) {
      const sq = (String.fromCharCode(97 + f) + r.toString()) as Square
      const piece = chess.get(sq)
      if (piece && piece.type === 'p' && piece.color === enemyPawnColor) return false
      r += dir
    }
  }
  return true
}

function detectKingSafety(ctx: HeuristicContext): number {
  const { pv, evalBefore, evalAfter } = ctx
  let score = 0

  if (evalBefore != null && evalAfter != null) {
    if (Math.abs(evalBefore) >= MATE_CP || Math.abs(evalAfter) >= MATE_CP) {
      score += 0.7
    }
  }

  if (pv.length > 0) {
    const opponent = ctx.sideToMove === 'w' ? 'b' : 'w'
    const kingSquare = findKing(ctx.chess, opponent)
    if (kingSquare) {
      const kf = kingSquare.charCodeAt(0) - 97
      const kr = parseInt(kingSquare[1])

      for (const m of pv.slice(0, 4)) {
        const toFile = m.charCodeAt(2) - 97
        const toRank = parseInt(m[3])
        const dist = Math.max(Math.abs(toFile - kf), Math.abs(toRank - kr))
        if (dist <= 2) {
          score += 0.2
        }
      }
    }
  }

  if (ctx.playedMove) {
    const before = new Chess(ctx.fen)
    const myKingBefore = findKing(before, ctx.sideToMove)
    if (myKingBefore) {
      const shieldBefore = countPawnShield(before, myKingBefore, ctx.sideToMove)
      try {
        before.move(ctx.playedMove)
        const myKingAfter = findKing(before, ctx.sideToMove) ?? myKingBefore
        const shieldAfter = countPawnShield(before, myKingAfter, ctx.sideToMove)
        if (shieldAfter < shieldBefore) score += 0.3
      } catch {
        /* invalid move */
      }
    }
  }

  return Math.min(score, 1.0)
}

function countPawnShield(chess: Chess, kingSq: Square, color: ChessColor): number {
  const kf = kingSq.charCodeAt(0) - 97
  const kr = parseInt(kingSq[1])
  const dir = color === 'w' ? 1 : -1
  let count = 0

  for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
    const r = kr + dir
    if (r < 1 || r > 8) continue
    const sq = (String.fromCharCode(97 + f) + r.toString()) as Square
    const piece = chess.get(sq)
    if (piece && piece.type === 'p' && piece.color === color) count++
  }
  return count
}
