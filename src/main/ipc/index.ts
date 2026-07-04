import { registerAnalysisHandlers } from './analysis'
import { registerAnalyticsHandlers } from './analytics'
import { registerFlashcardsHandlers } from './flashcards'
import { registerGamesHandlers } from './games'
import { registerSettingsHandlers } from './settings'

/** Register every IPC handler. Call once after the DB is initialized. */
export function registerIpcHandlers(): void {
  registerGamesHandlers()
  registerAnalysisHandlers()
  registerFlashcardsHandlers()
  registerAnalyticsHandlers()
  registerSettingsHandlers()
}
