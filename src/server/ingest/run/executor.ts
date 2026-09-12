/**
 * 单飞执行器（mod-001 §3.1「run/executor.ts」、§3.3、§4.1、决策 2 / 3 / 7）。
 *
 * - **全局互斥**：只有一个运行槽，同一时刻最多一个运行（含分项重试）；
 * - **挂接 / 排队**：重复触发时，本次来源集合 ⊆ 进行中运行的来源集合 → 挂接到进行中运行（返回其运行
 *   结果，不启动第二次采集）；否则入队（FIFO、不设硬上限），前一次结束后执行 —— 两者都不新增错误标识
 *   （决策 2）；
 * - **运行内串行**：两来源按 `INGEST_SOURCE_ORDER` 串行执行，来源内分页串行（决策 3）；
 * - **来源结束时写状态**：每个来源结束即写一次该来源的 `DM-001` 行（决策 7）；运行中的进度只走内存与
 *   进度通道，不落库；
 * - **断点只在进程内**（决策 4）：失败来源的断点保留，**指定来源重试**时复用（窗口随断点带走，保证分页
 *   游标仍然成立）；成功即清除；
 * - **不触发下游分析**：采集完成后不自行调用分析任务（`MOD-004` 编排，HLD 决策 9）。
 */

import type { IngestSource } from '@shared'

import type { Store } from '@server/store'

import {
  failure,
  INGEST_LOG_EVENTS,
  overallCodeOf,
  type IngestFailure,
  type IngestLogger,
  type OverallCode,
} from '../errors'
import {
  contractStatusOf,
  pickSourceFailure,
  statusOfCode,
  type CollectOutcome,
  type SourceAdapter,
  type SourceCheckpoint,
} from '../sources/source'
import { writeSourceStatus } from '../state/source-state'
import type { IngestProgressChannel } from './progress'
import { INGEST_WINDOW_OVERLAP_MS, planSources, planWindow } from './run-plan'

/** 一次运行的请求（§3.3）：省略目标来源 = 全部来源；指定 = 只采集 / 重试该来源。 */
export interface RunRequest {
  targetSource?: IngestSource
}

/** 一次运行的报告（§3.3）：分来源结果 + 批次级标识（全部成功时不给出）。 */
export interface RunReport {
  sources: CollectOutcome[]
  overallCode?: OverallCode
}

/** 执行器出口（§3.3）。 */
export interface IngestExecutor {
  submit(req: RunRequest): Promise<RunReport>
  /** 运行槽是否被占用（含 FIFO 排队；供组合根接线的删除门使用，mod-004 §4.4） */
  isRunning(): boolean
}

export interface IngestExecutorOptions {
  store: Store
  /** 来源适配器表：恰两个来源，无第三个、无演示通道（`REQ-001`、`REQ-019`、`AC-009`） */
  adapters: Readonly<Record<IngestSource, SourceAdapter>>
  /** 进程内时钟（测试注入） */
  clock?: () => number
  logger?: IngestLogger
  /** 进度通道（SSE 传输在 `MOD-004`，§3.1） */
  progress?: IngestProgressChannel
  /** 运行引用生成器（测试注入确定性值） */
  runIdFactory?: () => string
  /** 增量窗口重叠量（默认 5 分钟，模块内常量；决策 4） */
  overlapMs?: number
}

interface QueuedRequest {
  sources: IngestSource[]
  /** 是否指定来源（指定来源的重试复用该来源断点） */
  targeted: boolean
  resolve: (report: RunReport) => void
  reject: (error: unknown) => void
}

interface RunSlot {
  sources: readonly IngestSource[]
  promise: Promise<RunReport>
}

/**
 * 创建单飞执行器。
 *
 * 未知的内部异常不新增错误标识（§6.3）：来源级异常记日志后按 `SOURCE_UNAVAILABLE` 落一条终态，
 * 不打断其余来源；写状态失败按 §6.1 表映射为来源级 `STORAGE_UNAVAILABLE`。
 */
