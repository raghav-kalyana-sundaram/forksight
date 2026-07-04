import { getAttemptsForCard } from '../db/dao/reviewAttempts'
import { insertReviewAttempt } from '../db/dao/reviewAttempts'
import {
  getDueFlashcardCount,
  getDueFlashcards,
  getFlashcard,
  insertFlashcard,
  updateFlashcardSchedule
} from '../db/dao/flashcards'
import { getPosition, markSavedAsCard } from '../db/dao/positions'
import { getGame } from '../db/dao/games'
import { schedule, draftCloze } from '../srs'
import { handle } from './typed'

export function registerFlashcardsHandlers(): void {
  handle('flashcards:createFromPosition', (input) => {
    const position = getPosition(input.positionId)
    if (!position) throw new Error(`Position ${input.positionId} not found`)

    const game = getGame(position.gameId)
    const labels = input.labels ?? position.confirmedLabels ?? null

    const { prompt, answer } = draftCloze({
      labels,
      bestMove: input.correctMove ?? position.bestMove,
      playedMove: position.playedMove,
      engineLine: position.engineLine,
      evalLoss: position.evalLoss
    })

    const card = insertFlashcard({
      positionId: input.positionId,
      fen: position.fen,
      correctMove: input.correctMove ?? position.bestMove ?? position.playedMove,
      acceptedMoves: input.acceptedMoves ?? [],
      labels,
      clozePrompt: input.clozePrompt ?? prompt,
      clozeAnswer: input.clozeAnswer ?? answer,
      takeaway: input.takeaway ?? game?.takeaway ?? null
    })

    markSavedAsCard(input.positionId, true)
    return card
  })

  handle('flashcards:getDue', ({ limit } = { limit: undefined }) => getDueFlashcards(limit))

  handle('flashcards:getDueCount', () => getDueFlashcardCount())

  handle('flashcards:submitReview', (input) => {
    const card = getFlashcard(input.cardId)
    if (!card) throw new Error(`Flashcard ${input.cardId} not found`)

    insertReviewAttempt(input)
    const result = schedule(card, input.rating)
    updateFlashcardSchedule(card.id, result)

    return getFlashcard(card.id)!
  })

  handle('flashcards:getAttempts', ({ cardId }) => getAttemptsForCard(cardId))
}
