import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  BlunderCheckApi,
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
  Unsubscribe
} from '@shared/ipc'

function invoke<C extends IpcChannel>(channel: C, request: IpcRequest<C>): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, request)
}

function subscribe<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void
): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, payload: IpcEventPayload<C>): void =>
    listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: BlunderCheckApi = {
  games: {
    parsePgn: (pgnText) => invoke('games:parsePgn', { pgnText }),
    parsePgnFiles: (filePaths) => invoke('games:parsePgnFiles', { filePaths }),
    import: (games) => invoke('games:import', { games }),
    list: (filter) => invoke('games:list', { filter }),
    get: (gameId) => invoke('games:get', { gameId }),
    delete: (gameId) => invoke('games:delete', { gameId }),
    saveTakeaway: (gameId, takeaway) => invoke('games:saveTakeaway', { gameId, takeaway })
  },
  analysis: {
    start: (input) => invoke('analysis:start', input),
    cancel: (gameIds) => invoke('analysis:cancel', { gameIds }),
    getPositions: (gameId) => invoke('analysis:getPositions', { gameId }),
    getBlunders: (gameId) => invoke('analysis:getBlunders', { gameId }),
    confirmLabels: (positionId, labels) => invoke('analysis:confirmLabels', { positionId, labels }),
    onProgress: (listener) => subscribe('analysis:progress', listener),
    onComplete: (listener) => subscribe('analysis:complete', listener),
    onError: (listener) => subscribe('analysis:error', listener)
  },
  flashcards: {
    createFromPosition: (input) => invoke('flashcards:createFromPosition', input),
    getDue: (limit) => invoke('flashcards:getDue', { limit }),
    getDueCount: () => invoke('flashcards:getDueCount', undefined),
    submitReview: (input) => invoke('flashcards:submitReview', input),
    getAttempts: (cardId) => invoke('flashcards:getAttempts', { cardId })
  },
  analytics: {
    query: (filters) => invoke('analytics:query', { filters })
  },
  settings: {
    get: () => invoke('settings:get', undefined),
    set: (patch) => invoke('settings:set', { patch }),
    reanalyzeAll: () => invoke('settings:reanalyzeAll', undefined),
    exportDatabase: () => invoke('settings:exportDatabase', undefined),
    clearDatabase: () => invoke('settings:clearDatabase', undefined)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Fallback when context isolation is disabled (not the default).
  ;(window as unknown as { api: BlunderCheckApi }).api = api
}
