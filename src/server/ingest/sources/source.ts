/**
 * 来源适配器接口与来源枚举（mod-001 §3.3「sources/source.ts」）。
 *
 * 来源集合**封闭为两个**：群消息、通讯录与好友列表（`REQ-001`、`REQ-019`）；不存在第三个来源，
 * 也不存在任何演示 / 模拟数据通道（`AC-009`、`AC-010`）。
 */

import type { ErrorCode, IngestSource, IngestSourceStatus, Timestamp } from '@shared'
import { INGEST_SOURCES } from '@shared'

import { OVERALL_CODE_PRIORITY, type IngestFailure } from '../errors'

/** 来源执行顺序（本次运行按此顺序**串行**，决策 3）。 */
export const INGEST_SOURCE_ORDER: readonly IngestSource[] = [...INGEST_SOURCES]

/** 来源级状态（与 `API-001` 出参枚举一一对应；契约枚举为中文，映射见 `contractStatusOf`）。 */
export type SourceStatus = 'succeeded' | 'failed' | 'noAuth' | 'timeout'

/** 来源状态 → 契约枚举（`api-contract.md` / `entities.ts` 的 `INGEST_SOURCE_STATUSES`）。 */
export const CONTRACT_STATUS: Readonly<Record<SourceStatus, IngestSourceStatus>> = {
  succeeded: '成功',
  failed: '失败',
  noAuth: '无授权',
  timeout: '超时',
}

/** 来源状态 → 契约枚举。 */
export function contractStatusOf(status: SourceStatus): IngestSourceStatus {
  return CONTRACT_STATUS[status]
}

/** 进度事件体（SSE 传输在 `MOD-004`，§4.1）。 */
export interface SourceProgress {
  source: IngestSource
  /** 阶段：列来源 / 单群 / 单分页 / 写入 */
  phase: 'list' | 'group' | 'page' | 'write'
  /** 进度边界（群标识 / 分页游标；不含消息内容） */
  scope?: string
  processed: number
  total?: number
  written: number
}

/**
 * 进程内断点（`detailed-design.md` §2.4 的采集断点幂等键 = 来源 + 时间窗 + 分页游标）。
 *
 * 不持久化（`data-model.md` 未为游标类状态分配实体，§5.3）：重启后从窗口起点重采，靠记录身份去重兜底。
 */
export interface SourceCheckpoint {
  source: IngestSource
  /** 本次采集使用的时间窗（指定来源重试时复用，保证分页游标仍然成立） */
  window?: { from: number; to: number }
  /** 已完整完成的群（重试时跳过） */
  doneGroups: readonly string[]
  /** 失败分页的下一次 offset（群标识 → 游标） */
  offsets: Readonly<Record<string, number>>
}

/** 采集上下文。 */
export interface CollectContext {
  /** 本次运行引用（日志 / 进度） */
  runId: string
  /** 增量窗口；首次全量为空 */
  window?: { from: number; to: number }
  /** 进程内断点（手动重试从失败分页继续） */
  checkpoint?: SourceCheckpoint
  onProgress(progress: SourceProgress): void
}

/** 来源采集结果（§3.3）。 */
export interface CollectOutcome {
  source: IngestSource
  status: SourceStatus
  /** 经 `API-003` 成功写入的记录数 */
  written: number
  failure?: IngestFailure
  /** 单群 / 单分页 / 单写入批级明细（不阻塞其他分项） */
  subFailures: IngestFailure[]
  /** 仅 succeeded 时给出 */
  completedAt?: Timestamp
  /** 新的进程内断点（仅运行期） */
  checkpoint?: SourceCheckpoint
}

/** 来源适配器。 */
export interface SourceAdapter {
  readonly source: IngestSource
  collect(ctx: CollectContext): Promise<CollectOutcome>
}

/** 失败标识 → 来源状态（§6.1 表）。 */
export function statusOfCode(code: IngestFailure['code']): SourceStatus {
  switch (code) {
    case 'NO_AUTH':
      return 'noAuth'
    case 'TIMEOUT':
      return 'timeout'
    default:
      return 'failed'
  }
}

/** 取来源级失败明细（优先级同 §6.2 规则 3：`NO_AUTH` > `TIMEOUT` > `STORAGE_UNAVAILABLE` > `SOURCE_UNAVAILABLE`）。 */
export function pickSourceFailure(failures: readonly IngestFailure[]): IngestFailure | undefined {
  for (const code of OVERALL_CODE_PRIORITY) {
    const matched = failures.find((item) => item.code === code)
    if (matched !== undefined) return matched
  }
  return failures[0]
}

/** 失败标识联合（编译期提示；运行期一律取 `@shared` 闭集）。 */
export type { ErrorCode }
