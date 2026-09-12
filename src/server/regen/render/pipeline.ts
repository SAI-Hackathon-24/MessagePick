/**
 * 渲染管线（mod-008 §3.1「render/pipeline —— 变体调度、超时、重试」、§4.1 步骤 4、§8 决策 4）。
 *
 * - 逐变体提交（`buildDirectives` 纯函数产出绘制指令 → worker 内 `compose` 合成）→ 回传字节；
 * - 逐变体超时取 `timeouts.renderMs`；失败 / 超时按详设 §2.3 自动重试（「生成」在可重试场景内）；
 * - worker 崩溃 / 异常退出按该变体失败处理（详设 §1.4），主进程不受影响；
 * - 默认 worker 池走 `worker_threads`（池上限 `min(4, CPU-1)`）；测试注入同步直通桩（§7.3）。
 */

import { Worker } from 'node:worker_threads'

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  RENDER_POOL_SIZE,
  RENDER_TIMEOUT_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_JITTER_RATIO,
  RETRY_MAX_DELAY_MS,
} from '../constants'
import { failAnalysis, failTimeout } from '../errors'
import type { ResolvedAsset } from './compose'
import { buildDirectives, type DrawDirective } from './layout'
import type { TemplateMeta } from './registry'

/** 单变体的渲染任务（可结构化克隆；worker 只收参数、回传字节，不落盘、不开库）。 */
export interface RenderJob {
  variantIndex: number
  text: string
  directives: DrawDirective[]
  assets: ResolvedAsset[]
}

/** 渲染池（默认 = worker 池；测试注入同步直通桩）。 */
export interface RenderPool {
  /** 执行一次变体渲染；超时 / 失败由实现按 `timeoutMs` 结束并拒绝。 */
  run(job: RenderJob, options: { timeoutMs: number }): Promise<Uint8Array>
  /** 进程收尾（可选）。 */
  dispose?(): Promise<void> | void
}

/** 渲染产物（字节经主线程交 `MOD-002` 落库 / 落盘，§4.1 步骤 5）。 */
export interface RenderedArtifact {
  variantIndex: number
  text: string
  bytes: Uint8Array
}

/** `renderVariants` 入参（§3.4 签名）。 */
export interface RenderVariantsInput {
  template: TemplateMeta
  texts: readonly string[]
  assets: readonly ResolvedAsset[]
}

/** 编排选项（超时 / 重试 / 休眠可注入；默认取 `constants.ts`）。 */
export interface RenderVariantsOptions {
  pool: RenderPool
  timeoutMs?: number
  /** 单变体总尝试次数（首次 + 自动重试；默认 `1 + AUTO_RETRY_MAX_ATTEMPTS`） */
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  /** 抖动源（默认 `Math.random`；测试注入常量） */
  jitter?: () => number
}

/** 渲染超时（管线内部的判定标记；worker 侧经结构化克隆后按 `name` 判定）。 */
export class RenderTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderTimeoutError'
  }
}

/** 判定是否为超时类失败（跨 worker 边界后类信息丢失，用 `name` 与 `kind` 双判）。 */
export function isRenderTimeout(error: unknown): boolean {
  if (error instanceof RenderTimeoutError) return true
  if (error === null || typeof error !== 'object') return false
  const value = error as { name?: unknown; kind?: unknown }
  return value.name === 'RenderTimeoutError' || value.kind === 'timeout'
}

/**
 * 渲染一组文案变体（默认 4 条，由调用方按 `G1_VARIANT_COUNT` 给出）。
 * 全部变体成功才返回；任一失败 / 超时（含重试耗尽）即按 §6 映射抛出，不留半成品。
 */
export async function renderVariants(
  input: RenderVariantsInput,
  options: RenderVariantsOptions,
): Promise<RenderedArtifact[]> {
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS
  const attempts = Math.max(1, options.attempts ?? AUTO_RETRY_MAX_ATTEMPTS + 1)
  const sleep = options.sleep ?? defaultSleep
  const jitter = options.jitter ?? Math.random

  const settled = await Promise.allSettled(
    input.texts.map((text, variantIndex) =>
      renderOne(
        { pool: options.pool, timeoutMs, attempts, sleep, jitter },
        {
          variantIndex,
          text,
          directives: buildDirectives(input.template, [text]),
          assets: [...input.assets],
        },
      ),
    ),
  )

  const artifacts: RenderedArtifact[] = []
  let firstFailure: { reason: string; error: unknown } | null = null
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      artifacts.push(result.value)
    } else if (firstFailure === null) {
      firstFailure = { reason: 'failed', error: result.reason }
    }
  }
  if (firstFailure !== null) {
    if (isRenderTimeout(firstFailure.error)) {
      failTimeout('渲染超时（自动重试后仍未完成）', { context: { timeoutMs, attempts } })
    }
    failAnalysis('渲染失败（自动重试后仍未完成）', {
      context: {
        attempts,
        error: firstFailure.error instanceof Error ? firstFailure.error.message : String(firstFailure.error),
      },
    })
  }
  return artifacts.sort((left, right) => left.variantIndex - right.variantIndex)
}

