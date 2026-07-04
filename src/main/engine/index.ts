import type { UciEngine } from './types'
import { NativeEngine } from './native-engine'
import { WasmEngine } from './wasm-engine'

export type { UciEngine, UciEvalResult, UciLine, EvalOptions } from './types'
export { presetToMovetime } from './types'

let activeEngine: UciEngine | null = null
let engineInitPromise: Promise<UciEngine> | null = null

/**
 * Create (or re-use) the Stockfish engine.
 * Pass `binaryPath` to use a native binary; omit or pass null for bundled WASM.
 */
export async function getEngine(binaryPath?: string | null): Promise<UciEngine> {
  if (activeEngine) return activeEngine
  if (engineInitPromise) return engineInitPromise

  engineInitPromise = (async () => {
    try {
      console.log('[engine] Initializing engine…', binaryPath ? `native: ${binaryPath}` : 'WASM')
      const engine = binaryPath ? new NativeEngine(binaryPath) : new WasmEngine()
      await engine.init()
      activeEngine = engine
      console.log('[engine] Engine initialized successfully')
      return engine
    } catch (err) {
      console.error('[engine] Engine initialization failed:', err)
      engineInitPromise = null
      throw err
    }
  })()

  return engineInitPromise
}

/** Shut down the current engine (call on app quit). */
export async function shutdownEngine(): Promise<void> {
  engineInitPromise = null
  if (activeEngine) {
    await activeEngine.quit()
    activeEngine = null
  }
}

/** Force-recreate the engine (e.g. when engine path setting changes). */
export async function resetEngine(binaryPath?: string | null): Promise<UciEngine> {
  await shutdownEngine()
  return getEngine(binaryPath)
}
