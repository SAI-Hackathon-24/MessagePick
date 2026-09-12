/**
 * 派生计算（mod-005 §3.1「domain/Metrics —— 纯函数，now 由调用方注入」）。
 *
 * 无 IO、无全局时钟：所有与时刻相关的口径都由调用方传入 `now`。
 * 取值口径全部来自 `../constants.ts`（§5.4）：热度三档、自然日差、周环比与零基、峰值并列、
 * 月度分布补 0、不完整月份、梗王与主要使用者、字号映射。
 */

import type {
  CloudSizeBasis,
  Id,
  LifecycleRow,
  Meme,
  MemeHeat,
  MemeKingEntry,
  MemeLifecycle,
  MemeOccurrence,
  Month,
  MonthlyCounts,
  Timestamp,
} from '@shared'

import {
  ESSENCE_MAX,
  HEAT_ACTIVE_DAYS,
  HEAT_DECAY_DAYS,
  MONTH_RANGE_MAX,
  TOP_USERS,
  TREND_NEW,
  TREND_WINDOW_DAYS,
  WORDCLOUD_SIZE_RANGE,
} from '../constants'
import type { CloudTermView } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// 时间与月份（本地自然日口径，CALENDAR_DAY_DIFF）
// ---------------------------------------------------------------------------

/** 本地月份（`YYYY-MM`）。 */
export function monthOf(ts: Timestamp): Month {
  const date = new Date(ts)
  return formatMonth(date.getFullYear(), date.getMonth() + 1)
}

/** 本地自然日差（当天 = 0；`a` 早于 `b` 时为负数）。 */
export function calendarDayDiff(a: Timestamp, b: Timestamp): number {
  const da = new Date(a)
  const db = new Date(b)
  const utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())
  const utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate())
  return Math.round((utcB - utcA) / DAY_MS)
}

/** 月份列表（含起止；防御上限 `MONTH_RANGE_MAX * 20`）。 */
export function listMonths(from: Month, to: Month): Month[] {
  const start = parseMonth(from)
  const end = parseMonth(to)
  if (start === null || end === null) return []
  const out: Month[] = []
  let year = start.year
  let month = start.month
  const guard = MONTH_RANGE_MAX * 20
  while ((year < end.year || (year === end.year && month <= end.month)) && out.length < guard) {
    out.push(formatMonth(year, month))
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return out
}

/** 该月的下一个月份。 */
export function nextMonth(month: Month): Month {
  const parsed = parseMonth(month)
  if (parsed === null) return month
  return parsed.month === 12 ? formatMonth(parsed.year + 1, 1) : formatMonth(parsed.year, parsed.month + 1)
}

/** 该月的上一月份。 */
export function prevMonth(month: Month): Month {
  const parsed = parseMonth(month)
  if (parsed === null) return month
  return parsed.month === 1 ? formatMonth(parsed.year - 1, 12) : formatMonth(parsed.year, parsed.month - 1)
}

/** 某月的日数。 */
export function daysInMonth(month: Month): number {
  const parsed = parseMonth(month)
  if (parsed === null) return 0
  return new Date(parsed.year, parsed.month, 0).getDate()
}

/** 月份内的日（1 起）。 */
export function dayOfMonth(ts: Timestamp): number {
  return new Date(ts).getDate()
}

function formatMonth(year: number, month: number): Month {
  return `${year}-${month < 10 ? '0' : ''}${month}`
}

function parseMonth(month: Month): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (match === null) return null
  const year = Number(match[1])
  const index = Number(match[2])
  if (index < 1 || index > 12) return null
  return { year, month: index }
}

// ---------------------------------------------------------------------------
// 热度 / 周环比 / 读取时字段（§5.2：与时刻相关的字段读取时求值）
// ---------------------------------------------------------------------------

/** 热度三档：≤7 天活跃；8–30 天衰减中；>30 天已沉寂（AC-052 的四个边界）。 */
export function heatOf(lastUsedAt: Timestamp, now: Date): MemeHeat {
  const days = calendarDayDiff(lastUsedAt, now.getTime())
  if (days <= HEAT_ACTIVE_DAYS) return '活跃'
  if (days <= HEAT_DECAY_DAYS) return '衰减中'
  return '已沉寂'
}

