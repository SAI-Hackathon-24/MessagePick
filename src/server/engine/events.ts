/**
 * 任务生命周期事件与只读计数（mod-003 §4.3、决策 9）。
 *
 * - 事件字段对齐详设 §6.2 的 `task.*` 与决策 1 的 SSE「任务状态变更 + 计数」；
 *   队列长度 / 进行中数量只读计数供外壳展示（读取方与展示属外壳，本模块不新增模块间接口）。
 * - 事件与日志**不含消息文本与凭据**（详设 §4.3、§6.1）：这里只承载引用、状态、计数与分类。
 */

import type { ErrorCode, TaskRef, TaskType } from '@shared'

/** 任务级状态（详设 §1.3 / mod-003 §5.2）。 */
export type EngineTaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

/** 事件携带的计数（块计数 / 条目数 / 丢弃量 / 自动重试数）。 */
export interface EngineEventCounts {
  chunks: number
  succeededChunks: number
  failedChunks: number
  items: number
  /** 因来源引用不可解析而被丢弃的条目数（决策 3）。 */
  dropped: number
  /** 无法回指本次输入的引用标记数。 */
  unknownRefs: number
  /** 本次任务内发生的自动重试次数。 */
  autoRetries: number
}

/** 任务生命周期事件（`event` 名对齐详设 §6.2）。 */
export interface EngineTaskEvent {
  event: 'task.enqueue' | 'task.start' | 'task.retry' | 'task.done' | 'task.failed'
  ts: number
  taskRef: TaskRef
  taskType: TaskType
  state: EngineTaskState
  /** 重试类别：自动（调用级）或手动（API-008）。 */
  retryKind?: 'auto' | 'manual'
  /** 重试序号（从 1 开始）。 */
  attempt?: number
  /** 本次自动重试的退避等待（毫秒；手动重试无此字段）。 */
  delayMs?: number
  /** 失败边界：块序号（从 1 开始）。 */
  chunkIndex?: number
  counts?: EngineEventCounts
  durationMs?: number
  code?: ErrorCode
  reason?: string
}

/** 结构化日志条目（详设 §6.1 的子集；写落地由外壳接线）。 */
export interface EngineLogEntry {
  level: 'error' | 'warn' | 'info' | 'debug'
  event: string
  ts: number
  fields: Record<string, unknown>
}

/** 日志出口；默认丢弃（引擎不自行决定日志落点）。 */
export type EngineLogSink = (entry: EngineLogEntry) => void

/** 默认日志出口（no-op）。 */
export function createNoopLogSink(): EngineLogSink {
  return () => {
    /* 日志落点由外壳接线（详设 §6.1）；未接线时不产生输出。 */
  }
}

/** 进程内事件通道（供外壳 SSE 转发）。 */
export class EngineEventChannel {
  #listeners = new Set<(event: EngineTaskEvent) => void>()

  subscribe(listener: (event: EngineTaskEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  publish(event: EngineTaskEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event)
      } catch {
        // 订阅方自身异常不影响任务执行（本模块不为订阅方兜底业务错误）。
      }
    }
  }

  listenerCount(): number {
    return this.#listeners.size
  }
}

/** 进程级默认事件通道。 */
export const engineEvents = new EngineEventChannel()

/** 只读计数：队列长度与进行中数量（mod-003 §4.3）。 */
export interface EngineCounters {
  /** 排队等待信号量的任务数（队列长度）。 */
  queued: number
  /** 已取到信号量、正在执行的任务数（进行中数量）。 */
  running: number
}
