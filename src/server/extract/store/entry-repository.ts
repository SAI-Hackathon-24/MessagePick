/**
 * 存储访问层（mod-006 §3.1「store/entry-repository.ts —— 全部读写封装」）。
 *
 * - 只经 `API-003` / `API-004`（`StorePort` 最小面，`MOD-002` 的 `Store` 结构化满足）；
 *   模块内不出现数据库驱动、不打开库文件、不另存任何持久副本（§2）。
 * - 分页与筛选组装在本层完成：身份字段显式剔除（模块二不使用身份，REQ-006）；分页参数按
 *   模块口径校验（页码 ≥ 1、每页 ≤ `PAGE_SIZE_MAX`），越界直接抛 `INVALID_INPUT`。
 * - 读取一律带显式上限（`ENTRY_SCAN_HARD_CAP` / `MESSAGE_SCAN_HARD_CAP`，详设 §5.4）；
 *   超限时返回 `truncated = true`，不静默吞掉事实。
 * - 失败不吞：`API-003` / `API-004` 的错误原样上抛（`MOD-002` 的信封已带 `STORAGE_UNAVAILABLE` /
 *   `INVALID_INPUT`，由本模块上层统一按 §6 呈现）。
 */

import type {
  EntityRecord,
  EntityType,
  ExtractedItem,
  GroupMember,
  Id,
  PageInfo,
  PageRequest,
  RawMessage,
  ReadResult,
  SharedFilter,
  Timestamp,
  WriteResult,
} from '@shared'

import type { ExtractWindow } from '../pipeline/watermark'
import { ENTRY_SCAN_HARD_CAP, MESSAGE_SCAN_HARD_CAP, PAGE_SIZE_MAX, READ_PAGE_SIZE } from '../constants'
import { invalidInput } from '../errors'

/** `API-003` / `API-004` 的最小出入面（测试注入替身）。 */
export interface ExtractStorePort {
  /** `API-004` 按条件读取（分页）。 */
  read<T extends EntityType>(type: T, filter?: SharedFilter | null, page?: PageRequest | null): ReadResult<T>
  /** `API-003` 写入记录（按记录身份去重）。 */
  write<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    opts?: { bumpEpoch?: boolean },
  ): WriteResult
}

/** 仓库层可注入参数（默认值来自 `constants.ts`）。 */
export interface EntryRepositoryOptions {
  /** 单次读取条目的硬上限（默认 `ENTRY_SCAN_HARD_CAP`）。 */
  entryHardCap?: number
  /** 单次消息扫描的硬上限（默认 `MESSAGE_SCAN_HARD_CAP`）。 */
  messageHardCap?: number
  /** 分页拼接的单页条数（默认 `READ_PAGE_SIZE`，不超过 `API-004` 上限 1000）。 */
  readPageSize?: number
}

/** 全量读取结果（带截断标记与总数；供管线 / 通知 / 提醒等需要跨页的路径使用）。 */
export interface ReadAllResult<T> {
  records: T[]
  total: number
  truncated: boolean
}

/** 规范化后的模块分页参数。 */
export interface ModulePage {
  page: number
  pageSize: number
}

/** 水位推导所需的两个事实（一次读取 + 一条条目的来源解析）。 */
export interface WatermarkFacts {
  hasEntries: boolean
  latestEntrySourceTime: Timestamp | null
}

/** `API-003` / `API-004` 的读写适配器。 */
export class EntryRepository {
  readonly #port: ExtractStorePort
  readonly #entryHardCap: number
  readonly #messageHardCap: number
  readonly #readPageSize: number

  constructor(port: ExtractStorePort, options: EntryRepositoryOptions = {}) {
    this.#port = port
    this.#entryHardCap = options.entryHardCap ?? ENTRY_SCAN_HARD_CAP
    this.#messageHardCap = options.messageHardCap ?? MESSAGE_SCAN_HARD_CAP
    this.#readPageSize = Math.min(options.readPageSize ?? READ_PAGE_SIZE, 1000)
  }

  // -------------------------------------------------------------------------
  // 分页与筛选组装
  // -------------------------------------------------------------------------

  /**
   * 规范化模块分页（§4 API-014 / API-015）：页码 ≥ 1、每页 ≥ 1 且 ≤ `PAGE_SIZE_MAX`；
   * 缺省调用（不传）返回第一页（契约声明兼容，§8 决策 4）。
   */
  normalizePage(page: PageRequest | null | undefined, defaultSize: number): ModulePage {
    const pageNumber = normalizePositiveInteger(page?.page ?? null, 1, '页码')
    const pageSize = normalizePositiveInteger(page?.pageSize ?? null, defaultSize, '每页条数')
    if (pageSize > PAGE_SIZE_MAX) {
      throw invalidInput(`每页条数超出上限（${PAGE_SIZE_MAX}）`, { pageSize })
    }
    return { page: pageNumber, pageSize }
  }

