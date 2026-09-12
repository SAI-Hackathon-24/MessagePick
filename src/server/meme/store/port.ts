/**
 * 存储端口（mod-005 §2：一切持久化读写经 `API-003` / `API-004`）。
 *
 * `MOD-002` 的 `Store` 结构化满足本端口；测试注入内存实现。
 * 模块内不出现数据库驱动、不触碰媒体目录（§2 实现侧硬边界）。
 */

import type { EntityRecord, EntityType, PageRequest, ReadResult, SharedFilter, WriteResult } from '@shared'

/** 写入选项（与 `MOD-002` 的 `WriteOptions` 同形）。 */
export interface StoreWriteOptions {
  bumpEpoch?: boolean
}

/** `API-003` / `API-004` 的最小出入面。 */
export interface StorePort {
  /** `API-004` 按条件读取（分页）。 */
  read<T extends EntityType>(type: T, filter?: SharedFilter | null, page?: PageRequest | null): ReadResult<T>
  /** `API-003` 写入记录（按记录身份去重）。 */
  write<T extends EntityType>(type: T, records: readonly EntityRecord<T>[], opts?: StoreWriteOptions): WriteResult
}