/**
 * 周环比：最近 7 天出现次数对上一 7 天的相对变化率（上一窗口为 0 时按零基处理）。
 * 零基：上期 0 且本期 > 0 → `TREND_NEW`（显示「新增」）；两期都 0 → 0（显示「—」）。
 */
export function weekOverWeekOf(records: readonly Pick<MemeOccurrence, 'occurredAt'>[], now: Date): number {
  const nowMs = now.getTime()
  const currentStart = nowMs - TREND_WINDOW_DAYS * DAY_MS
  const previousStart = nowMs - 2 * TREND_WINDOW_DAYS * DAY_MS
  let current = 0
  let previous = 0
  for (const record of records) {
    if (record.occurredAt <= previousStart || record.occurredAt > nowMs) continue
    if (record.occurredAt > currentStart) current += 1
    else previous += 1
  }
  if (previous === 0) return current > 0 ? TREND_NEW : 0
  return (current - previous) / previous
}

/** 读取时字段（API-010）：距今 / 热度状态 / 周环比。 */
export interface CellMetrics {
  elapsed: number
  heat: MemeHeat
  weekOverWeek: number
}

export function computeCellMetrics(
  meme: Pick<Meme, 'lastUsedAt'>,
  recent14d: readonly MemeOccurrence[],
  now: Date,
): CellMetrics {
  return {
    elapsed: Math.max(0, now.getTime() - meme.lastUsedAt),
    heat: heatOf(meme.lastUsedAt, now),
    weekOverWeek: weekOverWeekOf(recent14d, now),
  }
}

// ---------------------------------------------------------------------------
// 月度分布与生命周期
// ---------------------------------------------------------------------------

/** 月度分布补 0：补齐最早与最晚月份之间的空月（只补已有月份区间的空洞）。 */
export function fillMonthlyCounts(counts: Readonly<MonthlyCounts>): MonthlyCounts {
  const keys = Object.keys(counts).sort()
  if (keys.length === 0) return {}
  const out: MonthlyCounts = {}
  for (const month of listMonths(keys[0] as Month, keys[keys.length - 1] as Month)) {
    out[month] = counts[month] ?? 0
  }
  return out
}

/** 峰值月 = 出现次数最多的月份；并列取最早（PEAK_TIE_BREAK）。 */
export function peakMonthOf(counts: Readonly<MonthlyCounts>): Month | null {
  const keys = Object.keys(counts).sort()
  let best: Month | null = null
  let bestCount = -1
  for (const month of keys) {
    const count = counts[month] ?? 0
    if (count > bestCount) {
      bestCount = count
      best = month as Month
    }
  }
  return best
}

/** 由月度分布与起止时间派生生命周期结构（峰值并列取最早月；活跃天数 = 自然日跨度）。 */
export function deriveLifecycle(
  firstSeenAt: Timestamp,
  lastUsedAt: Timestamp,
  monthlyCounts: Readonly<MonthlyCounts>,
): MemeLifecycle {
  return {
    firstSeenAt,
    peakMonth: peakMonthOf(monthlyCounts) ?? monthOf(firstSeenAt),
    silentAt: lastUsedAt,
    activeDays: calendarDayDiff(firstSeenAt, lastUsedAt),
  }
}

/** 梗王 + 主要使用者：并列梗王全部列出；其余按次数降序取前 `TOP_USERS`（并列按成员标识稳定排序）。 */
export function kingsFromCounts(counts: ReadonlyMap<Id, number>, total: number): MemeKingEntry[] {
  if (counts.size === 0) return []
  let max = -1
  for (const count of counts.values()) max = Math.max(max, count)
  const kings = [...counts.entries()]
    .filter(([, count]) => count === max)
    .map(([memberId]) => memberId)
    .sort(compareIds)
  const others = [...counts.entries()]
    .filter(([, count]) => count < max)
    .sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]))
    .slice(0, TOP_USERS)
  const toEntry = (memberId: Id, count: number): MemeKingEntry => ({
    memberId,
    count,
    share: total > 0 ? count / total : 0,
  })
  return [...kings.map((id) => toEntry(id, max)), ...others.map(([id, count]) => toEntry(id, count))]
}

