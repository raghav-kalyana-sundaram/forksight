import { listGameIdsByStatus } from '../db/dao/games'
import { getSettings, setSettings } from '../db/dao/settings'
import { queueAnalysis } from '../analysis'
import { handle } from './typed'
import { registerDataHandlers } from './games'

export function registerSettingsHandlers(): void {
  handle('settings:get', () => getSettings())

  handle('settings:set', ({ patch }) => setSettings(patch))

  handle('settings:reanalyzeAll', () => {
    const ids = listGameIdsByStatus(['analyzed', 'pending'])
    if (ids.length > 0) queueAnalysis(ids)
    return { queued: ids.length }
  })

  registerDataHandlers()
}