export function createIngestExecutor(options: IngestExecutorOptions): IngestExecutor {
  const { store, adapters } = options
  const clock = options.clock ?? Date.now
  const logger = options.logger
  const progress = options.progress
  const overlapMs = options.overlapMs ?? INGEST_WINDOW_OVERLAP_MS

  let sequence = 0
  const makeRunId = options.runIdFactory ?? (() => `ingest-${++sequence}`)
  /** 进程内断点（不持久化；§5.3、决策 4） */
  const checkpoints = new Map<IngestSource, SourceCheckpoint>()
  /** 运行槽（同一时刻至多一个） + FIFO 队列 */
  let slot: RunSlot | null = null
  const queue: QueuedRequest[] = []

  function isRunning(): boolean {
    // 排队也算「在途」：避免删除与排队中的采集交叉（组合根接线据此等待采集收尾，mod-004 §4.4）
    return slot !== null || queue.length > 0
  }

  function submit(req: RunRequest): Promise<RunReport> {
    const sources = planSources(req.targetSource)
    const targeted = req.targetSource !== undefined
    const current = slot
    if (current !== null) {
      if (sources.every((source) => current.sources.includes(source))) {
        // 挂接：不启动第二次采集，返回被挂接运行的运行结果（决策 2）
        return current.promise
      }
      return new Promise<RunReport>((resolve, reject) => {
        queue.push({ sources, targeted, resolve, reject })
      })
    }
    return start(sources, targeted)
  }

  function start(sources: IngestSource[], targeted: boolean): Promise<RunReport> {
    const promise = execute(sources, targeted)
    slot = { sources, promise }
    // 运行结束 → 让出运行槽并执行队首（FIFO；队列不设硬上限，详设 §1.3）
    void promise.then(settle, settle)
    return promise
  }

  function settle(): void {
    slot = null
    const next = queue.shift()
    if (next === undefined) return
    const promise = start(next.sources, next.targeted)
    promise.then(next.resolve, next.reject)
  }

  async function execute(sources: readonly IngestSource[], targeted: boolean): Promise<RunReport> {
    const runId = makeRunId()
    const startedAt = clock()
    logger?.info?.(INGEST_LOG_EVENTS.start, { module: 'MOD-001', runId, targeted, sources: [...sources] })
    progress?.emit({ kind: 'run', phase: 'start', runId, at: startedAt, sources: [...sources] })

    const outcomes: CollectOutcome[] = []
    for (const source of sources) {
      outcomes.push(await collectSource(source, runId, targeted))
    }

    const overallCode = overallCodeOf(outcomes)
    const report: RunReport = { sources: outcomes, ...(overallCode === undefined ? {} : { overallCode }) }
    logger?.info?.(INGEST_LOG_EVENTS.finish, {
      module: 'MOD-001',
      runId,
      durationMs: clock() - startedAt,
      ...(overallCode === undefined ? {} : { code: overallCode }),
      statuses: outcomes.map((outcome) => ({
        source: outcome.source,
        status: outcome.status,
        written: outcome.written,
      })),
    })
    progress?.emit({
      kind: 'run',
      phase: 'finish',
      runId,
      at: clock(),
      sources: [...sources],
      ...(overallCode === undefined ? {} : { overallCode }),
    })
    return report
  }

  async function collectSource(
    source: IngestSource,
    runId: string,
    targeted: boolean,
  ): Promise<CollectOutcome> {
    const startedAt = clock()
    // 指定来源重试复用该来源的断点（含窗口）；全量运行一律重新计算（决策 4）
    const checkpoint = targeted ? checkpoints.get(source) : undefined
    let window: { from: number; to: number } | undefined
    try {
      window = checkpoint?.window ?? planWindow(store, source, clock(), overlapMs)
    } catch {
      // 读 `DM-001` 失败不静默（§4.2 同类口径）：来源落失败 + `STORAGE_UNAVAILABLE`
      const detail = failure(
        'STORAGE_UNAVAILABLE',
        `读取采集来源状态失败：无法计算增量窗口（来源：${source}）`,
        `来源:${source}`,
        true,
      )
      logger?.error?.(INGEST_LOG_EVENTS.sourceFailed, {
        module: 'MOD-001',
        runId,
        source,
        phase: 'plan',
        code: detail.code,
      })
      return { source, status: 'failed', written: 0, failure: detail, subFailures: [detail] }
    }

    let outcome: CollectOutcome
    try {
      outcome = await adapters[source].collect({
        runId,
        ...(window === undefined ? {} : { window }),
        ...(checkpoint === undefined ? {} : { checkpoint }),
        onProgress: (update) => progress?.emit({ kind: 'source', runId, at: clock(), progress: update }),
      })
    } catch {
      // 未预期内部异常：归「未知失败」，只进日志、不新增标识（§6.3）；不让整次运行崩溃
      logger?.error?.(INGEST_LOG_EVENTS.sourceFailed, { module: 'MOD-001', runId, source, unexpected: true })
      outcome = {
        source,
        status: 'failed',
        written: 0,
        failure: failure('SOURCE_UNAVAILABLE', `来源采集出现未预期异常（未知失败，仅日志）：${source}`, `来源:${source}`, true),
        subFailures: [],
      }
    }

    const recorded = recordOutcome(outcome)

    // 断点维护：失败保留（指定来源重试续点）；成功清除
    if (recorded.status === 'succeeded') checkpoints.delete(source)
    else if (recorded.checkpoint !== undefined) checkpoints.set(source, recorded.checkpoint)

    logger?.info?.(recorded.status === 'succeeded' ? INGEST_LOG_EVENTS.sourceDone : INGEST_LOG_EVENTS.sourceFailed, {
      module: 'MOD-001',
      runId,
      source: recorded.source,
      status: recorded.status,
      written: recorded.written,
      subFailures: recorded.subFailures.length,
      durationMs: clock() - startedAt,
      ...(recorded.failure === undefined ? {} : { code: recorded.failure.code }),
    })
    return recorded
  }

  /** 来源结束时写一次该来源的 `DM-001` 行（决策 7）；写入失败 → 来源级 `STORAGE_UNAVAILABLE`（§6.1）。 */
  function recordOutcome(outcome: CollectOutcome): CollectOutcome {
    try {
      const result = writeSourceStatus(store, {
        source: outcome.source,
        status: contractStatusOf(outcome.status),
        completedAt: outcome.completedAt ?? null,
        failureReason: outcome.failure?.reason ?? null,
      })
      if (result.failures.length === 0) return outcome
      const reasons = result.failures.map((item) => item.reason).join('；')
      return markStorageFailure(outcome, `来源状态写入失败（${reasons}）`)
    } catch {
      return markStorageFailure(outcome, '来源状态写入失败（存储不可用）')
    }
  }

  /** 把「状态写入失败」并入分项明细，并按 §6.2 优先级重取来源级终态。 */
  function markStorageFailure(outcome: CollectOutcome, reason: string): CollectOutcome {
    const subFailure = failure('STORAGE_UNAVAILABLE', reason, `来源:${outcome.source}`, true)
    const subFailures: IngestFailure[] = [...outcome.subFailures, subFailure]
    const top = pickSourceFailure(subFailures)
    return {
      ...outcome,
      status: top === undefined ? 'failed' : statusOfCode(top.code),
      ...(top === undefined ? {} : { failure: top }),
      subFailures,
      // 状态未写成 → 该来源不算完成（不推进「记录更新至 X」）
      completedAt: undefined,
    }
  }

  return { submit, isRunning }
}
