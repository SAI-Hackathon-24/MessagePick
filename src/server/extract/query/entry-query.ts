/**
 * 时间轴与归档查询（mod-006 §3.1「query/entry-query.ts —— API-014：时间轴 / 归档（含分组）」、
 * §4 API-014、§5.2、§8 决策 4 / 5、§7「归档与主题」「时间轴」「空态」「筛选契约」「护栏」行）。
 *
 * - 读路径：组装筛选（群 / 时间范围 / 关键词；身份字段由仓库层显式剔除，模块二不区分身份）
 *   → 经 `API-004` 读「提取条目」→ 一页取数（排序由 `MOD-002` 保证：`src_time DESC, item_id DESC`）
 *   → 随来源引用解析排序时间（§5.2：全部来源消息中最早的发送时间）→ 条目视图 + 分页信息 + 截断标记。
 * - 分页：缺省 1 / 100（`PAGE_SIZE_DEFAULT`）；页码 < 1 或每页 > 500 → `INVALID_INPUT`；
 *   本页之后仍有命中即 `truncated = true`（§8 决策 4；详设 §5.4）。
 * - 关键词只经 `API-004` 执行一次（§8 决策 5）：模块内不做任何二次过滤，也不建索引。
 * - 空态区分：库中无任何条目 → `NO_DATA`；筛选命中 0 条 → `EMPTY_RESULT`（§4、`AC-093`）。
 * - 归档分组在结果页上完成（§4）：`groupByTopic` / `groupByMonth` 为纯函数，组头 = 组名 + 条目数；
 *   与时间轴消费同一份条目数据（条目视图即组内条目）。
 */

import type {
  ExtractEntryView,
  ExtractedItem,
  Id,
  Month,
  PageInfo,
  PageInput,
  RawMessage,
  SharedFilter,
  Timestamp,
} from '@shared'

import { PAGE_SIZE_DEFAULT } from '../constants'
import { emptyResult, noData } from '../errors'
import type { EntryRepository } from '../store/entry-repository'

// ---------------------------------------------------------------------------
// 入参 / 出参（§3.3：`queryEntries(q: { filter; page? })`）
// ---------------------------------------------------------------------------

/** `API-014` 入参：全局筛选（身份将被剔除）+ 可选分页；缺省调用 = 第一页（§8 决策 4）。 */
export interface EntryQueryInput {
  filter?: SharedFilter | null
  page?: PageInput | null
}

/** 时间轴 / 归档条目 = 契约 `ExtractEntryView`（`time` = 排序时间，§5.2）。 */
export type EntrySummary = ExtractEntryView

/** `API-014` 出参：契约条目列表 + 分页信息 + 截断标记（模块侧对详设 §5.3 / §5.4 的落点）。 */
export interface EntryListPage {
  items: EntrySummary[]
  pageInfo: PageInfo
  /** 本页之后仍有命中（`page × pageSize < total`）；外壳据此决定是否继续翻页。 */
  truncated: boolean
}

/** 主题归档分组：组头 = 主题 + 条目数；组内保持输入顺序（= 排序时间倒序）。 */
export interface TopicGroup {
  topic: string
  count: number
  entries: EntrySummary[]
}

/** 时间归档分组：组头 = 自然月 + 条目数；组序按月份倒序，「月份不可解析」的组殿后。 */
export interface MonthGroup {
  /** 排序时间所在自然月（`YYYY-MM`）；来源消息全部不可解析时为 null（原样保留、不丢弃条目）。 */
  month: Month | null
  count: number
  entries: EntrySummary[]
}

// ---------------------------------------------------------------------------
// API-014 查询提取条目
// ---------------------------------------------------------------------------

/**
 * `API-014`：返回一页提取条目（供时间轴 / 归档使用）。
 *
 * 步骤（§4）：① 入参护栏（页码 / 每页非法立即 `INVALID_INPUT`）→ ② 无任何条目 → `NO_DATA`
 * → ③ 一页取数（筛选与排序全部交 `API-004`）→ ④ 命中 0 条 → `EMPTY_RESULT`
 * → ⑤ 批量解析本页条目的排序时间 → ⑥ 组装条目视图与截断标记。
 */
