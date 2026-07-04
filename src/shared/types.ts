/**
 * Shared domain types for BlunderCheck.
 *
 * These types are the single source of truth used by the main process
 * (DB layer + IPC handlers), the preload bridge, and the renderer.
 * All engine evaluations are centipawns as integers, from White's
 * perspective; mate scores are clamped to +/- MATE_CP.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Color = 'white' | 'black'

/** Centipawn value used to represent forced mate (clamped). */
export const MATE_CP = 10000

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*'

export type AnalysisStatus = 'pending' | 'queued' | 'analyzing' | 'analyzed' | 'error'

export type AnalysisPreset = 'fast' | 'balanced' | 'deep'

/** Approximate engine movetime per position, per preset (ms). Tunable in Settings. */
export const PRESET_MOVETIME_MS: Record<AnalysisPreset, number> = {
  fast: 150,
  balanced: 400,
  deep: 1200
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame'

// ---------------------------------------------------------------------------
// CLAMP/K labels
// ---------------------------------------------------------------------------

/**
 * CLAMP/K blunder-cause taxonomy:
 * Checks, Loose pieces, Alignments, Mobility, Passed pawns, King safety.
 */
export enum ClampKLabel {
  Checks = 'checks',
  LoosePieces = 'loose_pieces',
  Alignments = 'alignments',
  Mobility = 'mobility',
  PassedPawns = 'passed_pawns',
  KingSafety = 'king_safety'
}

export const ALL_CLAMPK_LABELS: ClampKLabel[] = [
  ClampKLabel.Checks,
  ClampKLabel.LoosePieces,
  ClampKLabel.Alignments,
  ClampKLabel.Mobility,
  ClampKLabel.PassedPawns,
  ClampKLabel.KingSafety
]

/** A suggested label with heuristic confidence, ranked (highest first). */
export interface SuggestedLabel {
  label: ClampKLabel
  /** 0..1 heuristic confidence used for ranking. */
  confidence: number
}

/** User-confirmed labels: exactly one primary, up to two secondary. */
export interface ConfirmedLabels {
  primary: ClampKLabel
  secondary: ClampKLabel[]
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export interface Game {
  id: number
  pgn: string
  /** Where the game came from, e.g. 'paste', 'file', 'chess.com', 'lichess'. */
  source: string | null
  /** PGN Date header, ISO-ish 'YYYY.MM.DD' or normalized 'YYYY-MM-DD'. */
  date: string | null
  event: string | null
  white: string | null
  black: string | null
  /** Which side the app user played, if known. */
  userColor: Color | null
  result: GameResult | null
  timeControl: string | null
  openingName: string | null
  analysisStatus: AnalysisStatus
  moveCount: number
  /** Game-level takeaway note drafted on the Review screen. */
  takeaway: string | null
  /** Engine preset used for the last successful analysis. */
  analysisPreset: AnalysisPreset | null
  /** ISO timestamp of when analysis last completed successfully. */
  analyzedAt: string | null
  /** SHA-256 of normalized movetext for duplicate detection. */
  movetextHash: string | null
  /** ISO timestamp of when the game was imported. */
  createdAt: string
}

/** Games list row: Game plus aggregate counts for the list screen. */
export interface GameListItem extends Omit<Game, 'pgn'> {
  blunderCount: number
  missedPunishmentCount: number
}

/** One game extracted from a (possibly multi-game) PGN, pre-import. */
export interface ParsedPgnGame {
  /** The single-game PGN text (headers + movetext). */
  pgn: string
  date: string | null
  event: string | null
  white: string | null
  black: string | null
  result: GameResult | null
  timeControl: string | null
  openingName: string | null
  moveCount: number
  /** Auto-detected from saved username aliases; null if no alias matched. */
  detectedUserColor: Color | null
}

/** Input to actually save a parsed game (user confirms/overrides color). */
export interface ImportGameInput {
  pgn: string
  source: string | null
  userColor: Color | null
}

export interface GamesListFilter {
  analysisStatus?: AnalysisStatus
  /** Substring match against white/black/event. */
  search?: string
  color?: Color
  result?: GameResult
  /** When true, only games with at least one blunder or missed punishment. */
  hasBlunders?: boolean
  /** When true, only analyzed games; when false, only non-analyzed. */
  analyzed?: boolean
}

export interface ParseFailure {
  index: number
  reason: string
}

export interface ParsePgnResult {
  games: ParsedPgnGame[]
  parseFailures: ParseFailure[]
}

export interface ImportResult {
  imported: Game[]
  duplicatesSkipped: number
  parseFailures: ParseFailure[]
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export interface AnalyzedPosition {
  id: number
  gameId: number
  /** FEN before the played move. */
  fen: string
  /** Full-move number (as in SAN numbering). */
  moveNumber: number
  sideToMove: Color
  /** Move actually played, SAN. */
  playedMove: string
  /** Engine best move, SAN. */
  bestMove: string | null
  /** Principal variation (SAN moves) for the best move. */
  engineLine: string[]
  /** Eval before the played move, centipawns, White's perspective. */
  evalBefore: number | null
  /** Eval after the played move, centipawns, White's perspective. */
  evalAfter: number | null
  /** Loss vs best move from the mover's perspective, centipawns (>= 0). */
  evalLoss: number | null
  isBlunder: boolean
  isMissedPunishment: boolean
  /** Heuristic CLAMP/K suggestions, ranked, up to 3. */
  suggestedLabels: SuggestedLabel[]
  /** User-confirmed labels, null until confirmed. */
  confirmedLabels: ConfirmedLabels | null
  /** MultiPV-gap critical position candidate. */
  isCritical: boolean
  savedAsCard: boolean
}

/**
 * Input used by the analysis pipeline to persist a position.
 * (Everything except the DB-assigned id.)
 */
export type NewPosition = Omit<AnalyzedPosition, 'id'>

// ---------------------------------------------------------------------------
// Flashcards & spaced repetition
// ---------------------------------------------------------------------------

export type CardState = 'new' | 'learning' | 'review'

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface Flashcard {
  id: number
  positionId: number
  fen: string
  /** Canonical correct move, SAN. */
  correctMove: string
  /** Alternative moves also accepted as correct, SAN. */
  acceptedMoves: string[]
  /** The move actually played (the blunder), SAN. */
  playedMove: string
  /** Which side the user played in the original game. */
  userColor: Color | null
  /** Full-move number of the position in the source game. */
  moveNumber: number
  /** White player name from the source game. */
  gameWhite: string | null
  /** Black player name from the source game. */
  gameBlack: string | null
  /** Time control of the source game. */
  timeControl: string | null
  /** Opening name of the source game. */
  openingName: string | null
  /** Source game id for navigation. */
  gameId: number | null
  /** Engine PV for hints/reveal, SAN moves. */
  engineLine: string[]
  /** Top CLAMP/K suggestion for progressive hints. */
  topSuggestedLabel: ClampKLabel | null
  labels: ConfirmedLabels | null
  clozePrompt: string | null
  clozeAnswer: string | null
  takeaway: string | null
  intervalDays: number
  ease: number
  /** ISO timestamp; card is due when dueDate <= now. */
  dueDate: string
  lapses: number
  state: CardState
}

/** Optional overrides when creating a card from a position. */
export interface CreateFlashcardInput {
  positionId: number
  correctMove?: string
  acceptedMoves?: string[]
  labels?: ConfirmedLabels
  clozePrompt?: string
  clozeAnswer?: string
  takeaway?: string
}

export interface ReviewAttempt {
  id: number
  cardId: number
  /** ISO timestamp. */
  reviewedAt: string
  moveAttempted: string | null
  moveCorrect: boolean | null
  /** Labels the user answered in step 1 of the card flow. */
  labelsAnswer: ClampKLabel[] | null
  labelsCorrect: boolean | null
  clozeAnswer: string | null
  rating: ReviewRating
  timeSpentMs: number | null
}

/** Payload for submitting a completed review of a due card. */
export interface SubmitReviewInput {
  cardId: number
  rating: ReviewRating
  moveAttempted?: string
  moveCorrect?: boolean
  labelsAnswer?: ClampKLabel[]
  labelsCorrect?: boolean
  clozeAnswer?: string
  timeSpentMs?: number
}

// ---------------------------------------------------------------------------
// Analysis events
// ---------------------------------------------------------------------------

export interface StartAnalysisInput {
  gameIds: number[]
  /** Defaults to the preset in Settings. */
  preset?: AnalysisPreset
}

export interface AnalysisProgressEvent {
  gameId: number
  /** Positions evaluated so far in this game. */
  positionsAnalyzed: number
  totalPositions: number
  /** 0..1 across the whole queued batch, if known. */
  batchProgress: number | null
}

export interface AnalysisCompleteEvent {
  gameId: number
  blunderCount: number
  missedPunishmentCount: number
  criticalCount: number
}

export interface AnalysisErrorEvent {
  gameId: number
  message: string
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type BlunderKind = 'blunder' | 'missed_punishment'

export interface AnalyticsFilters {
  /** Match against games.time_control (exact). */
  timeControl?: string
  color?: Color
  /** ISO date (inclusive). */
  dateFrom?: string
  /** ISO date (inclusive). */
  dateTo?: string
  blunderType?: BlunderKind
  gamePhase?: GamePhase
}

export interface LabelBreakdownEntry {
  label: ClampKLabel
  count: number
}

export interface RetentionByLabelEntry {
  label: ClampKLabel
  attempts: number
  correct: number
  /** correct / attempts, 0..1; null when attempts === 0. */
  retention: number | null
}

export interface PhaseBreakdownEntry {
  phase: GamePhase
  count: number
}

export interface AnalyticsResult {
  totalGames: number
  totalBlunders: number
  totalMissedPunishments: number
  blundersPerGame: number | null
  /** Average eval loss across flagged positions, centipawns. */
  avgEvalLossCp: number | null
  labelBreakdown: LabelBreakdownEntry[]
  retentionByLabel: RetentionByLabelEntry[]
  blundersByPhase: PhaseBreakdownEntry[]
}

export type EvalPerspective = 'user' | 'white'

export type SeverityTier = 'inaccuracy' | 'mistake' | 'blunder'

export interface SeverityThresholds {
  inaccuracyThresholdCp: number
  mistakeThresholdCp: number
  blunderThresholdCp: number
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  /** Usernames that identify "me" in PGN headers (case-insensitive). */
  usernameAliases: string[]
  /** Lichess username for auto-detecting user color from PGN headers. */
  lichessUsername: string
  /** Chess.com username for auto-detecting user color from PGN headers. */
  chesscomUsername: string
  /** Absolute path to a native Stockfish binary; null = bundled WASM engine. */
  engineBinaryPath: string | null
  analysisPreset: AnalysisPreset
  /** Eval-loss threshold for flagging a blunder, centipawns. */
  blunderThresholdCp: number
  /** Eval-loss threshold for inaccuracy tier (display), centipawns. */
  inaccuracyThresholdCp: number
  /** Eval-loss threshold for mistake tier (display), centipawns. */
  mistakeThresholdCp: number
  /** Show evals from user's perspective vs always White. */
  evalPerspective: EvalPerspective
}

export const DEFAULT_SETTINGS: Settings = {
  usernameAliases: [],
  lichessUsername: '',
  chesscomUsername: '',
  engineBinaryPath: null,
  analysisPreset: 'balanced',
  blunderThresholdCp: 200,
  inaccuracyThresholdCp: 50,
  mistakeThresholdCp: 100,
  evalPerspective: 'user'
}
