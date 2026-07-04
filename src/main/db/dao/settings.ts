import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { getDb } from '../index'

/**
 * Settings are stored as one row per key with a JSON-encoded value,
 * merged over DEFAULT_SETTINGS on read so new settings get sane defaults.
 */

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]

  const stored: Partial<Settings> = {}
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      ;(stored as Record<string, unknown>)[row.key] = JSON.parse(row.value)
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const db = getDb()
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  )
  const apply = db.transaction((entries: [string, unknown][]) => {
    for (const [key, value] of entries) {
      upsert.run({ key, value: JSON.stringify(value) })
    }
  })
  apply(Object.entries(patch).filter(([key]) => key in DEFAULT_SETTINGS))
  return getSettings()
}
