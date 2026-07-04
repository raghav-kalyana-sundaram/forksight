import type { Color } from '@shared/types'
import type { EvalOptions, UciEngine, UciEvalResult, UciLine } from './types'
import { consolidateLines, parseBestmove, parseInfoLine } from './uci-parser'

interface StockfishInstance {
  sendCommand(cmd: string): void
  listener?: ((line: string) => void) | null
  terminate?(): void
  ccall?(name: string, returnType: null, argTypes: string[], args: string[], opts?: { async?: boolean }): void
}

const ENGINE_INIT_TIMEOUT_MS = 15_000

/**
 * Bundled WASM Stockfish engine (single-threaded build).
 *
 * The stockfish npm package exports an `initEngine(variant?)` factory.
 * The returned engine uses `engine.listener` for output and either
 * `engine.ccall` (direct) or `engine.sendCommand` (deferred) for input.
 *
 * We call `ccall("command", …)` directly for the UCI handshake so the
 * output arrives synchronously — this avoids a timing bug where
 * `sendCommand`'s `setImmediate` wrapper doesn't fire reliably in
 * Electron's main-process event loop.
 */
export class WasmEngine implements UciEngine {
  private engine: StockfishInstance | null = null
  private lineHandler: ((line: string) => void) | null = null
  private evalLock = Promise.resolve()
  private lockRelease: (() => void) | null = null

  async init(): Promise<void> {
    let initEngine: (variant?: string) => Promise<StockfishInstance>
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      initEngine = require('stockfish')
    } catch (err) {
      throw new Error(
        `Failed to load stockfish module: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    if (typeof initEngine !== 'function') {
      throw new Error('Stockfish module did not export the expected factory function')
    }

    let instance: StockfishInstance
    try {
      instance = await initEngine('single')
    } catch (err) {
      throw new Error(
        `Failed to initialize stockfish engine: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    if (!instance || (typeof instance.sendCommand !== 'function' && typeof instance.ccall !== 'function')) {
      throw new Error('Stockfish engine missing sendCommand/ccall — unexpected module format')
    }

    this.engine = instance

    instance.listener = (line: string) => {
      this.lineHandler?.(line)
    }

    console.log('[engine] WASM instance ready, starting UCI handshake…')

    try {
      await this.handshake('uci', (line) => line.trim() === 'uciok')
      console.log('[engine] UCI handshake complete')
      this.sendDirect('setoption name UCI_ShowWDL value false')
      await this.handshake('isready', (line) => line.trim() === 'readyok')
      console.log('[engine] Engine ready')
    } catch (err) {
      this.engine = null
      instance.listener = null
      try { instance.terminate?.() } catch { /* best-effort */ }
      throw err
    }
  }

  async evaluate(fen: string, options: EvalOptions): Promise<UciEvalResult> {
    await this.acquireLock()
    try {
      return await this.doEvaluate(fen, options)
    } finally {
      this.releaseLock()
    }
  }

  async quit(): Promise<void> {
    if (this.engine) {
      try {
        this.sendDirect('quit')
      } catch { /* ignore send errors during quit */ }
      await new Promise<void>((r) => setTimeout(r, 100))
      try {
        this.engine.listener = null
        if (typeof this.engine.terminate === 'function') {
          this.engine.terminate()
        }
      } catch { /* already terminated */ }
      this.engine = null
    }
  }

  private acquireLock(): Promise<void> {
    const prev = this.evalLock
    this.evalLock = new Promise<void>((resolve) => {
      this.lockRelease = resolve
    })
    return prev
  }

  private releaseLock(): void {
    if (this.lockRelease) {
      this.lockRelease()
      this.lockRelease = null
    }
  }

  private async doEvaluate(fen: string, options: EvalOptions): Promise<UciEvalResult> {
    const sideToMove: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black'
    const collected: UciLine[] = []

    this.sendDirect(`setoption name MultiPV value ${options.multipv}`)
    this.sendDirect(`position fen ${fen}`)

    const bestmove = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.lineHandler = null
        reject(new Error(`Engine timed out on fen: ${fen}`))
      }, options.movetimeMs + 10000)

      this.lineHandler = (line: string) => {
        const parsed = parseInfoLine(line, sideToMove)
        if (parsed) {
          collected.push(parsed)
          return
        }
        const bm = parseBestmove(line)
        if (bm) {
          clearTimeout(timeout)
          this.lineHandler = null
          resolve(bm)
        }
      }
      this.sendDeferred(`go movetime ${options.movetimeMs}`)
    })

    return {
      fen,
      lines: consolidateLines(collected),
      bestmove
    }
  }

  /**
   * Send a command directly via ccall — synchronous, no setImmediate.
   * Safe for non-search commands (uci, isready, setoption, position, quit).
   */
  private sendDirect(cmd: string): void {
    if (!this.engine) throw new Error('Engine not initialized')
    const eng = this.engine as StockfishInstance & Record<string, unknown>
    if (typeof eng.ccall === 'function') {
      eng.ccall('command', null, ['string'], [cmd])
    } else {
      eng.sendCommand(cmd)
    }
  }

  /**
   * Send a command with deferred execution via setTimeout.
   * Used for `go` commands where asyncify needs a clean stack frame.
   */
  private sendDeferred(cmd: string): void {
    if (!this.engine) throw new Error('Engine not initialized')
    const eng = this.engine as StockfishInstance & Record<string, unknown>
    if (typeof eng.ccall === 'function') {
      setTimeout(() => {
        eng.ccall!('command', null, ['string'], [cmd], { async: true })
      }, 0)
    } else {
      eng.sendCommand(cmd)
    }
  }

  /**
   * UCI init handshake: send a command via ccall (synchronous) and wait
   * for the expected response line. Because ccall processes the command
   * synchronously, the listener fires during the ccall call itself,
   * eliminating setImmediate timing issues.
   */
  private handshake(
    cmd: string,
    done: (line: string) => boolean
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.lineHandler = null
        reject(new Error(`Engine did not respond to '${cmd}' within ${ENGINE_INIT_TIMEOUT_MS}ms`))
      }, ENGINE_INIT_TIMEOUT_MS)

      this.lineHandler = (line: string) => {
        if (done(line)) {
          clearTimeout(timer)
          this.lineHandler = null
          resolve()
        }
      }

      this.sendDirect(cmd)
    })
  }
}
