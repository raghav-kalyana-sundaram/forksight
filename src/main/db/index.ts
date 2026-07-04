import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { migrations } from './migrations'

let db: Database.Database | null = null

/**
 * Resolve the database file path.
 * Override with the BLUNDERCHECK_DB_PATH env var (useful for tests);
 * otherwise it lives in the Electron userData directory.
 */
export function resolveDbPath(): string {
  const override = process.env.BLUNDERCHECK_DB_PATH
  if (override && override.length > 0) return override
  return join(app.getPath('userData'), 'blundercheck.sqlite3')
}

/** Open the database and run any pending migrations. Idempotent. */
export function initDatabase(): Database.Database {
  if (db) return db

  const dbPath = resolveDbPath()
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)
  return db
}

function runMigrations(database: Database.Database): void {
  const currentVersion = database.pragma('user_version', { simple: true }) as number
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    const apply = database.transaction(() => {
      database.exec(migration.sql)
      database.pragma(`user_version = ${migration.version}`)
    })
    apply()
    console.log(`[db] applied migration ${migration.version} (${migration.name})`)
  }
}

/** The open database handle. initDatabase() must have been called first. */
export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
