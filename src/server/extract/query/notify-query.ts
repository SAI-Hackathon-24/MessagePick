/**
 * 通知总览四维分组（mod-006 §3.1「query/notify-query.ts —— API-015：通知总览四维度分组」、
 * §4 API-015、§5.2、§8 决策 4 / 5、§7「通知总览」「护栏」「空态」「筛选契约」行）。
 *
 * - 读路径同 `API-014`：入参护栏（页码 < 1 / 每页 > 500 / 维度越界 → `INVALID_INPUT`）→ 无任何条目
 *   → `NO_DATA` → 一次取数（筛选与关键词只经 `API-004` 执行一次，决策 5；身份由仓库层剔除）
 *   → 筛选命中 0 条 → `EMPTY_RESULT`。
 * - 分组只在服务端做一次（§4）：组头 = 组名 + 组内总数 + 组内截断标记；组内条目按排序时间倒序（§5.2），
 *   同值按条目标识倒序稳定排序（§8 决策 4）。
 * - 组序：优先级 / 待办 = 闭集三值固定序（空组也返回）；来源 / 类型 = 实际出现值、按组内最新条目时间
 *   倒序（全局倒序后的首现序即此序）。
 * - 组内分页：缺省每组第一页 50 条（`NOTIFY_GROUP_PAGE_SIZE`）；单次响应跨组合计上限 `LIST_CAP`
 *   （详设 §5.4）——超出即截断并标注，不静默吞掉事实。
 * - 来源维度的组名取自 `DM-002`（群已删时回退以群标识为组名，不丢组、不报错）。
 */

import {
  NOTIFICATION_DIMENSIONS,
  type ExtractedItem,
  type Id,
  type NotificationDimension,
  type NotificationEntry,
  type NotificationGroup,
  type PageInfo,
  type PageInput,
  type RawMessage,
  type SharedFilter,
  type Timestamp,
} from '@shared'

import { LIST_CAP, NOTIFY_GROUP_PAGE_SIZE, PRIORITIES, TODO_STATUSES } from '../constants'
import { emptyResult, invalidInput, noData } from '../errors'
import type { EntryRepository, ModulePage } from '../store/entry-repository'
import { sortTimeOf } from './entry-query'

// ---------------------------------------------------------------------------
// 入参 / 出参（§3.3：`queryNotifications(q: { filter; dimension; page? })`）
// ---------------------------------------------------------------------------

/** `API-015` 入参：全局筛选（身份将被剔除）+ 浏览维度（必填）+ 可选组内分页（缺省每组第一页）。 */
export interface NotifyQueryInput {
  filter?: SharedFilter | null
  dimension: NotificationDimension
  page?: PageInput | null
}

/** 通知分组：契约 `NotificationGroup`（key / label / notifications）+ 组内总数与截断标记（§4）。 */
export interface NotifyGroup extends NotificationGroup {
  /** 组内命中总数（组头计数；闭集空组为 0）。 */
  total: number
  /** 组内本页未带全：本页之后仍有条目，或被单次响应上限（`LIST_CAP`）截断。 */
  truncated: boolean
}

/** `API-015` 出参：分组列表 + 分页信息 + 截断标记（模块侧对详设 §5.3 / §5.4 的落点）。 */
export interface NotifyGroupPage {
  groups: NotifyGroup[]
  pageInfo: PageInfo
  /** 本次响应存在未带全的条目（任一组组内截断，或底层读取被硬上限截断）。 */
  truncated: boolean
}

// ---------------------------------------------------------------------------
// API-015 查询通知总览
// ---------------------------------------------------------------------------

/**
 * `API-015`：返回按浏览维度分组的通知总览。
 *
 * 步骤（§4）：① 维度 / 分页护栏 → ② 无任何条目 → `NO_DATA` → ③ 一次取数（全量命中；筛选与关键词
 * 交 `API-004`，模块内不二次过滤）→ ④ 命中 0 条 → `EMPTY_RESULT` → ⑤ 批量解析排序时间并全局倒序
 * → ⑥ 按维度分桶（闭集固定序 / 实际值首现序）→ ⑦ 组内切页 + 跨组上限分配 → 组头与截断标记。
 */
export async function queryNotifications(
  repository: EntryRepository,
  input: NotifyQueryInput,
): Promise<NotifyGroupPage> {
  // ① 入参护栏先行：维度 ∈ 四维闭集（枚举越界 → INVALID_INPUT）；组内页码 / 每页非法立即拒绝。
  assertDimensionOf(input.dimension)
  const page = repository.normalizePage(input.page, NOTIFY_GROUP_PAGE_SIZE)

  // ② 空态一：尚无任何条目 → NO_DATA（与 API-014 同口径；外壳引导完成首次更新）。
  if (!repository.hasAnyEntry()) throw noData('extract:notifications')

  // ③ 一次取数：筛选组装与关键词全部由仓库层 / MOD-002 承担（决策 5；分页拼接至上限）。
  const read = repository.readEntries(input.filter ?? null)

  // ④ 空态二：库中有数据但筛选命中 0 条 → EMPTY_RESULT（空态 + 一键清除筛选）。
  if (read.total === 0) throw emptyResult('extract:notifications')

  // ⑤ 排序时间（§5.2）：来源消息一次批量取回后逐条目解析最早发送时间，全局倒序（近 → 远）。
  const messages = repository.readSourceMessages(read.records)
  const ordered = orderBySortTime(read.records, messages)

  // ⑥ 分桶：优先级 / 待办给闭集固定序（含空组）；来源 / 类型给实际出现值的首现序。
  const buckets = buildBuckets(input.dimension, ordered, repository)

  // ⑦ 组内切页 + 跨组上限（单一分配序 = 组序，保证响应内顺序稳定、可复现）。
  const pageInfo: PageInfo = { page: page.page, pageSize: page.pageSize, total: read.total }
  return paginate(buckets, page, pageInfo, read.truncated)
}

