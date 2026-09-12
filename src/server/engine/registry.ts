/**
 * 任务注册表（mod-003 决策 1、§5.1、§5.3）。
 *
 * - 内存存储，不落库；进程退出即消失（无跨重启恢复）。
 * - LRU + 容量上限：淘汰后旧引用 → `INVALID_INPUT`；淘汰只挑已终结（succeeded / failed / canceled）
 *   的记录，避免把仍在跑的任务从台账里抹掉。
 * - `dataEpoch` 递增（详设 §3.3：更新完成 / 删除完成 / 改判落库 / 迁移完成）即清空注册表，
 *   保证删除后不残留输入文本副本。
 */

import type { Id, SourceRef, TaskOutcome, TaskParams, TaskRef, TaskResult, TaskResultItem, TaskType } from '@shared'

import type { FailureReason } from './errors'

/** 任务级状态（详设 §1.3）。 */
export type TaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

/** 块级状态（任务级没有 `partial`；部分成功只存在于块级台账，mod-003 §5.2）。 */
export type ChunkState = 'pending' | 'running' | 'succeeded' | 'failed'

/** 归一化输入单元：`marker` 是给模型的编号（1..N），`id` 是调用方给的来源标识。 */
export interface NormalizedUnit {
  marker: number
  id: Id
  text: string
}

/** 归一化输入（mod-003 §5.1）。 */
export interface NormalizedInput {
  kind: string
  units: NormalizedUnit[]
}

/** 块台账（mod-003 §5.1 `ChunkRecord`；「只重跑失败分项」的依据）。 */
export interface ChunkRecord {
  /** 块序号（0 起；对外展示用 +1）。 */
  index: number
  /** 本块包含的输入单元编号。 */
  unitMarkers: number[]
  state: ChunkState
  items: TaskResultItem[]
  refs: SourceRef[]
  dropped: number
  unknownRefs: number
  failureReason: FailureReason | null
}

/** 任务失败摘要（重试与镜像需要）。 */
export interface TaskFailureSummary {
  reason: FailureReason
  message: string
}

/** 任务记录（mod-003 §5.1 `TaskRecord`）。 */
export interface TaskRecord {
  taskRef: TaskRef
  /** 重试链来源引用（API-008 产生的记录指回被重试的记录）。 */
  retriedFrom: TaskRef | null
  taskType: TaskType
  input: NormalizedInput
  params: TaskParams
  state: TaskState
  chunks: ChunkRecord[]
  /** 任务内自动重试累计次数。 */
  autoRetries: number
  result: TaskResult | null
  sourceRefs: SourceRef[]
  failure: TaskFailureSummary | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  /** 记录终结时兑现给调用方的结果（executeTask / retryTask 的返回）。 */
  settle: ((outcome: TaskOutcome) => void) | null
  /** 首次执行 / 重试执行的完成承诺（单飞等待用）。 */
  done: Promise<TaskOutcome> | null
  /** 从本记录发起的重试执行的完成承诺（防止同一引用重复入队，§4.1 单飞）。 */
  pendingRetry: Promise<TaskOutcome> | null
}

const SETTLED_STATES: readonly TaskState[] = ['succeeded', 'failed', 'canceled']

/** 任务注册表。 */
export class TaskRegistry {
  #records = new Map<TaskRef, TaskRecord>()
  #capacity: number

  constructor(capacity: number) {
    this.#capacity = capacity
  }

  get size(): number {
    return this.#records.size
  }

  /** 读取并刷新 LRU 位置。 */
  get(ref: TaskRef): TaskRecord | null {
    const record = this.#records.get(ref)
    if (!record) return null
    this.#records.delete(ref)
    this.#records.set(ref, record)
    return record
  }

  /** 登记记录并执行容量淘汰。 */
  set(record: TaskRecord): void {
    this.#records.delete(record.taskRef)
    this.#records.set(record.taskRef, record)
    this.#enforceCapacity()
  }

  /** 全部记录（按登记顺序）。 */
  list(): TaskRecord[] {
    return [...this.#records.values()]
  }

  /** 清空（dataEpoch 变更 / 进程收尾）。 */
  clear(): void {
    this.#records.clear()
  }

  /** dataEpoch 变更：递增即清空注册表；返回是否真的清空。 */
  notifyEpoch(epoch: number): boolean {
    if (epoch === this.#epoch) return false
    this.#epoch = epoch
    this.clear()
    return true
  }

  #epoch: number | null = null

  #enforceCapacity(): void {
    while (this.#records.size > this.#capacity) {
      let evicted = false
      for (const [ref, record] of this.#records) {
        if (SETTLED_STATES.includes(record.state)) {
          this.#records.delete(ref)
          evicted = true
          break
        }
      }
      // 全部在跑时不淘汰（容量上限不会被长期突破：并发 ≤ 8、容量默认 200）。
      if (!evicted) return
    }
  }
}

/** 从失败记录克隆一份「已终结」记录（镜像：API-008 每次调用都返回新的任务引用）。 */
export function cloneSettledRecord(source: TaskRecord, taskRef: TaskRef, now: number): TaskRecord {
  return {
    taskRef,
    retriedFrom: source.taskRef,
    taskType: source.taskType,
    input: { kind: source.input.kind, units: source.input.units.map((unit) => ({ ...unit })) },
    params: source.params,
    state: source.state,
    chunks: source.chunks.map(cloneChunk),
    autoRetries: source.autoRetries,
    result: source.result,
    sourceRefs: [...source.sourceRefs],
    failure: source.failure ? { ...source.failure } : null,
    createdAt: now,
    startedAt: source.startedAt,
    finishedAt: source.finishedAt,
    settle: null,
    done: null,
    pendingRetry: null,
  }
}

/** 构造重试记录：已成功块复用，失败 / 未跑的块重置为 `pending`（决策 4、详设 §2.4）。 */
export function createRetryRecord(source: TaskRecord, taskRef: TaskRef, now: number): TaskRecord {
  return {
    taskRef,
    retriedFrom: source.taskRef,
    taskType: source.taskType,
    input: { kind: source.input.kind, units: source.input.units.map((unit) => ({ ...unit })) },
    params: source.params,
    state: 'queued',
    chunks: source.chunks.map((chunk) => ({
      ...cloneChunk(chunk),
      state: chunk.state === 'succeeded' ? 'succeeded' : 'pending',
    })),
    autoRetries: 0,
    result: null,
    sourceRefs: [],
    failure: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    settle: null,
    done: null,
    pendingRetry: null,
  }
}

function cloneChunk(chunk: ChunkRecord): ChunkRecord {
  return {
    index: chunk.index,
    unitMarkers: [...chunk.unitMarkers],
    state: chunk.state,
    items: chunk.items,
    refs: [...chunk.refs],
    dropped: chunk.dropped,
    unknownRefs: chunk.unknownRefs,
    failureReason: chunk.failureReason,
  }
}