/** 由出现记录统计梗王与主要使用者（REQ-031：只呈现可统计事实，占比 = 次数 ÷ 累计次数）。 */
export function computeMemeKing(occurrences: readonly MemeOccurrence[], total?: number): MemeKingEntry[] {
  const counts = new Map<Id, number>()
  for (const occurrence of occurrences) {
    counts.set(occurrence.speakerMemberId, (counts.get(occurrence.speakerMemberId) ?? 0) + 1)
  }
  return kingsFromCounts(counts, total ?? occurrences.length)
}

// ---------------------------------------------------------------------------
// 折叠（§5.3：聚合与展示单位均为 root）
// ---------------------------------------------------------------------------

/** 折叠后的梗统计（视图结构的公共输入）。 */
export interface FoldedMeme {
  memeId: Id
  groupId: Id
  name: string
  kind: Meme['kind']
  interpretation: string
  correction: Meme['correction']
  firstSeenAt: Timestamp
  firstSeenGroupId: Id
  lastUsedAt: Timestamp
  occurrenceCount: number
  monthlyCounts: MonthlyCounts
  lifecycle: MemeLifecycle
  memeKing: MemeKingEntry[]
}

/**
 * 折叠统计：root + 链上「已合并至」来源的派生值相加 / 取极值。
 * 梗王为基于落库值的近似合并（精确口径由出现记录重算，见 `computeMemeKing`）。
 */
export function foldMemeStats(root: Meme, sources: readonly Meme[] = []): FoldedMeme {
  const members = [root, ...sources]
  let first = root
  let last = root
  let occurrenceCount = 0
  const monthlyCounts: MonthlyCounts = {}
  const kingCounts = new Map<Id, number>()

  for (const member of members) {
    if (member.firstSeenAt < first.firstSeenAt || (member.firstSeenAt === first.firstSeenAt && member.memeId < first.memeId)) {
      first = member
    }
    if (member.lastUsedAt > last.lastUsedAt || (member.lastUsedAt === last.lastUsedAt && member.memeId < last.memeId)) {
      last = member
    }
    occurrenceCount += member.occurrenceCount
    for (const [month, count] of Object.entries(member.monthlyCounts)) {
      monthlyCounts[month] = (monthlyCounts[month] ?? 0) + count
    }
    for (const entry of member.memeKing) {
      kingCounts.set(entry.memberId, (kingCounts.get(entry.memberId) ?? 0) + entry.count)
    }
  }

  const filled = fillMonthlyCounts(monthlyCounts)
  return {
    memeId: root.memeId,
    groupId: root.groupId,
    name: root.name,
    kind: root.kind,
    interpretation: root.interpretation,
    correction: root.correction,
    firstSeenAt: first.firstSeenAt,
    firstSeenGroupId: first.groupId,
    lastUsedAt: last.lastUsedAt,
    occurrenceCount,
    monthlyCounts: filled,
    lifecycle: deriveLifecycle(first.firstSeenAt, last.lastUsedAt, filled),
    memeKing: kingsFromCounts(kingCounts, occurrenceCount),
  }
}

// ---------------------------------------------------------------------------
// 词云（API-009；字号 = 频率的单调映射，WORDCLOUD_SIZE_RANGE / sqrt 压缩）
// ---------------------------------------------------------------------------

/** 词云条目的输入口径（= 折叠后的梗统计）。 */
export type CloudTermSource = Pick<
  FoldedMeme,
  'memeId' | 'name' | 'kind' | 'firstSeenAt' | 'lastUsedAt' | 'occurrenceCount'
>