// ---------------------------------------------------------------------------
// 内部：排序、分桶与切页
// ---------------------------------------------------------------------------

/** 组内条目（携带排序时间，供全局排序与归档口径复用）。 */
interface OrderedEntry {
  entry: ExtractedItem
  time: Timestamp | null
}

/** 待切页的组（组头取值 + 组内条目倒序）。 */
interface Bucket {
  key: string
  label: string
  entries: OrderedEntry[]
}

/** 全局倒序（近 → 远；同值按条目标识倒序稳定排序，与 `MOD-002` 的 `item_id DESC` 同向）。 */
function orderBySortTime(records: readonly ExtractedItem[], messages: ReadonlyMap<Id, RawMessage>): OrderedEntry[] {
  return records
    .map((entry) => ({ entry, time: sortTimeOf(entry, messages) }))
    .sort((a, b) => {
      const timeA = a.time ?? Number.NEGATIVE_INFINITY
      const timeB = b.time ?? Number.NEGATIVE_INFINITY
      if (timeA !== timeB) return timeB - timeA
      return compareIds(b.entry.entryId, a.entry.entryId)
    })
}

/** 按维度分桶（运行期维度已由 `assertDimensionOf` 收敛到四维闭集）。 */
function buildBuckets(
  dimension: NotificationDimension,
  ordered: readonly OrderedEntry[],
  repository: EntryRepository,
): Bucket[] {
  if (dimension === '优先级') return fixedBuckets(PRIORITIES, ordered, (item) => item.entry.priority)
  if (dimension === '待办') return fixedBuckets(TODO_STATUSES, ordered, (item) => item.entry.todoStatus)
  if (dimension === '来源') {
    const names = repository.readGroupNames()
    return firstSeenBuckets(
      ordered,
      (item) => item.entry.groupId,
      (key) => names.get(key) ?? key,
    )
  }
  // 类型：取值为识别类型（闭集外的新值透传为独立组，§8 决策 7）。
  return firstSeenBuckets(
    ordered,
    (item) => item.entry.recognitionType,
    (key) => key,
  )
}

/** 闭集维度：组名 = 闭集取值，顺序固定；空组也返回（组头计数为 0）。 */
function fixedBuckets(
  keys: readonly string[],
  ordered: readonly OrderedEntry[],
  keyOf: (item: OrderedEntry) => string,
): Bucket[] {
  const buckets = new Map<string, Bucket>()
  for (const key of keys) buckets.set(key, { key, label: key, entries: [] })
  for (const item of ordered) {
    const bucket = buckets.get(keyOf(item))
    if (bucket !== undefined) bucket.entries.push(item)
  }
  return [...buckets.values()]
}

/** 实际值维度：组序 = 首现顺序（`ordered` 已全局倒序，故即「组内最新条目时间倒序」）。 */
function firstSeenBuckets(
  ordered: readonly OrderedEntry[],
  keyOf: (item: OrderedEntry) => string,
  labelOf: (key: string) => string,
): Bucket[] {
  const buckets = new Map<string, Bucket>()
  for (const item of ordered) {
    const key = keyOf(item)
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = { key, label: labelOf(key), entries: [] }
      buckets.set(key, bucket)
    }
    bucket.entries.push(item)
  }
  return [...buckets.values()]
}

/**
 * 组内切页 + 跨组上限（§4）：按组序分配 `LIST_CAP` 预算，超出部分截断并标注；
 * 组头始终返回（总数不受预算影响），页面据「截断标记 + 页参数」继续翻页。
 */
function paginate(
  buckets: readonly Bucket[],
  page: ModulePage,
  pageInfo: PageInfo,
  readTruncated: boolean,
): NotifyGroupPage {
  const start = (page.page - 1) * page.pageSize
  let budget = LIST_CAP
  const groups: NotifyGroup[] = []
  for (const bucket of buckets) {
    const total = bucket.entries.length
    const slice = start >= total ? [] : bucket.entries.slice(start, start + page.pageSize)
    const take = Math.max(0, Math.min(slice.length, budget))
    budget -= take
    groups.push({
      key: bucket.key,
      label: bucket.label,
      total,
      // 本页之后仍有条目（翻页可继续）或被上限切掉 → 组内截断。
      truncated: start + slice.length < total || take < slice.length,
      notifications: slice.slice(0, take).map((item) => notifyEntryOf(item.entry)),
    })
  }
  return { groups, pageInfo, truncated: readTruncated || groups.some((group) => group.truncated) }
}

/** 条目 → 通知条目（契约 `NotificationEntry`；来源消息引用原样回带，可回跳原文）。 */
function notifyEntryOf(entry: ExtractedItem): NotificationEntry {
  return {
    entryId: entry.entryId,
    groupId: entry.groupId,
    recognitionType: entry.recognitionType,
    priority: entry.priority,
    todoStatus: entry.todoStatus,
    sourceMessageIds: [...entry.sourceMessageIds],
  }
}

/** 维度护栏：越界 → `INVALID_INPUT`（§6「枚举越界」；不进入任何读取）。 */
function assertDimensionOf(value: unknown): asserts value is NotificationDimension {
  if (typeof value !== 'string' || !(NOTIFICATION_DIMENSIONS as readonly string[]).includes(value)) {
    throw invalidInput('浏览维度越界：应为「来源 / 类型 / 优先级 / 待办」之一', { dimension: value })
  }
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0
}
