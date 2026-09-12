/**
 * 解析 worker 池（mod-001 决策 1；详设 §1.1「大 JSON 解析放 worker」、§5.3 瓶颈预判）。
 *
 * - 惰性建立；**只有超过阈值的大输出才下沉**（小输出直接内联，省一次消息往返）。
 * - 线程间只传文本 + 入口名（不带凭据、不含配置）。
 * - 装不起来（宿主不支持该入口）→ 永久降级为内联解析：优化路径不可用不能让采集失败。
 * - 崩溃（有任务在飞时异常退出）→ 该次解析按「输出非法」处理（→ `SOURCE_UNAVAILABLE`，可重试）。
 */

import { Worker } from 'node:worker_threads'

import { createInlineParseRunner, OutputInvalidError, parseByKind, type ParseRunner, type ParseTask } from './parse'

/** 默认下沉阈值：64 KB（低于此长度解析耗时远小于一次消息往返）。 */
export const PARSE_WORKER_THRESHOLD_BYTES = 64 * 1024

interface PooledResponse {
  type?: string
  id?: number
  ok?: boolean
  result?: unknown
  error?: { kind?: string; message?: string }
}

/** 创建解析执行器：大输出走 worker，小输出内联；worker 不可用则永久降级。 */
export function createParsePool(options: { thresholdBytes?: number } = {}): ParseRunner {
  const threshold = options.thresholdBytes ?? PARSE_WORKER_THRESHOLD_BYTES
  const inline = createInlineParseRunner()
  let worker: Worker | null = null
  let degraded = false
  let sequence = 0
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>()

  const failAllPending = (reason: string): void => {
    for (const [id, entry] of [...pending]) {
      pending.delete(id)
      entry.reject(new OutputInvalidError(reason))
    }
  }

  const handleMessage = (message: PooledResponse): void => {
    if (!message || message.type !== 'parsed' || typeof message.id !== 'number') return
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.ok) {
      entry.resolve(message.result)
      return
    }
    entry.reject(new OutputInvalidError(message.error?.message ?? '解析 worker 返回异常'))
  }

  const ensureWorker = (): boolean => {
    if (worker !== null) return true
    if (degraded) return false
    try {
      const next = new Worker(new URL('./parse-worker.ts', import.meta.url))
      next.unref()
      next.on('message', handleMessage)
      next.on('error', () => {
        if (worker === next) {
          if (pending.size === 0) degraded = true
          worker = null
          failAllPending('解析 worker 崩溃')
        }
      })
      next.on('exit', (code) => {
        if (worker !== next) return
        worker = null
        if (pending.size === 0) {
          if (code !== 0) degraded = true
        } else {
          failAllPending('解析 worker 崩溃')
        }
      })
      worker = next
      return true
    } catch {
      degraded = true
      return false
    }
  }

  return async (task: ParseTask) => {
    if (task.text.length <= threshold) return parseByKind(task)
    if (!ensureWorker()) return parseByKind(task)
    const current = worker
    if (current === null) return parseByKind(task)
    sequence += 1
    const id = sequence
    return await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        current.postMessage({ type: 'parse', id, task })
      } catch {
        pending.delete(id)
        reject(new OutputInvalidError('解析 worker 消息发送失败'))
      }
    })
  }
}
