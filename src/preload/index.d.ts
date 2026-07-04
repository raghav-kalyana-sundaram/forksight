import type { BlunderCheckApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Typed IPC bridge exposed by src/preload/index.ts. */
    api: BlunderCheckApi
  }
}

export {}
