/**
 * MOD-002 适配层（mod-007 §3.1「store/」）：实体类型常量、分页读取器、批量写入器、`dataEpoch` 观测。
 *
 * - 不直接开库：全部读写经 `API-003` / `API-004`（`SocialStorePort`）；写入只在主线程（详设 §1.1）；
 * - 读取一律**显式分页**（详设 §5.4 护栏：禁止无 `LIMIT` 的列表查询）；本模块只做「实体类型 + 实体键 +
 *   全局筛选条件」的读取（§4 决策 6），不自行扩展契约字段；
 * - 写入按批（≤ 1000 行 / 批）提交，重复写入按记录身份去重（幂等，§5.6）。
 */

import type {
  ContactRecord,
  EntityRecord,
  EntityType,
  Group,
  GroupMember,
  IdentityCandidate,
  InteractionRecord,
  InterestTag,
  MySocialFit,
  PageRequest,
  PairScore,
  Person,
  PersonInterestTag,
  PersonalityTag,
  RawMessage,
  ReadResult,
  SharedFilter,
  TagMergeGroup,
  WriteResult,
} from '@shared'

/** `API-003` / `API-004` 的最小面（结构上兼容 `@server/store` 的 `Store`，测试可注入假实现）。 */
export interface SocialStorePort {
  /** `dataEpoch`：更新完成 / 删除完成 / 改判落库 / 迁移完成时递增（详设 §3.3）。 */
  currentEpoch(): number
  /** `API-004` 按条件读取（分页）。 */
  read<T extends EntityType>(
    type: T,
    filter?: SharedFilter | null,
    page?: PageRequest | null,
  ): ReadResult<T>
  /** `API-003` 写入记录（按记录身份去重）。 */
  write<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    opts?: { bumpEpoch?: boolean },
  ): WriteResult
}

/** 单页上限（`PageRequest.pageSize` 上限 = 1000，mod-002 §4.2）。 */
export const PAGE_SIZE_MAX = 1000
/** 单批写入上限（mod-002 §4.1）。 */
export const WRITE_BATCH_MAX = 1000

/** 把 `@server/store` 的门面接成端口（真实实现；测试注入假端口）。 */
export function createStorePort(port: SocialStorePort): SocialStorePort {
  return port
}

/** 分页读尽某一实体类型（按页循环，直到取满 `total`）。 */
export function readAll<T extends EntityType>(
  port: SocialStorePort,
  type: T,
  filter?: SharedFilter | null,
  pageSize: number = PAGE_SIZE_MAX,
): EntityRecord<T>[] {
  const records: EntityRecord<T>[] = []
  let page = 1
  for (;;) {
    const result = port.read(type, filter ?? null, { page, pageSize })
    records.push(...result.records)
    if (records.length >= result.pageInfo.total || result.records.length === 0) break
    page += 1
  }
  return records
}

/** 按批写入（≤ 1000 行 / 批）；返回失败明细供调用方记录（单条失败不升级为契约错误码）。 */
export function writeAll<T extends EntityType>(
  port: SocialStorePort,
  type: T,
  records: readonly EntityRecord<T>[],
  opts?: { bumpEpoch?: boolean },
): WriteResult {
  const failures: WriteResult['failures'] = []
  let written = 0
  for (let index = 0; index < records.length; index += WRITE_BATCH_MAX) {
    const batch = records.slice(index, index + WRITE_BATCH_MAX)
    const result = port.write(type, batch, opts)
    written += result.written
    failures.push(...result.failures)
  }
  return { written, failures }
}

// ---------------------------------------------------------------------------
// 读取器（实体键由实体类型隐含；§4 决策 6）
// ---------------------------------------------------------------------------

export const readGroups = (port: SocialStorePort, filter?: SharedFilter | null): Group[] =>
  readAll(port, 'DM-002', filter)

export const readMembers = (port: SocialStorePort, filter?: SharedFilter | null): GroupMember[] =>
  readAll(port, 'DM-004', filter)

export const readContacts = (port: SocialStorePort): ContactRecord[] => readAll(port, 'DM-005')

export const readMessages = (port: SocialStorePort, filter?: SharedFilter | null): RawMessage[] =>
  readAll(port, 'DM-003', filter)

export const readPeople = (port: SocialStorePort): Person[] => readAll(port, 'DM-011')

export const readCandidates = (port: SocialStorePort): IdentityCandidate[] => readAll(port, 'DM-012')

export const readTags = (port: SocialStorePort): InterestTag[] => readAll(port, 'DM-013')

export const readPersonTags = (port: SocialStorePort): PersonInterestTag[] => readAll(port, 'DM-014')

export const readMergeGroups = (port: SocialStorePort): TagMergeGroup[] => readAll(port, 'DM-015')

export const readPersonalityTags = (port: SocialStorePort): PersonalityTag[] => readAll(port, 'DM-016')

export const readInteractions = (port: SocialStorePort): InteractionRecord[] => readAll(port, 'DM-017')

export const readPairScores = (port: SocialStorePort): PairScore[] => readAll(port, 'DM-018')

export const readMyFit = (port: SocialStorePort): MySocialFit[] => readAll(port, 'DM-019')

// ---------------------------------------------------------------------------
// 写入器
// ---------------------------------------------------------------------------

export const writePeople = (port: SocialStorePort, records: readonly Person[]): WriteResult =>
  writeAll(port, 'DM-011', records)

export const writeCandidates = (
  port: SocialStorePort,
  records: readonly IdentityCandidate[],
): WriteResult => writeAll(port, 'DM-012', records)

export const writeTags = (port: SocialStorePort, records: readonly InterestTag[]): WriteResult =>
  writeAll(port, 'DM-013', records)

export const writePersonTags = (
  port: SocialStorePort,
  records: readonly PersonInterestTag[],
): WriteResult => writeAll(port, 'DM-014', records)

export const writeMergeGroups = (
  port: SocialStorePort,
  records: readonly TagMergeGroup[],
): WriteResult => writeAll(port, 'DM-015', records)

export const writePersonalityTags = (
  port: SocialStorePort,
  records: readonly PersonalityTag[],
): WriteResult => writeAll(port, 'DM-016', records)

export const writeInteractions = (
  port: SocialStorePort,
  records: readonly InteractionRecord[],
): WriteResult => writeAll(port, 'DM-017', records)

export const writePairScores = (port: SocialStorePort, records: readonly PairScore[]): WriteResult =>
  writeAll(port, 'DM-018', records)

export const writeMyFit = (port: SocialStorePort, record: MySocialFit): WriteResult =>
  writeAll(port, 'DM-019', [record])

// ---------------------------------------------------------------------------
// epoch 观测
// ---------------------------------------------------------------------------

/**
 * `dataEpoch` 观测（§5.2 失效口径）：查询入口调用 `sync()`，
 * epoch 变化即全量失效进程内索引（不引入定时器：本模块无后台常驻行为，`REQ-083`）。
 */
export interface EpochWatcher {
  /** 最近一次观测到的 epoch。 */
  peek(): number
  /** 观测一次；返回 epoch 是否变化（变化 = 索引全量失效）。 */
  sync(): { epoch: number; bumped: boolean }
}

export function createEpochWatcher(port: SocialStorePort): EpochWatcher {
  let last = Number.NaN
  return {
    peek: () => last,
    sync() {
      const epoch = port.currentEpoch()
      const bumped = epoch !== last
      last = epoch
      return { epoch, bumped }
    },
  }
}