export async function queryEntries(
  repository: EntryRepository,
  input: EntryQueryInput = {},
): Promise<EntryListPage> {
  // ① 入参护栏先行：非法页码 / 每页不进入任何读取（§6「枚举越界 → INVALID_INPUT」同侧口径）。
  const page = repository.normalizePage(input.page, PAGE_SIZE_DEFAULT)

  // ② 空态一：尚无任何条目 → NO_DATA（与筛选无关；外壳引导完成首次更新）。
  if (!repository.hasAnyEntry()) throw noData('extract:entries')

  // ③ 一页取数：筛选组装与排序全部由仓库层 / MOD-002 承担（模块内不二次过滤，决策 5）。
  const result = repository.readEntryPage(input.filter ?? null, page)

  // ④ 空态二：库中有数据但筛选命中 0 条 → EMPTY_RESULT（空态 + 一键清除筛选）。
  if (result.pageInfo.total === 0) throw emptyResult('extract:entries')

  // ⑤ 排序时间（§5.2）：本页条目的来源消息一次批量取回（首屏只取一页、详情懒加载）。
  const messages = repository.readSourceMessages(result.records)
  const items = result.records.map((entry) => entryViewOf(entry, messages))

  // ⑥ 截断标记：本页之后仍有命中即标注（总数随 pageInfo 返回）。
  const consumed = page.page * page.pageSize
  return { items, pageInfo: result.pageInfo, truncated: consumed < result.pageInfo.total }
}

/**
 * 条目 → 条目视图（契约 `ExtractEntryView`；`time` 为排序时间，读取时随来源引用解析）。
 * 人物要素为空数组口径（契约字段不可空）；来源引用原样回带（可回跳原文，REQ-007）。
 */
export function entryViewOf(entry: ExtractedItem, messages: ReadonlyMap<Id, RawMessage>): EntrySummary {
  return {
    entryId: entry.entryId,
    recognitionType: entry.recognitionType,
    timeElement: entry.timeElement,
    locationElement: entry.locationElement,
    personElementMemberIds: entry.personElementMemberIds === null ? [] : [...entry.personElementMemberIds],
    subjectElement: entry.subjectElement,
    deadline: entry.deadline,
    groupId: entry.groupId,
    time: sortTimeOf(entry, messages),
    topic: entry.topic,
    sourceMessageIds: [...entry.sourceMessageIds],
  }
}

/**
 * 排序时间（§5.2）= 条目全部来源消息中最早的发送时间。
 * 来源消息部分缺失（被删除）时取剩余中最早者；全部不可解析 → null（不猜、不填）。
 */
export function sortTimeOf(entry: ExtractEntryView | ExtractedItem, messages: ReadonlyMap<Id, RawMessage>): Timestamp | null {
  let earliest: Timestamp | null = null
  for (const messageId of entry.sourceMessageIds) {
    const message = messages.get(messageId)
    if (message === undefined) continue
    if (earliest === null || message.sentAt < earliest) earliest = message.sentAt
  }
  return earliest
}

// ---------------------------------------------------------------------------
// 归档分组（§4 API-014：组头 = 组名 + 条目数；纯函数、不触碰存储）
// ---------------------------------------------------------------------------

/** 主题维度归档：按主题值分组；组序 = 首现顺序（输入为排序时间倒序时即「最近分组在前」）。 */
export function groupByTopic(entries: readonly EntrySummary[]): TopicGroup[] {
  const groups = new Map<string, TopicGroup>()
  for (const entry of entries) {
    let group = groups.get(entry.topic)
    if (group === undefined) {
      group = { topic: entry.topic, count: 0, entries: [] }
      groups.set(entry.topic, group)
    }
    group.count += 1
    group.entries.push(entry)
  }
  return [...groups.values()]
}

/** 时间维度归档：默认按自然月分组（月 = 排序时间所在 UTC 自然月）；组序按月份倒序。 */
export function groupByMonth(entries: readonly EntrySummary[]): MonthGroup[] {
  const groups = new Map<Month | null, MonthGroup>()
  for (const entry of entries) {
    const month = entry.time === null ? null : monthOf(entry.time)
    let group = groups.get(month)
    if (group === undefined) {
      group = { month, count: 0, entries: [] }
      groups.set(month, group)
    }
    group.count += 1
    group.entries.push(entry)
  }
  return [...groups.values()].sort((a, b) => {
    if (a.month === null) return b.month === null ? 0 : 1
    if (b.month === null) return -1
    return a.month < b.month ? 1 : a.month > b.month ? -1 : 0
  })
}

/** 自然月键（`YYYY-MM`，UTC；时间口径与存储一致 —— 全库以 UTC epoch 毫秒为基准）。 */
export function monthOf(timestamp: Timestamp): Month {
  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