/** 按梗汇总出现记录条数（调用方已完成 root 归一化，见 §5.3）。 */
export function countByMeme(records: readonly Pick<MemeOccurrence, 'memeId'>[]): Map<Id, number> {
  const counts = new Map<Id, number>()
  for (const record of records) {
    counts.set(record.memeId, (counts.get(record.memeId) ?? 0) + 1)
  }
  return counts
}

/** 组合词云条目：频率取 `frequencies`（null = 用累计出现次数），字号做 `sqrt` 单调映射。 */
export function buildCloudTerms(
  sources: readonly CloudTermSource[],
  frequencies: ReadonlyMap<Id, number> | null,
): CloudTermView[] {
  const terms: CloudTermView[] = sources.map((source) => ({
    memeId: source.memeId,
    name: source.name,
    kind: source.kind,
    firstSeenAt: source.firstSeenAt,
    lastUsedAt: source.lastUsedAt,
    occurrenceCount: source.occurrenceCount,
    frequency: frequencies === null ? source.occurrenceCount : frequencies.get(source.memeId) ?? 0,
    fontSize: WORDCLOUD_SIZE_RANGE.min,
  }))
  assignFontSizes(terms)
  return sortTermsByLayout(terms, '按热度')
}

/**
 * 字号映射（§5.4）：`min + (max − min) × sqrt(f / fmax)`；fmax ≤ 0 或空集合时取最小值。
 * 单调非减 ⇒ 字号与频率正相关（AC-041）。
 */
export function assignFontSizes(terms: readonly CloudTermView[]): void {
  let fmax = 0
  for (const term of terms) fmax = Math.max(fmax, term.frequency)
  for (const term of terms) {
    term.fontSize =
      fmax <= 0
        ? WORDCLOUD_SIZE_RANGE.min
        : round1(WORDCLOUD_SIZE_RANGE.min + (WORDCLOUD_SIZE_RANGE.max - WORDCLOUD_SIZE_RANGE.min) * Math.sqrt(Math.max(0, term.frequency) / fmax))
  }
}

/** 布局排序：按热度 = 频率降序；按首次出现时间 = 首现时间升序（并列按频率降序、标识升序）。 */
export function sortTermsByLayout<T extends CloudTermView>(terms: readonly T[], layout: '按热度' | '按首次出现时间'): T[] {
  const sorted = [...terms]
  sorted.sort((a, b) => {
    if (layout === '按首次出现时间') {
      return a.firstSeenAt - b.firstSeenAt || b.frequency - a.frequency || compareIds(a.memeId, b.memeId)
    }
    return b.frequency - a.frequency || a.firstSeenAt - b.firstSeenAt || compareIds(a.memeId, b.memeId)
  })
  return sorted
}

/**
 * §3.3 签名口径：`computeCloudTerms(memes, windowRecords, basis, now)`。
 * `windowRecords` 已由调用方按可见性归一化到 root；时间窗为空时退回累计口径（§4 API-009）。
 */
export function computeCloudTerms(
  memes: readonly CloudTermSource[],
  windowRecords: readonly MemeOccurrence[] | null,
  basis: CloudSizeBasis,
  now: Date,
): CloudTermView[] {
  void now
  const useWindow = basis === '指定时间窗内出现频次' && windowRecords !== null
  return buildCloudTerms(memes, useWindow ? countByMeme(windowRecords) : null)
}

// ---------------------------------------------------------------------------
// 精华消息（API-010；默认 3、展开 ≤ 20）
// ---------------------------------------------------------------------------

/**
 * 精华消息选取：按展示序号升序（并列按来源消息标识稳定排序），返回前 `max` 条与截断标记。
 * 前端默认展示前 `ESSENCE_DEFAULT` 条，展开上限 `ESSENCE_MAX`（mod-005 §3.3）。
 */
export function pickHighlights<T extends { displayOrder: number; sourceMessageId: Id }>(
  rows: readonly T[],
  max: number = ESSENCE_MAX,
): { page: T[]; truncated: boolean } {
  const sorted = [...rows].sort(
    (a, b) => a.displayOrder - b.displayOrder || compareIds(a.sourceMessageId, b.sourceMessageId),
  )
  return { page: sorted.slice(0, max), truncated: sorted.length > max }
}

