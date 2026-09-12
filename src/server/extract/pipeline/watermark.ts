/**
 * 增量水位推导与重叠窗口（mod-006 §5.2、§8 决策 1）。
 *
 * 口径（不持久化，全部由既有数据推导）：
 * - 水位 = max(本进程上次成功批次终点, 已有条目的最晚来源消息发送时间)；
 * - 扫描窗口 = (水位 − 7 天, 当前]；冷启动且无任何条目时全量扫描（from = 0）；
 * - 重叠部分由条目标识幂等吸收（`API-003` 去重），不产生重复条目。
 *
 * 「已有条目的最晚来源消息发送时间」按本模块的排序时间口径取值（§5.2：排序时间 = 条目全部
 * 来源消息中最早的发送时间）：DM-010 按该口径倒序，故取**最新条目**的排序时间即可；这比逐条目
 * 聚合更保守（水位不会更靠后），成本也有界（一条条目的来源解析）。
 *
 * 本文件为纯函数：不读库、不看时钟（`now` 由调用方给出），便于单测。
 */

import type { Timestamp } from '@shared'

import { OVERLAP_WINDOW_MS } from '../constants'

/** 扫描窗口（闭区间 `(from, to]` 按 `API-004` 的时间范围语义表达为 `[from, to]`）。 */
export interface ExtractWindow {
  from: Timestamp
  to: Timestamp
}

/** 水位推导输入（全部来自 `EntryRepository` 与本进程内存）。 */
export interface WatermarkInput {
  /** 本进程上次成功批次的终点（重启后为 null）。 */
  lastBatchEnd: Timestamp | null
  /** 已有条目的最晚来源消息发送时间（无条目 / 无法解析时为 null）。 */
  latestEntrySourceTime: Timestamp | null
  /** 库中是否已有任何条目（决定冷启动全量扫描）。 */
  hasEntries: boolean
}

/** 水位推导结果。 */
export interface WatermarkDerivation {
  /** 水位；冷启动且无条目时为 null。 */
  watermark: Timestamp | null
  /** 冷启动：无任何条目且进程内无上次批次终点 → 全量扫描。 */
  coldStart: boolean
}

/** 推导水位（§5.2）。 */
export function deriveWatermark(input: WatermarkInput): WatermarkDerivation {
  const watermark = maxTimestamp(input.lastBatchEnd, input.latestEntrySourceTime)
  return {
    watermark,
    coldStart: watermark === null && !input.hasEntries,
  }
}

/**
 * 由水位推导扫描窗口（§5.2）：
 * - 水位为空（冷启动 / 条目来源均不可解析）→ 全量扫描 `[0, now]`；
 * - 否则 `[max(0, 水位 − 重叠), now]`，并防御时钟回拨（from 不得晚于 to）。
 */
export function scanWindow(
  derivation: WatermarkDerivation,
  now: Timestamp,
  overlapMs: number = OVERLAP_WINDOW_MS,
): ExtractWindow {
  if (derivation.watermark === null) return { from: 0, to: now }
  const from = Math.min(now, Math.max(0, derivation.watermark - overlapMs))
  return { from, to: now }
}

function maxTimestamp(a: Timestamp | null, b: Timestamp | null): Timestamp | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}
