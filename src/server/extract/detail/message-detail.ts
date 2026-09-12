/**
 * 消息详情组装（mod-006 §3.1「detail/message-detail.ts —— API-019：heading / 正文组装」、
 * §3.4、§4 API-019、§5.1、§5.2、§7「消息详情」「失败路径」行；详设 §1.1 的 50 ms 护栏）。
 *
 * - heading = 一句话总结 + 来源群 + 排序时间（§5.2：全部来源消息中最早的发送时间，读取时解析）；
 * - 正文 = AI 总结 + 全部来源消息（按发送时间升序，图片 / 表情包引用原样回带 `DM-003` 记录）；
 * - 来源消息部分缺失（被删除）时按剩余组装，不报错、不补占位；条目不存在（含级联删除后）→ `NOT_FOUND`；
 * - 兴趣提示不在此返回（`REQ-070` 由外壳经 `API-029` 另行组装，§4）；
 * - 主线程单次同步计算 ≤ 50 ms（详设 §1.1）：来源消息超过 `DETAIL_WORKER_THRESHOLD`（200）条时改由
 *   worker 组装（本文件内嵌 worker 角色，先例 `meme/worker/aggregate.ts`；worker 只收 / 回纯数据，
 *   不开库、不写盘）；worker 异常 → 降级主线程组装（纯计算，结果不变）。
 */

import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

import type { Id, MessageDetail, RawMessage, Timestamp } from '@shared'

import { DETAIL_WORKER_THRESHOLD } from '../constants'
import { invalidInput, notFound, type ExtractLogger } from '../errors'
import type { EntryRepository } from '../store/entry-repository'

/** worker 身份标记（只认带本标记的 worker，避免与测试运行器等其它线程混淆）。 */
const WORKER_ROLE = 'extract-detail'

// ---------------------------------------------------------------------------
// 入参 / 出参（§3.3：`queryMessageDetail(q: { entryId })`；出参 = 契约 Api019Response）
// ---------------------------------------------------------------------------

/** `API-019` 入参（契约 `Api019Request`）。 */
export interface MessageDetailQueryInput {
  entryId: Id
}

/** 组装输入（纯数据、可结构化克隆；主线程与 worker 共用）。 */
export interface DetailAssemblyInput {
  /** 一句话总结（heading） */
  headline: string
  /** 来源群（heading） */
  groupId: Id
  /** AI 总结（正文） */
  aiSummary: string
  /** 已取回的来源消息（缺项已剔除；组装时按发送时间升序排序） */
  messages: RawMessage[]
}

/** worker 运行器（测试注入替身以模拟崩溃 / 结果；null = 禁用 worker，全部主线程组装）。 */
export type DetailRunner = (input: DetailAssemblyInput) => Promise<MessageDetail>

/** 组装选项（阈值 / worker 运行器 / 告警出口；缺省值来自 `constants.ts`）。 */
export interface MessageDetailOptions {
  /** worker 阈值（来源消息条数；默认 `DETAIL_WORKER_THRESHOLD`）。 */
  threshold?: number
  /** worker 运行器；缺省走 `worker_threads`，`null` = 全部主线程组装。 */
  runner?: DetailRunner | null
  /** 告警出口（worker 崩溃降级时记录；不记消息正文）。 */
  logger?: ExtractLogger
}

// ---------------------------------------------------------------------------
// API-019 查询消息详情
// ---------------------------------------------------------------------------

/**
 * `API-019`：按条目标识组装消息详情。
 *
 * 步骤（§4）：① 标识护栏 → ② 读条目（不存在 → `NOT_FOUND`）→ ③ 批量取回全部来源消息（缺项剔除，
 * 部分缺失按剩余组装）→ ④ 条数超阈值交 worker，否则主线程组装；worker 异常降级主线程。
 */
