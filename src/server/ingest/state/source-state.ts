/**
 * `DM-001` 采集来源状态的读写与派生字段计算（mod-001 §3.1「state/source-state.ts」、§4.2、§5.2）。
 *
 * - 读写一律经 `API-003` / `API-004`（`MOD-002`）；本模块不打开数据库（§2「不持有第二份存储」）。
 * - 派生字段「记录更新至 X」「是否有数据」**计算后写入**（写库后即权威值，`data-model.md` DM-001）；
 *   口径：X = 群消息来源的最近成功时间（只在群消息来源**完整成功**时推进，§5.2、决策 5）；
 *   是否有数据 = 群消息来源存在 ≥ 1 条 `DM-003`。
 * - **不做进程内缓存**：删除后必须立即回落（`AC-029`），缓存会破坏这一点。
 * - 读失败（`STORAGE_UNAVAILABLE`）原样冒泡，不得转成「无数据」（§4.2、`AC-038`）。
 */

import type { CollectSourceStatus, EntityRecord, Id, IngestSource, IngestSourceStatus, Timestamp } from '@shared'
import { INGEST_SOURCES } from '@shared'
import type { Store } from '@server/store'

import type { WriteFailureDetail } from '@shared'
import { ME_MEMBER_ID } from '../mapping/identity'

/** 来源状态表至多两条记录：一页足够（`AC-020` 的下限口径）。 */
const STATUS_PAGE = { page: 1, pageSize: 50 } as const
/** 「是否有数据」只看命中数：每页条数 = 1（§4.3 的声明口径）。 */
const COUNT_PAGE = { page: 1, pageSize: 1 } as const

export interface SourceStatusSnapshot {
  bySource: Map<IngestSource, CollectSourceStatus>
}

/** 读两条来源状态（缺行 = 该来源从未执行过，不补造记录）。 */
export function readSourceStatuses(store: Store): SourceStatusSnapshot {
  const result = store.read('DM-001', null, STATUS_PAGE)
  const bySource = new Map<IngestSource, CollectSourceStatus>()
  for (const record of result.records) bySource.set(record.source, record)
  return { bySource }
}

/** 「是否有数据」= 群消息来源存在至少一条 `DM-003`（即时计算，不落缓存）。 */
export function readHasData(store: Store): boolean {
  return store.read('DM-003', null, COUNT_PAGE).pageInfo.total > 0
}

/** 「我」的成员标识：取 `DM-004` 中成员标识 = `me` 的行使之（CLI 把登录账号渲染为 `me`）。 */
export function readMeMemberId(store: Store): Id | null {
  const rows = readMeRows(store)
  const first = rows[0]
  return first === undefined ? null : first.memberId
}

/**
 * 「我」是否已在库里标记过（`DM-004.isMe`）。
 *
 * `dm004_member` 上有「全库至多一条 `is_me=1`」的部分唯一索引：写第二条真值会落单条失败明细，
 * 并连带让该群「我」的消息因立即外键失败而丢失 —— 因此采集侧先行查一次，只把标记颁给唯一的一行。
 */
export function readMeMarked(store: Store): boolean {
  return readMeRows(store).some((record) => record.isMe)
}

/** 读 `DM-004` 中成员标识 = `me` 的行（各群各一条；条数 = 群数级别，一页足够）。 */
function readMeRows(store: Store): EntityRecord<'DM-004'>[] {
  return store.read('DM-004', { identity: ME_MEMBER_ID }, { page: 1, pageSize: 200 }).records
}

export interface WriteSourceStatusInput {
  source: IngestSource
  status: IngestSourceStatus
  /** 本次完成时刻（成功时给出；失败时为 null） */
  completedAt: Timestamp | null
  /** 失败原因（成功时为空；无授权 / 超时必须给出） */
  failureReason: string | null
}

export interface WriteSourceStatusResult {
  record: EntityRecord<'DM-001'>
  written: number
  failures: WriteFailureDetail[]
}

/**
 * 写一条来源状态（来源结束时写一次该来源的行，决策 7）。
 *
 * 派生字段口径：
 * - X（记录更新至）只在**群消息来源完整成功**时推进到本次完成时刻；其余情况保持库里的旧值；
 * - 是否有数据 = 当前 `DM-003` 是否有记录（群消息来源写入后即时可见，删除后即时回落）。
 */
export function writeSourceStatus(store: Store, input: WriteSourceStatusInput): WriteSourceStatusResult {
  const snapshot = readSourceStatuses(store)
  const group = snapshot.bySource.get('群消息')
  const current = snapshot.bySource.get(input.source)
  const isGroupSource = input.source === '群消息'
  const lastSuccessAt =
    input.status === '成功' ? input.completedAt : (current?.lastSuccessAt ?? null)
  const updatedUntilX =
    isGroupSource && input.status === '成功' ? input.completedAt : (group?.lastSuccessAt ?? null)

  const record: EntityRecord<'DM-001'> = {
    source: input.source,
    status: input.status,
    lastSuccessAt,
    failureReason: input.failureReason,
    updatedUntilX,
    hasData: readHasData(store),
  }
  const result = store.write('DM-001', [record])
  return { record, written: result.written, failures: result.failures }
}

/** 来源状态快照 → `API-002` 的「来源状态」列表（缺行 = 从未执行过 → 不出现在列表里）。 */
export function sourceStatusEntries(
  snapshot: SourceStatusSnapshot,
): { source: IngestSource; status: IngestSourceStatus; at: Timestamp | null }[] {
  const entries: { source: IngestSource; status: IngestSourceStatus; at: Timestamp | null }[] = []
  for (const source of INGEST_SOURCES) {
    const row = snapshot.bySource.get(source)
    if (row === undefined) continue
    // `DM-001` 只有「最近成功时间」一个时间字段（`data-model.md` 未分配「最近状态时间」，不能新增字段）。
    entries.push({ source, status: row.status, at: row.lastSuccessAt })
  }
  return entries
}
