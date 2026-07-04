import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface as RlInterface } from 'node:readline'
import type { Color } from '@shared/types'
import type { EvalOptions, UciEngine, UciEvalResult, UciLine } from './types'
import { consolidateLines, parseBestmove, parseInfoLine } from './uci-parser'

/**
 * Native Stockfish engine driven over UCI via child_process.
 * The user provides a path to the binary in Settings.
 */
export class NativeEngine implements UciEngine {
  private proc: ChildProcess | null = null
  private rl: RlInterface | null = null
  private lineHandler: ((line: string) => void) | null = null
  private evalLock = Promise.resolve()
  private lockRelease: (() => void) | null = null

  constructor(private readonly binaryPath: string) {}

  async init(): Promise<void> {
    this.proc = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'ignore']
    })

    this.rl = createInterface({ input: this.proc.stdout! })
    this.rl.on('line', (line: string) => {
      this.lineHandler?.(line)
    })

    this.proc.on('error', (err) => {
      console.error('[native-engine] process error:', err.message)
    })

    await this.sendAndWaitWithTimeout('uci', (line) => line === 'uciok', 15000)
    this.send('setoption name UCI_ShowWDL value false')
    await this.sendAndWaitWithTimeout('isready', (line) => line === 'readyok', 15000)
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
    if (this.proc) {
      this.send('quit')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.proc?.kill('SIGKILL')
          resolve()
        }, 2000)
        this.proc!.on('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      this.rl?.close()
      this.proc = null
      this.rl = null
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

    this.send(`setoption name MultiPV value ${options.multipv}`)
    this.send(`position fen ${fen}`)

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
      this.send(`go movetime ${options.movetimeMs}`)
    })

    return {
      fen,
      lines: consolidateLines(collected),
      bestmove
    }
  }

  private send(cmd: string): void {
    if (!this.proc?.stdin?.writable) throw new Error('Engine process not running')
    this.proc.stdin.write(cmd + '\n')
  }

  private sendAndWaitWithTimeout(
    cmd: string,
    done: (line: string) => boolean,
    timeoutMs: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.lineHandler = null
        reject(new Error(`Engine did not respond to '${cmd}' within ${timeoutMs}ms`))
      }, timeoutMs)

      this.lineHandler = (line: string) => {
        if (done(line)) {
          clearTimeout(timer)
          this.lineHandler = null
          resolve()
        }
      }
      this.send(cmd)
    })
  }
}
