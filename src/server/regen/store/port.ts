/**
 * MOD-008 存储端口（mod-008 §2「一切持久化与产物字节经 `API-003` / `API-004`」、§3.1「store/」）。
 *
 * `MOD-002` 的 `Store` 门面结构化满足本端口；测试注入内存实现（§7.3）。
 * 模块内不出现数据库驱动、不触碰应用数据目录（§2 实现侧硬边界）。
 */

import type {
  EntityRecord,
  EntityType,
  PageRequest,
  ReadResult,
  SharedFilter,
  WriteResult,
} from '@shared'

/** 写入选项（与 `MOD-002` 的 `WriteOptions` 同形；`bumpEpoch` 由调用方声明）。 */
export interface StoreWriteOptions {
  bumpEpoch?: boolean
}

/** `API-003` / `API-004` 的最小出入面。 */
export interface StorePort {
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
    opts?: StoreWriteOptions,
  ): WriteResult
}

/** `MOD-002` 的媒体 / 产物双载体通道（详设 §4.4；本模块只经此读写字节）。 */
export interface MediaPort {
  /** 产物字节写入（文件 + 索引双载体；写入者不直接碰应用数据目录）。 */
  writeMedia(ref: string, bytes: Uint8Array, owner?: { entityType: string; entityId: string }): void
  /** 产物 / 媒体读取（路径护栏与存在性判定在存储侧）。 */
  openMedia(ref: string): { bytes: Uint8Array; mime: string }
}

/** 本模块使用的存储面（`API-003` / `API-004` + 媒体通道）。 */
export interface RegenStore extends StorePort, MediaPort {}