// ---------------------------------------------------------------------------
// 生命周期视图（API-011）
// ---------------------------------------------------------------------------

/** 生命周期行输入（= 折叠后的梗统计）。 */
export type LifecycleSource = Pick<
  FoldedMeme,
  'memeId' | 'name' | 'firstSeenAt' | 'lastUsedAt' | 'occurrenceCount' | 'monthlyCounts'
>

/** 逐梗条带：月度强度 = 当月次数 ÷ 峰值月次数（0–1；无峰值时为 0）。 */
export function computeLifecycle(sources: readonly LifecycleSource[], months: { from: Month; to: Month }): LifecycleViewRow[] {
  const range = listMonths(months.from, months.to)
  const rows = sources.map((source) => {
    const peak = peakMonthOf(source.monthlyCounts)
    const peakCount = peak === null ? 0 : source.monthlyCounts[peak] ?? 0
    const monthlyStrength: MonthlyCounts = {}
    for (const month of range) {
      monthlyStrength[month] = peakCount > 0 ? (source.monthlyCounts[month] ?? 0) / peakCount : 0
    }
    return {
      memeId: source.memeId,
      name: source.name,
      firstSeenAt: source.firstSeenAt,
      peakMonth: peak ?? monthOf(source.firstSeenAt),
      silentAt: source.lastUsedAt,
      activeDays: calendarDayDiff(source.firstSeenAt, source.lastUsedAt),
      monthlyStrength,
      occurrenceCount: source.occurrenceCount,
    }
  })
  rows.sort(
    (a, b) => b.silentAt - a.silentAt || b.occurrenceCount - a.occurrenceCount || compareIds(a.memeId, b.memeId),
  )
  return rows
}

/** 视图行（= 契约 `LifecycleRow` + 排序用累计次数；出参装配时保留在模内扩展）。 */
export interface LifecycleViewRow extends LifecycleRow {
  occurrenceCount: number
}

/** 当月领跑梗：每月取该月次数最大的梗（并列全部列出；无数据的月份不产生条目）。 */
export function pickLeadingMemes(sources: readonly LifecycleSource[], months: { from: Month; to: Month }): Array<{ month: Month; memeIds: Id[] }> {
  const out: Array<{ month: Month; memeIds: Id[] }> = []
  for (const month of listMonths(months.from, months.to)) {
    let max = 0
    for (const source of sources) max = Math.max(max, source.monthlyCounts[month] ?? 0)
    if (max <= 0) continue
    const memeIds = sources
      .filter((source) => (source.monthlyCounts[month] ?? 0) === max)
      .map((source) => source.memeId)
      .sort(compareIds)
    out.push({ month, memeIds })
  }
  return out
}

// ---------------------------------------------------------------------------
// 不完整月份（REQ-029、§5.4 三类判定）
// ---------------------------------------------------------------------------

/**
 * 不完整月份判定：① 当前自然月；② 数据覆盖窗口起始月且起始日 > 1；③ 覆盖窗口结束月且结束日 < 月末日。
 * 覆盖窗口 = 全局筛选范围内 `DM-003` 的最早 / 最晚发送时间（一次查询只读一次并复用）。
 */
export function incompleteMonths(
  months: readonly Month[],
  coverage: { first: Timestamp; last: Timestamp } | null,
  now: Date,
): Month[] {
  const currentMonth = monthOf(now.getTime())
  const flagged = new Set<Month>()
  for (const month of months) {
    if (month === currentMonth) {
      flagged.add(month)
      continue
    }
    if (coverage === null) continue
    if (month === monthOf(coverage.first) && dayOfMonth(coverage.first) > 1) {
      flagged.add(month)
    }
    if (month === monthOf(coverage.last) && dayOfMonth(coverage.last) < daysInMonth(month)) {
      flagged.add(month)
    }
  }
  return [...flagged].sort()
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0
}