export async function queryMessageDetail(
  repository: EntryRepository,
  input: MessageDetailQueryInput,
  options: MessageDetailOptions = {},
): Promise<MessageDetail> {
  // ① 标识护栏（更细的 schema 校验属外壳，详设 §4.4）。
  if (typeof input.entryId !== 'string' || input.entryId.length === 0) {
    throw invalidInput('条目标识非法：应为非空字符串', { entryId: input.entryId })
  }

  // ② 读条目：不存在（含全部来源消息被级联删除后的条目消失）→ NOT_FOUND。
  const entry = repository.findEntry(input.entryId)
  if (entry === null) throw notFound('extract:detail', `条目不存在（${input.entryId}）`, { entryId: input.entryId })

  // ③ 批量取回全部来源消息：消息已删则结果中缺项，按剩余组装、不补占位（§4）。
  const found = [...repository.readMessagesByIds(entry.sourceMessageIds, entry.groupId).values()]
  const payload: DetailAssemblyInput = {
    headline: entry.headline,
    groupId: entry.groupId,
    aiSummary: entry.aiSummary,
    messages: found,
  }

  // ④ 阈值判定（详设 §1.1）：≤ 200 条主线程组装；超过交 worker（worker 异常降级主线程）。
  const threshold = options.threshold ?? DETAIL_WORKER_THRESHOLD
  const runner = options.runner === undefined ? createWorkerDetailRunner() : options.runner
  if (found.length <= threshold || runner === null) return assembleDetail(payload)
  try {
    return await runner(payload)
  } catch (error) {
    options.logger?.warn?.('extract.detail.worker-failed', {
      module: 'MOD-006',
      messages: found.length,
      reason: reasonOf(error),
    })
    return assembleDetail(payload)
  }
}

// ---------------------------------------------------------------------------
// 纯组装（主线程与 worker 共用）
// ---------------------------------------------------------------------------

/**
 * 组装详情：正文按发送时间升序（同值按消息标识稳定排序）；heading 时间 = 剩余来源中最早发送时间
 * （全缺 → null，不猜、不填）。
 */
export function assembleDetail(input: DetailAssemblyInput): MessageDetail {
  const sourceMessages = [...input.messages].sort(bySentAt)
  return {
    heading: { headline: input.headline, groupId: input.groupId, time: earliestSentAt(sourceMessages) },
    body: { aiSummary: input.aiSummary, sourceMessages },
  }
}

function bySentAt(a: RawMessage, b: RawMessage): number {
  return a.sentAt - b.sentAt || compareIds(a.messageId, b.messageId)
}

function earliestSentAt(messages: readonly RawMessage[]): Timestamp | null {
  const first = messages[0]
  return first === undefined ? null : first.sentAt
}

// ---------------------------------------------------------------------------
// worker 运行器（默认实现；失败即 reject，由 `queryMessageDetail` 降级处理）
// ---------------------------------------------------------------------------

/** 默认 worker 运行器：单条消息 → 组装结果；异常退出 / 返回异常一律 reject。 */
export function createWorkerDetailRunner(): DetailRunner {
  return (input) =>
    new Promise<MessageDetail>((resolve, reject) => {
      let worker: Worker
      try {
        worker = new Worker(new URL('./message-detail.ts', import.meta.url), {
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
        const payload = message as { ok?: boolean; result?: MessageDetail; error?: string }
        const result = payload.result
        if (payload.ok === true && result !== undefined) finish(() => resolve(result))
        else finish(() => reject(new Error(payload.error ?? '详情 worker 返回异常')))
      })
      worker.once('error', (error) => finish(() => reject(error)))
      worker.once('exit', (code) => {
        if (code !== 0) finish(() => reject(new Error(`详情 worker 异常退出（code=${code}）`)))
      })
      worker.postMessage(input)
    })
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------------------------------------------------------------------------
// worker 入口：带角色标记的 worker 才挂消息处理（避免与其它执行体的消息通道混淆）
// ---------------------------------------------------------------------------

const role = (workerData as { role?: unknown } | null)?.role
if (!isMainThread && parentPort !== null && role === WORKER_ROLE) {
  const port = parentPort
  port.on('message', (message: unknown) => {
    try {
      port.postMessage({ ok: true, result: assembleDetail(message as DetailAssemblyInput) })
    } catch (error) {
      port.postMessage({ ok: false, error: reasonOf(error) })
    }
  })
}
