import { Chess, type Move } from 'chess.js'
import type {
  AnalysisPreset,
  Color,
  NewPosition,
  SuggestedLabel
} from '@shared/types'
import { MATE_CP } from '@shared/types'
import { getEngine, presetToMovetime } from '../engine'
import type { UciEngine, UciEvalResult } from '../engine'
import { getCachedEval, setCachedEval } from '../db/dao/evalCache'
import { getGame, updateGameAnalysisMetadata, updateGameAnalysisStatus, backfillGameOpening } from '../db/dao/games'
import { deletePositionsForGame, insertPosition } from '../db/dao/positions'
import { getSettings } from '../db/dao/settings'
import { suggestClampKLabels } from '../clampk'
import { broadcast } from '../ipc/typed'

const MULTI_PV = 3
const BLUNDER_THRESHOLD_DEFAULT_CP = 100
const MISSED_PUNISHMENT_SWING_CP = 100
const CRITICAL_GAP_CP = 100
const CRITICAL_BALANCE_CP = 200
const MAX_CRITICAL_PER_GAME = 4

interface QueueEntry {
  gameId: number
  preset: AnalysisPreset
}

let queue: QueueEntry[] = []
let running = false
let cancelledGameIds = new Set<number>()

/**
 * Queue games for analysis. Starts processing if not already running.
 */
export function queueAnalysis(gameIds: number[], preset?: AnalysisPreset): void {
  const settings = getSettings()
  const p = preset ?? settings.analysisPreset

  for (const gameId of gameIds) {
    if (!queue.some((e) => e.gameId === gameId)) {
      queue.push({ gameId, preset: p })
      updateGameAnalysisStatus(gameId, 'queued')
    }
  }

  if (!running) {
    processQueue().catch((err) => {
      console.error('[analysis] queue processing failed:', err)
      for (const entry of queue) {
        updateGameAnalysisStatus(entry.gameId, 'error')
        broadcast('analysis:error', {
          gameId: entry.gameId,
          message: err instanceof Error ? err.message : String(err)
        })
      }
      queue = []
      running = false
    })
  }
}

/**
 * Cancel queued/in-flight analysis for specific games, or all if unspecified.
 */
export function cancelAnalysis(gameIds?: number[]): void {
  if (gameIds) {
    for (const id of gameIds) cancelledGameIds.add(id)
    queue = queue.filter((e) => !gameIds.includes(e.gameId))
    for (const id of gameIds) {
      const game = getGame(id)
      if (game && (game.analysisStatus === 'queued' || game.analysisStatus === 'analyzing')) {
        updateGameAnalysisStatus(id, 'pending')
      }
    }
  } else {
    const allIds = queue.map((e) => e.gameId)
    for (const id of allIds) cancelledGameIds.add(id)
    queue = []
  }
}

async function processQueue(): Promise<void> {
  running = true

  try {
    let gamesProcessed = 0
    const totalBatch = queue.length

    while (queue.length > 0) {
      const entry = queue.shift()!
      if (cancelledGameIds.has(entry.gameId)) {
        cancelledGameIds.delete(entry.gameId)
        continue
      }
      gamesProcessed++
      await analyzeGame(entry, gamesProcessed, totalBatch)
    }
  } finally {
    running = false
    cancelledGameIds.clear()
  }
}

