/**
 * 更新入口的纯逻辑（`API-001` / `API-002`；`AC-004` ~ `AC-007`、`TASK-008`）。
 *
 * - 分来源结果由服务端给出，页面只做汇总与分项展示，不改写模块结论。
 * - 「记录更新至 X」不在这里推算：更新完成后页面重新拉取 `API-002`（`AC-002` / `AC-004`）。
 * - 分项重试只把失败来源作为「目标来源」下发，不重复采集已成功来源（`AC-007`）。
 */

import type { Api001Request, Api001Response, IngestSource, IngestSourceResult, Timestamp } from '@shared'

/** 更新结果汇总（分项展示与重试入口的依据）。 */
export interface IngestSummary {
  sources: readonly IngestSourceResult[]
  /** 非「成功」状态的来源（分项重试入口逐个对应） */
  failed: readonly IngestSourceResult[]
  /** 群消息来源本次完成时间（仅作展示；X 刷新由 `API-002` 承担） */
  completedAt: Timestamp | null
  /** 是否存在部分失败（整体不阻塞） */
  hasPartial: boolean
}

/** 汇总一次更新结果（空响应 → 空汇总）。 */
export function summarizeIngest(response: Api001Response | null): IngestSummary {
  const sources = response?.sources ?? []
  const failed = sources.filter((source) => source.status !== '成功')
  const groupSource = sources.find((source) => source.source === '群消息' && source.status === '成功')
  return {
    sources,
    failed,
    completedAt: groupSource?.completedAt ?? null,
    hasPartial: failed.length > 0 && failed.length < sources.length,
  }
}

/** 构造更新 / 分项重试的入参（`null` = 全部来源；指定来源 = 只重试该来源）。 */
export function retryRequest(source: IngestSource | null): Api001Request {
  return source === null ? {} : { targetSource: source }
}

/** 是否有任何来源需要重试。 */
export function hasRetryableSource(summary: IngestSummary): boolean {
  return summary.failed.length > 0
}

/** 失败来源 → 使用者可见的失败明细（来源 + 状态 + 原因），不阻塞其余分项。 */
export interface FailedSourceLine {
  source: IngestSource
  status: string
  reason: string
}

/** 汇出失败来源的明细行（原因取该来源的首条失败明细，缺省用状态兜底）。 */
export function failedSourceLines(summary: IngestSummary): FailedSourceLine[] {
  return summary.failed.map((source) => ({
    source: source.source,
    status: source.status,
    reason: source.failures[0]?.reason ?? source.status,
  }))
}
