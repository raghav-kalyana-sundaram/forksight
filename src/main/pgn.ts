import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Chess } from 'chess.js'
import type { Color, GameResult, ParsedPgnGame, ParseFailure, ParsePgnResult } from '@shared/types'

const RESULTS: GameResult[] = ['1-0', '0-1', '1/2-1/2', '*']

interface OpeningEntry {
  eco: string
  name: string
  pgn: string
  normalized: string
}

let openingIndex: OpeningEntry[] | null = null

function resolveOpeningsPath(): string {
  const candidates = [
    join(__dirname, 'data/chess-openings.tsv'),
    join(__dirname, '../data/chess-openings.tsv'),
    join(process.cwd(), 'src/main/data/chess-openings.tsv')
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  throw new Error('chess-openings.tsv not found')
}

function loadOpeningIndex(): OpeningEntry[] {
  if (openingIndex) return openingIndex
  const raw = readFileSync(resolveOpeningsPath(), 'utf-8')
  const lines = raw.split('\n').slice(1)
  openingIndex = lines
    .map((line) => {
      const tab = line.indexOf('\t')
      if (tab < 0) return null
      const eco = line.slice(0, tab)
      const rest = line.slice(tab + 1)
      const tab2 = rest.indexOf('\t')
      if (tab2 < 0) return null
      const name = rest.slice(0, tab2)
      const pgn = rest.slice(tab2 + 1).trim()
      if (!pgn) return null
      return {
        eco,
        name,
        pgn,
        normalized: normalizeMovetextPrefix(pgn)
      }
    })
    .filter((e): e is OpeningEntry => e != null)
    .sort((a, b) => b.normalized.length - a.normalized.length)
  return openingIndex
}

/** Normalize movetext for hashing / prefix matching (SAN, lowercase, no result). */
export function normalizeMovetext(pgn: string): string {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn)
  } catch {
    return pgn
      .replace(/\{[^}]*\}/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\d+\./g, '')
      .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  }
  return chess
    .history()
    .join(' ')
    .trim()
    .toLowerCase()
}

function normalizeMovetextPrefix(movetext: string): string {
  return movetext
    .replace(/\d+\./g, '')
    .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function hashMovetext(pgn: string): string {
  return createHash('sha256').update(normalizeMovetext(pgn)).digest('hex')
}

/** Longest-prefix match against bundled ECO dataset. */
export function detectOpeningFromMovetext(pgn: string): { eco: string; name: string } | null {
  const prefix = normalizeMovetext(pgn)
  if (!prefix) return null
  for (const entry of loadOpeningIndex()) {
    if (prefix.startsWith(entry.normalized)) {
      return { eco: entry.eco, name: entry.name }
    }
  }
  return null
}

/**
 * Split raw PGN text that may contain multiple games into individual
 * single-game PGN strings. A new game starts at a tag-pair block that
 * follows movetext.
 */
export function splitMultiGamePgn(pgnText: string): string[] {
  const lines = pgnText.replace(/\r\n/g, '\n').split('\n')
  const games: string[] = []
  let current: string[] = []
  let seenMovetext = false

  for (const line of lines) {
    const trimmed = line.trim()
    const isTagLine = trimmed.startsWith('[') && trimmed.endsWith(']')

    if (isTagLine && seenMovetext) {
      games.push(current.join('\n').trim())
      current = []
      seenMovetext = false
    }
    if (trimmed.length > 0 && !isTagLine) {
      seenMovetext = true
    }
    current.push(line)
  }

  const last = current.join('\n').trim()
  if (last.length > 0) games.push(last)
  return games.filter((g) => g.length > 0)
}

function normalizeHeader(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed === '?' || trimmed === '????.??.??') return null
  return trimmed
}

/**
 * Detect which color the app user played by matching White/Black headers
 * against saved username aliases plus explicit Lichess/Chess.com usernames (case-insensitive).
 */
export function detectUserColor(
  white: string | null,
  black: string | null,
  aliases: string[],
  lichessUsername?: string,
  chesscomUsername?: string
): Color | null {
  const lowered = aliases.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0)
  if (lichessUsername?.trim()) lowered.push(lichessUsername.trim().toLowerCase())
  if (chesscomUsername?.trim()) lowered.push(chesscomUsername.trim().toLowerCase())

  if (white && lowered.includes(white.toLowerCase())) return 'white'
  if (black && lowered.includes(black.toLowerCase())) return 'black'
  return null
}

function resolveOpeningName(headers: Record<string, string>, pgn: string): string | null {
  const fromHeader =
    normalizeHeader(headers.Opening) ?? normalizeHeader(headers.ECOUrl) ?? normalizeHeader(headers.ECO)
  if (fromHeader) return fromHeader
  const detected = detectOpeningFromMovetext(pgn)
  return detected ? `${detected.eco} ${detected.name}` : null
}

/**
 * Parse a single-game PGN into headers + metadata.
 * Throws if chess.js cannot parse the movetext.
 */
export function parseSingleGamePgn(
  pgn: string,
  aliases: string[],
  lichessUsername?: string,
  chesscomUsername?: string
): ParsedPgnGame {
  const chess = new Chess()
  chess.loadPgn(pgn)

  const headers = chess.getHeaders()
  const white = normalizeHeader(headers.White)
  const black = normalizeHeader(headers.Black)
  const resultHeader = normalizeHeader(headers.Result)
  const result = RESULTS.includes(resultHeader as GameResult) ? (resultHeader as GameResult) : null

  const halfMoves = chess.history().length

  return {
    pgn: pgn.trim(),
    date: normalizeHeader(headers.Date ?? headers.UTCDate),
    event: normalizeHeader(headers.Event),
    white,
    black,
    result,
    timeControl: normalizeHeader(headers.TimeControl),
    openingName: resolveOpeningName(headers, pgn),
    moveCount: Math.ceil(halfMoves / 2),
    detectedUserColor: detectUserColor(white, black, aliases, lichessUsername, chesscomUsername)
  }
}

/**
 * Parse raw PGN text (possibly multi-game). Unparseable games are collected
 * as parseFailures rather than failing the whole batch.
 */
export function parsePgnText(
  pgnText: string,
  aliases: string[],
  lichessUsername?: string,
  chesscomUsername?: string
): ParsePgnResult {
  const games: ParsedPgnGame[] = []
  const parseFailures: ParseFailure[] = []
  const singles = splitMultiGamePgn(pgnText)

  for (let i = 0; i < singles.length; i++) {
    try {
      games.push(parseSingleGamePgn(singles[i], aliases, lichessUsername, chesscomUsername))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      parseFailures.push({ index: i, reason })
      console.warn('[pgn] skipping unparseable game:', reason)
    }
  }

  return { games, parseFailures }
}

/** Backfill opening name from movetext when headers are missing. */
export function backfillOpeningName(pgn: string, currentName: string | null): string | null {
  if (currentName) return currentName
  const detected = detectOpeningFromMovetext(pgn)
  return detected ? `${detected.eco} ${detected.name}` : null
}
