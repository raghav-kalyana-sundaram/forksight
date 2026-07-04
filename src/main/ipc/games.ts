import { copyFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dialog } from 'electron'
import type { ImportResult } from '@shared/types'
import {
  buildGameMetadataFromPgn,
  clearAllData,
  deleteGame,
  getGame,
  insertGame,
  listGames,
  updateGameTakeaway
} from '../db/dao/games'
import { getSettings } from '../db/dao/settings'
import { getDb, resolveDbPath } from '../db'
import { parsePgnText, parseSingleGamePgn } from '../pgn'
import { handle } from './typed'

export function registerGamesHandlers(): void {
  handle('games:parsePgn', ({ pgnText }) => {
    const { usernameAliases, lichessUsername, chesscomUsername } = getSettings()
    return parsePgnText(pgnText, usernameAliases, lichessUsername, chesscomUsername)
  })

  handle('games:parsePgnFiles', async ({ filePaths }) => {
    const { usernameAliases, lichessUsername, chesscomUsername } = getSettings()
    const contents = await Promise.all(filePaths.map((path) => readFile(path, 'utf-8')))
    const games = contents.flatMap(
      (text) => parsePgnText(text, usernameAliases, lichessUsername, chesscomUsername).games
    )
    const parseFailures = contents.flatMap(
      (text, fileIdx) =>
        parsePgnText(text, usernameAliases, lichessUsername, chesscomUsername).parseFailures.map(
          (f) => ({ ...f, index: fileIdx * 1000 + f.index })
        )
    )
    return { games, parseFailures }
  })

  handle('games:import', ({ games }): ImportResult => {
    const { usernameAliases, lichessUsername, chesscomUsername } = getSettings()
    const imported: ImportResult['imported'] = []
    const parseFailures: ImportResult['parseFailures'] = []
    let duplicatesSkipped = 0

    for (let i = 0; i < games.length; i++) {
      const input = games[i]
      try {
        const meta = parseSingleGamePgn(input.pgn, usernameAliases, lichessUsername, chesscomUsername)
        const fullMeta = buildGameMetadataFromPgn(input.pgn, {
          date: meta.date,
          event: meta.event,
          white: meta.white,
          black: meta.black,
          result: meta.result,
          timeControl: meta.timeControl,
          openingName: meta.openingName,
          moveCount: meta.moveCount
        })
        const game = insertGame(input, fullMeta)
        if (game) imported.push(game)
        else duplicatesSkipped++
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        parseFailures.push({ index: i, reason })
      }
    }

    return { imported, duplicatesSkipped, parseFailures }
  })

  handle('games:list', ({ filter } = { filter: undefined }) => listGames(filter))

  handle('games:get', ({ gameId }) => getGame(gameId))

  handle('games:delete', ({ gameId }) => {
    deleteGame(gameId)
  })

  handle('games:saveTakeaway', ({ gameId, takeaway }) => {
    updateGameTakeaway(gameId, takeaway)
  })
}

export function registerDataHandlers(): void {
  handle('settings:exportDatabase', async () => {
    const dbPath = resolveDbPath()
    if (!existsSync(dbPath)) throw new Error('Database file not found.')
    const result = await dialog.showSaveDialog({
      title: 'Export BlunderCheck Database',
      defaultPath: `blundercheck-export-${new Date().toISOString().slice(0, 10)}.sqlite3`,
      filters: [{ name: 'SQLite Database', extensions: ['sqlite3', 'db'] }]
    })
    if (result.canceled || !result.filePath) return { exported: false, path: null as string | null }
    // Flush the WAL into the main DB file so the copied file is complete.
    getDb().pragma('wal_checkpoint(TRUNCATE)')
    copyFileSync(dbPath, result.filePath)
    return { exported: true, path: result.filePath }
  })

  handle('settings:clearDatabase', () => {
    clearAllData()
  })
}