/** 单变体：逐次尝试 + 超时兜底 + 退避。 */
async function renderOne(
  context: {
    pool: RenderPool
    timeoutMs: number
    attempts: number
    sleep: (ms: number) => Promise<void>
    jitter: () => number
  },
  job: RenderJob,
): Promise<RenderedArtifact> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= context.attempts; attempt += 1) {
    try {
      const bytes = await withTimeout(context.pool.run(job, { timeoutMs: context.timeoutMs }), context.timeoutMs)
      return { variantIndex: job.variantIndex, text: job.text, bytes }
    } catch (error) {
      lastError = error
      if (attempt < context.attempts) {
        await context.sleep(backoffDelayMs(attempt, context.jitter))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 自动重试退避（1 s → 2 s → 4 s，上限 30 s，±20% 抖动；详设 §2.3）。 */
export function backoffDelayMs(attempt: number, jitter: () => number): number {
  const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1))
  const ratio = 1 + (jitter() * 2 - 1) * RETRY_JITTER_RATIO
  return Math.max(0, Math.round(base * ratio))
}

/** 超时兜底（池实现未在时限内结束时由本层结束该变体；池内部的清理由其自行保证）。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!(timeoutMs > 0)) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RenderTimeoutError(`渲染超过 ${timeoutMs} ms 未完成`)), timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

// ---------------------------------------------------------------------------
// 默认实现：worker_threads 池（池上限 min(4, CPU-1)，详设 §1.2）
// ---------------------------------------------------------------------------

/** worker 池选项（测试 / 排障可注入；默认随应用打包的 `render.worker.ts`）。 */
export interface WorkerPoolOptions {
  size?: number
  workerFile?: URL
}

interface QueuedJob {
  job: RenderJob
  timeoutMs: number
  resolve: (bytes: Uint8Array) => void
  reject: (error: Error) => void
}

interface WorkerResponse {
  id: number
  ok: boolean
  bytes?: Uint8Array
  error?: string
  kind?: string
}

let sequence = 0

/**
 * 构造 worker 池（懒启动；崩溃 / 超时的 worker 被丢弃并在下次任务时重建）。
 * 注意：worker 文件是 TypeScript 源文件，由运行器（tsx）注册的加载器转译。
 */
export function createWorkerPool(options: WorkerPoolOptions = {}): RenderPool {
  const size = Math.max(1, options.size ?? RENDER_POOL_SIZE)
  const workerFile = options.workerFile ?? new URL('./render.worker.ts', import.meta.url)
  const idle: Worker[] = []
  const busyWorkers = new Set<Worker>()
  const queue: QueuedJob[] = []
  let created = 0

  const spawn = (): Worker => {
    created += 1
    return new Worker(workerFile)
  }

  const nextWorker = (): Worker | null => {
    const recycled = idle.shift()
    if (recycled !== undefined) return recycled
    if (created < size) return spawn()
    return null
  }

  const pump = (): void => {
    while (queue.length > 0) {
      const worker = nextWorker()
      if (worker === null) return
      const entry = queue.shift()!
      startJob(worker, entry)
    }
  }

  const release = (worker: Worker): void => {
    busyWorkers.delete(worker)
    if (worker !== null) idle.push(worker)
    pump()
  }

  const drop = (worker: Worker): void => {
    busyWorkers.delete(worker)
    void worker.terminate().catch(() => undefined)
    pump()
  }

  const startJob = (worker: Worker, entry: QueuedJob): void => {
    busyWorkers.add(worker)
    const id = ++sequence
    let finished = false
    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      drop(worker)
      entry.reject(new RenderTimeoutError(`渲染超过 ${entry.timeoutMs} ms 未完成（worker 已终止）`))
    }, entry.timeoutMs)
    timer.unref?.()

    const onMessage = (message: WorkerResponse): void => {
      if (message === null || typeof message !== 'object' || message.id !== id) return
      if (finished) return
      finished = true
      cleanup()
      if (message.ok && message.bytes !== undefined) {
        release(worker)
        entry.resolve(toBytes(message.bytes))
      } else {
        release(worker)
        entry.reject(new Error(message.error ?? '渲染 worker 返回失败'))
      }
    }
    const onError = (error: Error): void => {
      if (finished) return
      finished = true
      cleanup()
      drop(worker)
      entry.reject(error)
    }
    const onExit = (code: number): void => {
      if (finished) return
      finished = true
      cleanup()
      drop(worker)
      entry.reject(new Error(`渲染 worker 异常退出（code=${code}）`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
    worker.postMessage({ id, directives: entry.job.directives, assets: entry.job.assets })
  }

  return {
    run(job, runOptions) {
      return new Promise<Uint8Array>((resolve, reject) => {
        const entry: QueuedJob = { job, timeoutMs: runOptions.timeoutMs, resolve, reject }
        const worker = nextWorker()
        if (worker === null && queue.length >= size * 4) {
          // 队列护栏：极端积压时直接拒绝，避免无限排队（调用方按失败重试）
          reject(new Error('渲染队列积压过多'))
          return
        }
        if (worker === null) {
          queue.push(entry)
          return
        }
        startJob(worker, entry)
      })
    },
    async dispose() {
      for (const worker of [...idle, ...busyWorkers]) {
        void worker.terminate().catch(() => undefined)
      }
      idle.length = 0
      busyWorkers.clear()
      queue.length = 0
    },
  }
}

/** 结构化克隆回传的字节归一化（worker 可能回传 Buffer / 数组形态）。 */
function toBytes(value: Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
}
