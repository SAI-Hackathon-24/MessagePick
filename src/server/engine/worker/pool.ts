/**
 * worker 池：大响应解析 / 大结果组装（mod-003 §3.1「worker/pool.ts」、决策 7）。
 *
 * - 惰性建立（池上限 `min(2, CPU−1)`）；只在超过阈值时使用（阈值见 `policy/limits.ts`）。
 * - 两线程间只传 `DecodePayload`（文本 + 字段约束 + 编号映射），不带凭据、不含配置。
 * - 崩溃语义：worker 在任务在飞时异常退出 → 该次解析以 `WorkerCrashError` 拒绝 → 映射为可重试失败；
 *   连模块都加载不起来（宿主环境不支持）时**降级为主线程解析**（不因优化路径不可用而让任务失败）。
 * - 崩溃不影响已缓存内容（决策 7 后果）。
 */

import { Worker } from 'node:worker_threads'

import { decodeResponseText, OutputInvalidError } from '../parse/decode'
import type { DecodePayload, DecodeResult } from '../parse/decode'

/** 解析执行器（默认走 worker 池；测试可注入假实现模拟崩溃）。 */
export type DecodeRunner = (payload: DecodePayload) => Promise<DecodeResult>

/** worker 崩溃（→ `ANALYSIS_FAILED` / `WORKER_CRASH`，可自动重试）。 */
export class WorkerCrashError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'WorkerCrashError'
  }
}

interface PooledResponse {
  type?: string
  id?: number
  ok?: boolean
  result?: DecodeResult
  error?: { kind?: string; message?: string }
}

/** 主线程内联解析（小响应常态路径，也是 worker 不可用时的降级路径）。 */
export function createInlineDecodeRunner(): DecodeRunner {
  return async (payload) => decodeResponseText(payload)
}

/** 创建 worker 池（惰性建立，最多 `size` 个）。 */
export function createWorkerPool(options: { size: number }): DecodeRunner {
  const size = Math.max(1, options.size)
  let worker: Worker | null = null
  let degraded = false
  let sequence = 0
  const pending = new Map<number, { resolve: (result: DecodeResult) => void; reject: (error: unknown) => void }>()

  const failAllPending = (): void => {
    for (const [id, entry] of [...pending]) {
      pending.delete(id)
      entry.reject(new WorkerCrashError('解析 worker 崩溃'))
    }
  }

  const handleMessage = (message: PooledResponse): void => {
    if (!message || message.type !== 'decoded' || typeof message.id !== 'number') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok && message.result) {
      entry.resolve(message.result)
      return
    }
    if (message.error?.kind === 'OUTPUT_INVALID') {
      entry.reject(new OutputInvalidError(message.error.message ?? '模型响应解析失败'))
      return
    }
    entry.reject(new WorkerCrashError(message.error?.message ?? '解析 worker 返回异常'))
  }

  const teardown = (): void => {
    worker = null
    failAllPending()
  }

  const ensureWorker = (): boolean => {
    if (worker) return true
    if (degraded) return false
    try {
      const next = new Worker(new URL('./decode-worker.ts', import.meta.url))
      next.unref()
      next.on('message', handleMessage)
      next.on('error', () => {
        if (worker === next) {
          // 没有在飞任务时的错误视为「装不起来」（如宿主不支持该入口）→ 永久降级；有在飞任务则按崩溃处理。
          if (pending.size === 0) degraded = true
          teardown()
        }
      })
      next.on('exit', (code) => {
        if (worker !== next) return
        if (pending.size === 0) {
          worker = null
          if (code !== 0) degraded = true
        } else {
          teardown()
        }
      })
      worker = next
      return true
    } catch {
      degraded = true
      return false
    }
  }

  // 池上限用于未来的多 worker 并行；当前实现按「一次一个解析」串行使用（池上限只作为约束）。
  void size

  return async (payload) => {
    if (!ensureWorker()) return decodeResponseText(payload)
    const current = worker
    if (!current) return decodeResponseText(payload)

    sequence += 1
    const id = sequence
    return await new Promise<DecodeResult>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        current.postMessage({ type: 'decode', id, payload })
      } catch (error) {
        pending.delete(id)
        reject(new WorkerCrashError('解析 worker 不可用', { cause: error }))
      }
    })
  }
}
