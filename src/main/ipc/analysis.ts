import {
  getFlaggedPositionsForGame,
  getPositionsForGame,
  setConfirmedLabels
} from '../db/dao/positions'
import { queueAnalysis, cancelAnalysis } from '../analysis'
import { handle } from './typed'

export function registerAnalysisHandlers(): void {
  handle('analysis:start', ({ gameIds, preset }) => {
    if (!gameIds || gameIds.length === 0) {
      throw new Error('No games specified for analysis')
    }
    queueAnalysis(gameIds, preset)
  })

  handle('analysis:cancel', ({ gameIds }) => {
    cancelAnalysis(gameIds)
  })

  handle('analysis:getPositions', ({ gameId }) => getPositionsForGame(gameId))

  handle('analysis:getBlunders', ({ gameId }) => getFlaggedPositionsForGame(gameId))

  handle('analysis:confirmLabels', ({ positionId, labels }) => {
    setConfirmedLabels(positionId, labels)
  })
}