async function analyzeGame(entry: QueueEntry, batchIndex: number, batchTotal: number): Promise<void> {
  const { gameId, preset } = entry
  const game = getGame(gameId)
  if (!game) {
    broadcast('analysis:error', { gameId, message: 'Game not found' })
    return
  }

  updateGameAnalysisStatus(gameId, 'analyzing')
  const settings = getSettings()
  const thresholdCp = settings.blunderThresholdCp ?? BLUNDER_THRESHOLD_DEFAULT_CP

  try {
    const engine = await getEngine(settings.engineBinaryPath)
    const movetimeMs = presetToMovetime(preset)

    const chess = new Chess()
    chess.loadPgn(game.pgn)
    const history = chess.history({ verbose: true })

    if (history.length === 0) {
      updateGameAnalysisMetadata(gameId, preset, new Date().toISOString())
      updateGameAnalysisStatus(gameId, 'analyzed')
      broadcast('analysis:complete', { gameId, blunderCount: 0, missedPunishmentCount: 0, criticalCount: 0 })
      return
    }

    deletePositionsForGame(gameId)

    const positions = buildPositionList(history)
    const totalPositions = positions.length

    const evals = await evaluateAllPositions(
      engine, positions, preset, movetimeMs, gameId, totalPositions, batchIndex, batchTotal
    )

    if (cancelledGameIds.has(gameId)) {
      cancelledGameIds.delete(gameId)
      updateGameAnalysisStatus(gameId, 'pending')
      return
    }

    const userColor = game.userColor
    const results = computeBlundersAndStore(
      positions, evals, gameId, userColor, thresholdCp, preset
    )

    backfillGameOpening(gameId, game.pgn, game.openingName)
    updateGameAnalysisMetadata(gameId, preset, new Date().toISOString())
    updateGameAnalysisStatus(gameId, 'analyzed')
    broadcast('analysis:complete', {
      gameId,
      blunderCount: results.blunderCount,
      missedPunishmentCount: results.missedPunishmentCount,
      criticalCount: results.criticalCount
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[analysis] game ${gameId} error:`, msg)
    updateGameAnalysisStatus(gameId, 'error')
    broadcast('analysis:error', { gameId, message: msg })
  }
}

interface PositionInfo {
  fen: string
  moveNumber: number
  sideToMove: Color
  playedMove: string
  playedMoveUci: string
}

function buildPositionList(history: Move[]): PositionInfo[] {
  const result: PositionInfo[] = []
  const chess = new Chess()

  for (const move of history) {
    const fen = chess.fen()
    const sideToMove: Color = chess.turn() === 'w' ? 'white' : 'black'
    const moveNumber = Math.ceil((chess.moveNumber ? chess.moveNumber() : result.length / 2 + 1))
    result.push({
      fen,
      moveNumber,
      sideToMove,
      playedMove: move.san,
      playedMoveUci: move.from + move.to + (move.promotion || '')
    })
    chess.move(move.san)
  }

  return result
}

async function evaluateAllPositions(
  engine: UciEngine,
  positions: PositionInfo[],
  preset: AnalysisPreset,
  movetimeMs: number,
  gameId: number,
  totalPositions: number,
  batchIndex: number,
  batchTotal: number
): Promise<UciEvalResult[]> {
  const results: UciEvalResult[] = []

  for (let i = 0; i < positions.length; i++) {
    if (cancelledGameIds.has(gameId)) break

    const pos = positions[i]
    const cached = getCachedEval(pos.fen, preset)

    if (cached) {
      results.push(cached)
    } else {
      const evalResult = await engine.evaluate(pos.fen, {
        multipv: MULTI_PV,
        movetimeMs
      })
      setCachedEval(pos.fen, preset, evalResult)
      results.push(evalResult)
    }

    broadcast('analysis:progress', {
      gameId,
      positionsAnalyzed: i + 1,
      totalPositions,
      batchProgress: batchTotal > 0 ? ((batchIndex - 1) + (i + 1) / totalPositions) / batchTotal : null
    })
  }

  return results
}

function uciToSan(fen: string, uciMove: string): string | null {
  try {
    const chess = new Chess(fen)
    const from = uciMove.slice(0, 2)
    const to = uciMove.slice(2, 4)
    const promotion = uciMove.length > 4 ? uciMove[4] : undefined
    const move = chess.move({ from, to, promotion })
    return move ? move.san : null
  } catch {
    return null
  }
}

function getPlayedMoveEval(ev: UciEvalResult, playedMoveUci: string): number | null {
  for (const line of ev.lines) {
    if (line.pv.length > 0 && line.pv[0] === playedMoveUci) {
      return line.scoreCp
    }
  }
  return null
}

function resolveEvalAfter(
  pos: PositionInfo,
  ev: UciEvalResult,
  evalBefore: number,
  nextPositionEval: number | null
): number {
  const fromMultiPv = getPlayedMoveEval(ev, pos.playedMoveUci)
  if (fromMultiPv !== null) return fromMultiPv

  if (nextPositionEval !== null) return nextPositionEval

  const afterFen = applyMove(pos.fen, pos.playedMove)
  if (afterFen) {
    const chess2 = new Chess(afterFen)
    if (chess2.isCheckmate()) {
      return pos.sideToMove === 'white' ? MATE_CP : -MATE_CP
    }
    if (chess2.isDraw()) return 0
  }
  return evalBefore
}

function computeBlundersAndStore(
  positions: PositionInfo[],
  evals: UciEvalResult[],
  gameId: number,
  userColor: Color | null,
  thresholdCp: number,
  _preset: AnalysisPreset
): { blunderCount: number; missedPunishmentCount: number; criticalCount: number } {
  let blunderCount = 0
  let missedPunishmentCount = 0
  let criticalCount = 0
  const criticalCandidates: { index: number; gap: number }[] = []

  const evalScores: number[] = evals.map((ev) => {
    return ev.lines.length > 0 ? ev.lines[0].scoreCp : 0
  })

  const newPositions: NewPosition[] = []
  const evalLosses: number[] = []

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]
    const ev = evals[i]

    const evalBefore = evalScores[i]

    const nextPositionEval = i + 1 < evalScores.length ? evalScores[i + 1] : null
    const evalAfter = resolveEvalAfter(pos, ev, evalBefore, nextPositionEval)

    const evalLoss = computeEvalLoss(evalBefore, evalAfter, pos.sideToMove)
    evalLosses.push(evalLoss)
    const isUserMove = userColor === null || pos.sideToMove === userColor

    const isBlunder = isUserMove && evalLoss > thresholdCp
    let isMissedPunishment = false

    if (isUserMove && i >= 1) {
      const opponentLoss = evalLosses[i - 1]
      if (opponentLoss >= MISSED_PUNISHMENT_SWING_CP && evalLoss >= thresholdCp) {
        isMissedPunishment = true
      }
    }

    if (isBlunder) blunderCount++
    if (isMissedPunishment) missedPunishmentCount++

    const bestmoveUci = ev.bestmove
    const bestMoveSan = uciToSan(pos.fen, bestmoveUci)

    const pvSanMoves = convertPvToSan(pos.fen, ev.lines.length > 0 ? ev.lines[0].pv : [])

    let suggestedLabels: SuggestedLabel[] = []
    if (isBlunder || isMissedPunishment) {
      suggestedLabels = suggestClampKLabels({
        fen: pos.fen,
        playedMove: pos.playedMove,
        bestMove: bestMoveSan,
        pv: pvSanMoves,
        evalBefore,
        evalAfter
      })
    }

    if (ev.lines.length >= 2) {
      const gap = ev.lines[0].scoreCp - ev.lines[1].scoreCp
      const absGap = pos.sideToMove === 'white' ? gap : -gap
      const isInBalance = Math.abs(evalBefore) < CRITICAL_BALANCE_CP
      if (absGap >= CRITICAL_GAP_CP && isInBalance) {
        criticalCandidates.push({ index: i, gap: Math.abs(absGap) })
      }
    }

    newPositions.push({
      gameId,
      fen: pos.fen,
      moveNumber: pos.moveNumber,
      sideToMove: pos.sideToMove,
      playedMove: pos.playedMove,
      bestMove: bestMoveSan,
      engineLine: pvSanMoves,
      evalBefore,
      evalAfter,
      evalLoss,
      isBlunder,
      isMissedPunishment,
      suggestedLabels,
      confirmedLabels: null,
      isCritical: false,
      savedAsCard: false
    })
  }

  criticalCandidates.sort((a, b) => b.gap - a.gap)
  const criticalIndices = new Set(
    criticalCandidates.slice(0, MAX_CRITICAL_PER_GAME).map((c) => c.index)
  )
  for (const idx of criticalIndices) {
    newPositions[idx].isCritical = true
    criticalCount++
  }

  for (const np of newPositions) {
    insertPosition(np)
  }

  return { blunderCount, missedPunishmentCount, criticalCount }
}

function computeEvalLoss(evalBefore: number, evalAfter: number, sideToMove: Color): number {
  const loss = sideToMove === 'white'
    ? evalBefore - evalAfter
    : evalAfter - evalBefore
  return Math.max(0, loss)
}

function applyMove(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen)
    chess.move(san)
    return chess.fen()
  } catch {
    return null
  }
}

function convertPvToSan(fen: string, uciMoves: string[]): string[] {
  const result: string[] = []
  const chess = new Chess(fen)
  for (const uci of uciMoves) {
    try {
      const from = uci.slice(0, 2)
      const to = uci.slice(2, 4)
      const promotion = uci.length > 4 ? uci[4] : undefined
      const move = chess.move({ from, to, promotion })
      if (!move) break
      result.push(move.san)
    } catch {
      break
    }
  }
  return result
}
