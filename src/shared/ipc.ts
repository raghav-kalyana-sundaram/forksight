/**
 * The complete typed IPC contract between renderer and main.
 *
 * - `IpcChannels` maps every invoke-style channel name to its request/response
 *   types. Main registers handlers for these; the preload bridge exposes them
 *   as `window.api.*`.
 * - `IpcEvents` maps every main -> renderer push event to its payload type
 *   (used for analysis progress streaming).
 *
 * Adding a channel: add it to `IpcChannels` (or `IpcEvents`), then implement
 * the handler in src/main/ipc/<domain>.ts and expose it in src/preload.
 */

import type {
  AnalysisCompleteEvent,
  AnalysisErrorEvent,
  AnalysisProgressEvent,
  AnalyticsFilters,
  AnalyticsResult,
  AnalyzedPosition,
  ConfirmedLabels,
  CreateFlashcardInput,
  Flashcard,
  Game,
  GameListItem,
  GamesListFilter,
  ImportGameInput,
  ImportResult,
  ParsePgnResult,
  ReviewAttempt,
  Settings,
  StartAnalysisInput,
  SubmitReviewInput
} from './types'

// ---------------------------------------------------------------------------
// Invoke channels (renderer -> main, request/response)
// ---------------------------------------------------------------------------

export interface IpcChannels {
  // --- Games / PGN import ---------------------------------------------------
  /** Parse raw PGN text (possibly containing many games) into individual games. */
  'games:parsePgn': { request: { pgnText: string }; response: ParsePgnResult }
  /** Read .pgn file(s) from disk and parse them (multi-game aware). */
  'games:parsePgnFiles': { request: { filePaths: string[] }; response: ParsePgnResult }
  /** Persist parsed games; returns import summary. */
  'games:import': { request: { games: ImportGameInput[] }; response: ImportResult }
  /** List games with aggregate blunder counts. */
  'games:list': { request: { filter?: GamesListFilter }; response: GameListItem[] }
  /** Full game detail including PGN. Null if not found. */
  'games:get': { request: { gameId: number }; response: Game | null }
  /** Delete a game and all dependent rows. */
  'games:delete': { request: { gameId: number }; response: void }
  /** Save the editable game-level takeaway note. */
  'games:saveTakeaway': { request: { gameId: number; takeaway: string }; response: void }

  // --- Analysis ---------------------------------------------------------------
  /** Queue games for engine analysis; progress arrives via IpcEvents. */
  'analysis:start': { request: StartAnalysisInput; response: void }
  /** Cancel any in-flight/queued analysis. */
  'analysis:cancel': { request: { gameIds?: number[] }; response: void }
  /** All analyzed positions of a game, in move order. */
  'analysis:getPositions': { request: { gameId: number }; response: AnalyzedPosition[] }
  /** Only flagged positions (blunders + missed punishments) of a game. */
  'analysis:getBlunders': { request: { gameId: number }; response: AnalyzedPosition[] }
  /** Confirm/edit CLAMP/K labels for a flagged position. */
  'analysis:confirmLabels': {
    request: { positionId: number; labels: ConfirmedLabels }
    response: void
  }

  // --- Flashcards / SRS -------------------------------------------------------
  /** Create a flashcard from an analyzed position (auto cloze draft in main). */
  'flashcards:createFromPosition': { request: CreateFlashcardInput; response: Flashcard }
  /** Cards due for review now (dueDate <= now), ordered by dueDate. */
  'flashcards:getDue': { request: { limit?: number }; response: Flashcard[] }
  /** Count of due cards (Dashboard badge). */
  'flashcards:getDueCount': { request: void; response: number }
  /** Submit a completed review; returns the rescheduled card. */
  'flashcards:submitReview': { request: SubmitReviewInput; response: Flashcard }
  /** All review attempts for a card, newest first. */
  'flashcards:getAttempts': { request: { cardId: number }; response: ReviewAttempt[] }

  // --- Analytics ---------------------------------------------------------------
  'analytics:query': { request: { filters?: AnalyticsFilters }; response: AnalyticsResult }

  // --- Settings ----------------------------------------------------------------
  'settings:get': { request: void; response: Settings }
  'settings:set': { request: { patch: Partial<Settings> }; response: Settings }
  'settings:reanalyzeAll': { request: void; response: { queued: number } }
  'settings:exportDatabase': {
    request: void
    response: { exported: boolean; path: string | null }
  }
  'settings:clearDatabase': { request: void; response: void }
}

export type IpcChannel = keyof IpcChannels
export type IpcRequest<C extends IpcChannel> = IpcChannels[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcChannels[C]['response']

// ---------------------------------------------------------------------------
// Event channels (main -> renderer, push)
// ---------------------------------------------------------------------------

export interface IpcEvents {
  'analysis:progress': AnalysisProgressEvent
  'analysis:complete': AnalysisCompleteEvent
  'analysis:error': AnalysisErrorEvent
}

export type IpcEventChannel = keyof IpcEvents
export type IpcEventPayload<C extends IpcEventChannel> = IpcEvents[C]

// ---------------------------------------------------------------------------
// The window.api surface exposed by the preload bridge
// ---------------------------------------------------------------------------

/** Returned by event subscriptions; call to unsubscribe. */
export type Unsubscribe = () => void

export interface BlunderCheckApi {
  games: {
    parsePgn(pgnText: string): Promise<ParsePgnResult>
    parsePgnFiles(filePaths: string[]): Promise<ParsePgnResult>
    import(games: ImportGameInput[]): Promise<ImportResult>
    list(filter?: GamesListFilter): Promise<GameListItem[]>
    get(gameId: number): Promise<Game | null>
    delete(gameId: number): Promise<void>
    saveTakeaway(gameId: number, takeaway: string): Promise<void>
  }
  analysis: {
    start(input: StartAnalysisInput): Promise<void>
    cancel(gameIds?: number[]): Promise<void>
    getPositions(gameId: number): Promise<AnalyzedPosition[]>
    getBlunders(gameId: number): Promise<AnalyzedPosition[]>
    confirmLabels(positionId: number, labels: ConfirmedLabels): Promise<void>
    onProgress(listener: (event: AnalysisProgressEvent) => void): Unsubscribe
    onComplete(listener: (event: AnalysisCompleteEvent) => void): Unsubscribe
    onError(listener: (event: AnalysisErrorEvent) => void): Unsubscribe
  }
  flashcards: {
    createFromPosition(input: CreateFlashcardInput): Promise<Flashcard>
    getDue(limit?: number): Promise<Flashcard[]>
    getDueCount(): Promise<number>
    submitReview(input: SubmitReviewInput): Promise<Flashcard>
    getAttempts(cardId: number): Promise<ReviewAttempt[]>
  }
  analytics: {
    query(filters?: AnalyticsFilters): Promise<AnalyticsResult>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    reanalyzeAll(): Promise<{ queued: number }>
    exportDatabase(): Promise<{ exported: boolean; path: string | null }>
    clearDatabase(): Promise<void>
  }
}