  /** 模块口径筛选组装：只保留群 / 时间 / 关键词；身份字段显式忽略（REQ-006、§3.2）。 */
  moduleFilter(filter?: SharedFilter | null): SharedFilter | null {
    if (filter === undefined || filter === null) return null
    return {
      groupIds: filter.groupIds ?? null,
      timeRange: filter.timeRange ?? null,
      keyword: filter.keyword ?? null,
    }
  }

  // -------------------------------------------------------------------------
  // 条目（DM-010）
  // -------------------------------------------------------------------------

  /** 读取一页条目（排序由 `MOD-002` 保证：`src_time DESC, item_id DESC`，§8 决策 4）。 */
  readEntryPage(filter: SharedFilter | null, page: ModulePage): ReadResult<'DM-010'> {
    return this.#port.read('DM-010', this.moduleFilter(filter), { page: page.page, pageSize: page.pageSize })
  }

  /** 分页拼接读取全部命中条目（硬上限截断）。 */
  readEntries(filter?: SharedFilter | null): ReadAllResult<ExtractedItem> {
    const records: ExtractedItem[] = []
    let total = 0
    let page = 1
    const moduleFilter = this.moduleFilter(filter)
    while (records.length < this.#entryHardCap) {
      const pageSize = Math.min(this.#readPageSize, this.#entryHardCap - records.length)
      const result = this.#port.read('DM-010', moduleFilter, { page, pageSize })
      total = result.pageInfo.total
      records.push(...result.records)
      if (result.records.length === 0 || records.length >= total) break
      page += 1
    }
    return { records, total, truncated: records.length < total }
  }

  /** 按条目标识查找（分页早停；不存在返回 null）。 */
  findEntry(entryId: Id, filter?: SharedFilter | null): ExtractedItem | null {
    let page = 1
    let seen = 0
    const moduleFilter = this.moduleFilter(filter)
    while (seen < this.#entryHardCap) {
      const pageSize = Math.min(this.#readPageSize, this.#entryHardCap - seen)
      const result = this.#port.read('DM-010', moduleFilter, { page, pageSize })
      const found = result.records.find((record) => record.entryId === entryId)
      if (found !== undefined) return found
      seen += result.records.length
      if (result.records.length === 0 || seen >= result.pageInfo.total) return null
      page += 1
    }
    return null
  }

  /** 库中是否已有任何条目（空态判定用）。 */
  hasAnyEntry(): boolean {
    const result = this.#port.read('DM-010', null, { page: 1, pageSize: 1 })
    return result.pageInfo.total > 0
  }

  /** 写入条目（按 1000 行 / 2 MB 拆批由实现侧保证；`bumpEpoch` 由调用方声明）。 */
  writeEntries(records: readonly ExtractedItem[], opts?: { bumpEpoch?: boolean }): WriteResult {
    return splitWrite(records).reduce<WriteResult>(
      (acc, batch) => {
        const result = this.#port.write('DM-010', batch, opts)
        return { written: acc.written + result.written, failures: [...acc.failures, ...result.failures] }
      },
      { written: 0, failures: [] },
    )
  }

  /** 分页信息直读（不取记录；`API-014` / `API-015` 的空态与总数判定共用）。 */
  countEntries(filter?: SharedFilter | null): PageInfo {
    const result = this.#port.read('DM-010', this.moduleFilter(filter), { page: 1, pageSize: 1 })
    return result.pageInfo
  }

  // -------------------------------------------------------------------------
  // 来源消息（DM-003）与群 / 成员引用
  // -------------------------------------------------------------------------

  /** 按标识批量取回来源消息（详情正文用；消息已删则结果中缺项）。 */
  readMessagesByIds(ids: readonly Id[], groupId: Id | null): Map<Id, RawMessage> {
    const sink = new Map<Id, RawMessage>()
    const needed = new Set(ids)
    if (needed.size === 0) return sink
    this.#scanMessages(needed, groupId, sink, { remaining: this.#messageHardCap })
    return sink
  }

  /**
   * 为一批条目解析来源消息（§5.2 排序时间的依据）：
   * 按来源群分组扫描，找齐即提前停止；达到扫描硬上限时返回已找到的部分。
   */
  readSourceMessages(entries: readonly ExtractedItem[]): Map<Id, RawMessage> {
    const sink = new Map<Id, RawMessage>()
    const neededByGroup = new Map<Id, Set<Id>>()
    for (const entry of entries) {
      for (const messageId of entry.sourceMessageIds) {
        let needed = neededByGroup.get(entry.groupId)
        if (needed === undefined) {
          needed = new Set<Id>()
          neededByGroup.set(entry.groupId, needed)
        }
        needed.add(messageId)
      }
    }
    const budget = { remaining: this.#messageHardCap }
    for (const [groupId, needed] of neededByGroup) {
      if (budget.remaining <= 0) break
      this.#scanMessages(needed, groupId, sink, budget)
    }
    return sink
  }

  /** 扫描窗口内的原始消息（管线输入；按发送时间倒序返回，由调用方按群分片）。 */
  readWindowMessages(window: ExtractWindow): RawMessage[] {
    const records: RawMessage[] = []
    let page = 1
    while (records.length < this.#messageHardCap) {
      const pageSize = Math.min(this.#readPageSize, this.#messageHardCap - records.length)
      const result = this.#port.read(
        'DM-003',
        { timeRange: { from: window.from, to: window.to } },
        { page, pageSize },
      )
      records.push(...result.records)
      if (result.records.length === 0 || records.length >= result.pageInfo.total) break
      page += 1
    }
    return records
  }

  /** 群标识 → 群名（通知总览「来源」组头；群已删则缺项）。 */
  readGroupNames(): Map<Id, string> {
    const names = new Map<Id, string>()
    let page = 1
    while (names.size < this.#entryHardCap) {
      const result = this.#port.read('DM-002', null, { page, pageSize: this.#readPageSize })
      for (const group of result.records) names.set(group.groupId, group.groupName)
      if (result.records.length === 0 || page * result.pageInfo.pageSize >= result.pageInfo.total) break
      page += 1
    }
    return names
  }

  /** 某群的成员清单（人物要素映射到 DM-004 用）。 */
  readMembers(groupId: Id): GroupMember[] {
    const members: GroupMember[] = []
    let page = 1
    while (members.length < this.#entryHardCap) {
      const result = this.#port.read('DM-004', { groupIds: [groupId] }, { page, pageSize: this.#readPageSize })
      members.push(...result.records)
      if (result.records.length === 0 || members.length >= result.pageInfo.total) break
      page += 1
    }
    return members
  }

  // -------------------------------------------------------------------------
  // 水位事实（§5.2）
  // -------------------------------------------------------------------------

  /**
   * 水位推导事实：库中是否已有条目 + 最新条目（DM-010 排序倒序的第一条）的排序时间。
   * 排序时间 = 该条目全部来源消息中最早的发送时间；来源全部不可解析时为 null（保守回退全量）。
   */
  watermarkFacts(): WatermarkFacts {
    const head = this.#port.read('DM-010', null, { page: 1, pageSize: 1 })
    if (head.pageInfo.total === 0 || head.records.length === 0) {
      return { hasEntries: false, latestEntrySourceTime: null }
    }
    const newest = head.records[0]
    if (newest === undefined || newest.sourceMessageIds.length === 0) {
      return { hasEntries: true, latestEntrySourceTime: null }
    }
    const messages = this.readMessagesByIds(newest.sourceMessageIds, newest.groupId)
    let earliest: Timestamp | null = null
    for (const messageId of newest.sourceMessageIds) {
      const message = messages.get(messageId)
      if (message === undefined) continue
      if (earliest === null || message.sentAt < earliest) earliest = message.sentAt
    }
    return { hasEntries: true, latestEntrySourceTime: earliest }
  }

  // -------------------------------------------------------------------------
  // 内部：消息扫描
  // -------------------------------------------------------------------------

  /** 在一个来源群内分页扫描消息（发送时间倒序），找齐 `needed` 或耗尽预算即停。 */
  #scanMessages(
    needed: Set<Id>,
    groupId: Id | null,
    sink: Map<Id, RawMessage>,
    budget: { remaining: number },
  ): void {
    let page = 1
    const filter: SharedFilter | null = groupId === null ? null : { groupIds: [groupId] }
    while (budget.remaining > 0 && sink.size < needed.size) {
      const pageSize = Math.min(this.#readPageSize, Math.max(1, budget.remaining))
      const result = this.#port.read('DM-003', filter, { page, pageSize })
      if (result.records.length === 0) return
      budget.remaining -= result.records.length
      for (const message of result.records) {
        if (needed.has(message.messageId)) sink.set(message.messageId, message)
      }
      if (page * pageSize >= result.pageInfo.total) return
      page += 1
    }
  }
}

function normalizePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw invalidInput(`${label}非法：应为整数`)
  }
  if (value < 1) throw invalidInput(`${label}非法：须 ≥ 1`, { value })
  return value
}

/** 写批拆分（详设 §3.2：单批上限 1 000 行；批间以条目标识幂等可重放）。 */
function splitWrite<T>(records: readonly T[], batchSize = 1_000): T[][] {
  const batches: T[][] = []
  for (let start = 0; start < records.length; start += batchSize) {
    batches.push(records.slice(start, start + batchSize))
  }
  return batches
}
