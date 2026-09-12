/**
 * 大结果集聚合（mod-005 §3.1「worker/aggregate.ts」、§3.6、§6）。
 *
 * - 单请求预估记录数 > 阈值（默认 `AGG_WORKER_THRESHOLD`）→ 派 `worker_threads`；
 *   否则主线程分批（≤ 2 000 行 / 批，批间让出事件循环）。
 * - worker 只收 / 回消息数组：不开库、不写盘（详设 §1.1）；本文件在 worker 内只做纯计数与去重。
 * - 崩溃口径（§6）：worker 异常退出 → 主线程分批重试一次；仍失败才上抛 `ANALYSIS_FAILED`。
 */

import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

import type { Id } from '@shared'

import { AGG_WORKER_THRESHOLD, SCAN_BATCH_ROWS } from '../constants'
import { analysisFailed } from '../app/errors'

/** worker 身份标记（只认带本标记的 worker，避免与测试运行器等其它线程混淆）。 */
const WORKER_ROLE = 'meme-aggregate'

/** 聚合输入（纯数据，可结构化克隆）。 */
export interface AggregateInput {
  occurrences: Array<{ memeId: Id; sourceMessageId: Id }>
  /** root 归一化映射（memeId → rootId / null；null = 不可见，剔除）。 */
  rootOf: Record<Id, Id | null>
}

/** 聚合输出：每个 root 的命中次数 + 可见来源消息引用（去重、保持出现顺序）。 */
export interface AggregateOutput {
  counts: Record<Id, number>
  messageIds: Id[]
}

/** 纯聚合（主线程与 worker 共用）。 */
export function aggregateCounts(input: AggregateInput): AggregateOutput {
  const counts: Record<Id, number> = {}
  const messageIds: Id[] = []
  const seen = new Set<Id>()
  for (const occurrence of input.occurrences) {
    const root = input.rootOf[occurrence.memeId]
    if (root === undefined || root === null) continue
    counts[root] = (counts[root] ?? 0) + 1
    if (!seen.has(occurrence.sourceMessageId)) {
      seen.add(occurrence.sourceMessageId)
      messageIds.push(occurrence.sourceMessageId)
    }
  }
  return { counts, messageIds }
}

/** worker 运行器（测试注入替身以模拟崩溃 / 结果）。 */
export type AggregateRunner = (input: AggregateInput) => Promise<AggregateOutput>

/** 派发选项。 */
export interface AggregateOptions {
  /** worker 阈值（默认 `AGG_WORKER_THRESHOLD`）。 */
  threshold?: number
  /** worker 运行器；null = 禁用 worker（全部走主线程）。 */
  runner?: AggregateRunner | null
  /** 主线程分批大小（默认 `SCAN_BATCH_ROWS`）。 */
  batchSize?: number
  /** 告警出口（worker 崩溃降级时记录）。 */
  onWarn?: (event: string, fields?: Record<string, unknown>) => void
  /** 测试注入：替换主线程聚合（用于覆盖「重试仍失败才上抛」）。 */
  mainAggregate?: (input: AggregateInput) => AggregateOutput
  /** 测试注入：批间让出。 */
  yieldBetweenBatches?: () => Promise<void>
}

/**
 * 按阈值选择执行体并完成聚合。
 * worker 失败 → 主线程分批重试一次；仍失败 → 抛 `ANALYSIS_FAILED`（§6）。
 */
export async function aggregateOccurrences(
  input: AggregateInput,
  options: AggregateOptions = {},
): Promise<AggregateOutput> {
  const threshold = options.threshold ?? AGG_WORKER_THRESHOLD
  const runner = options.runner === undefined ? createWorkerAggregateRunner() : options.runner

  if (input.occurrences.length <= threshold || runner === null) {
    return await aggregateOnMainThread(input, options)
  }

  try {
    return await runner(input)
  } catch (error) {
    options.onWarn?.('meme.aggregate.worker-failed', { reason: reasonOf(error) })
    try {
      return await aggregateOnMainThread(input, options)
    } catch {
      throw analysisFailed('meme:aggregate', '大结果集聚合失败：worker 崩溃后主线程重试仍未成功')
    }
  }
}

/** 主线程分批聚合（批间让出事件循环）。 */
export async function aggregateOnMainThread(input: AggregateInput, options: AggregateOptions = {}): Promise<AggregateOutput> {
  const batchSize = Math.max(1, options.batchSize ?? SCAN_BATCH_ROWS)
  const yieldNow = options.yieldBetweenBatches ?? yieldToEventLoop
  const compute = options.mainAggregate ?? aggregateCounts
  const merged: AggregateOutput = { counts: {}, messageIds: [] }
  const seen = new Set<Id>()
  for (let offset = 0; offset < input.occurrences.length; offset += batchSize) {
    const chunk: AggregateInput = {
      occurrences: input.occurrences.slice(offset, offset + batchSize),
      rootOf: input.rootOf,
    }
    const partial = compute(chunk)
    for (const [root, count] of Object.entries(partial.counts)) {
      merged.counts[root] = (merged.counts[root] ?? 0) + count
    }
    for (const messageId of partial.messageIds) {
      if (seen.has(messageId)) continue
      seen.add(messageId)
      merged.messageIds.push(messageId)
    }
    if (offset + batchSize < input.occurrences.length) await yieldNow()
  }
  return merged
}

/** 默认 worker 运行器（失败即 reject；由 `aggregateOccurrences` 降级处理）。 */
export function createWorkerAggregateRunner(): AggregateRunner {
  return (input) =>
    new Promise<AggregateOutput>((resolve, reject) => {
      let worker: Worker
      try {
        worker = new Worker(new URL('./aggregate.ts', import.meta.url), {
          workerData: { role: WORKER_ROLE },
        })
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        void worker.terminate()
        fn()
      }
      worker.once('message', (message: unknown) => {
        const payload = message as { ok?: boolean; result?: AggregateOutput; error?: string }
        if (payload.ok === true && payload.result !== undefined) finish(() => resolve(payload.result as AggregateOutput))
        else finish(() => reject(new Error(payload.error ?? '聚合 worker 返回异常')))
      })
      worker.once('error', (error) => finish(() => reject(error)))
      worker.once('exit', (code) => {
        if (code !== 0) finish(() => reject(new Error(`聚合 worker 异常退出（code=${code}）`)))
      })
      worker.postMessage(input)
    })
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// ---------------------------------------------------------------------------
// worker 入口：带角色标记的 worker 才挂消息处理（避免与其它执行体的消息通道混淆）
// ---------------------------------------------------------------------------

const role = (workerData as { role?: unknown } | null)?.role
if (!isMainThread && parentPort !== null && role === WORKER_ROLE) {
  const port = parentPort
  port.on('message', (message: unknown) => {
    try {
      port.postMessage({ ok: true, result: aggregateCounts(message as AggregateInput) })
    } catch (error) {
      port.postMessage({ ok: false, error: reasonOf(error) })
    }
  })
}
