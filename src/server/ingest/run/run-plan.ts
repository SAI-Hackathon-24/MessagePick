/**
 * 运行计划：来源集合与增量窗口的计算（mod-001 §3.1「run/run-plan.ts」、决策 4）。
 *
 * - 来源集合**封闭为两个**：省略目标来源 = 全部来源；指定 = 只跑该来源（重试口径，`AC-006`）。
 * - 增量窗口：起点 = 群消息来源的最近成功时间 − 重叠量，终点 = 运行开始时刻；
 *   首次全量（无最近成功时间）不带窗口；通讯录与好友列表来源没有时间窗语义（全量列出）。
 * - 断点不在此处：由执行器持有（进程内，§5.3），指定来源重试时复用（窗口随断点一起带走）。
 */

import type { IngestSource } from '@shared'

import type { Store } from '@server/store'

import { INGEST_SOURCE_ORDER } from '../sources/source'
import { readSourceStatuses } from '../state/source-state'

/** 增量窗口重叠量：吸收时钟偏移与迟到消息（模块内常量 5 分钟，不新增配置键；决策 4）。 */
export const INGEST_WINDOW_OVERLAP_MS = 5 * 60 * 1000

/** 本次运行的来源集合（串行顺序 = `INGEST_SOURCE_ORDER`；决策 3）。 */
export function planSources(targetSource?: IngestSource): IngestSource[] {
  if (targetSource === undefined) return [...INGEST_SOURCE_ORDER]
  return [targetSource]
}

/**
 * 增量窗口（`CollectContext.window`）。
 *
 * - 群消息来源：`{ from: 最近成功时间 − 重叠量, to: now }`；从未成功 → `undefined`（首次全量）。
 * - 通讯录与好友列表来源：`undefined`（无时间窗语义）。
 * - 读 `DM-001` 失败时**不吞错**：由调用方（执行器）映射为来源级失败（§4.2 同类口径）。
 */
export function planWindow(
  store: Store,
  source: IngestSource,
  now: number,
  overlapMs: number = INGEST_WINDOW_OVERLAP_MS,
): { from: number; to: number } | undefined {
  if (source !== '群消息') return undefined
  const lastSuccessAt = readSourceStatuses(store).bySource.get('群消息')?.lastSuccessAt ?? null
  if (lastSuccessAt === null) return undefined
  return { from: lastSuccessAt - overlapMs, to: now }
}
