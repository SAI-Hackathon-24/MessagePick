/**
 * 经 `API-003` / `API-004` 的读写适配（mod-008 §3.1「store/regen-store」、§3.4）。
 *
 * - `writeEntities` / `readEntities`：契约 §3.4 的最小出入面（透传 + 失败信封映射）。
 * - 存储侧没有「按标识单读」，一律分页扫描；本文件把分页收敛为显式上限的读取器
 *   （详设 §5.4：不一次拉全量），并保证 `pageInfo.total` 耗尽前不提前停止。
 * - 存储异常（`MOD-002` 的信封）原样透传；无法识别的异常归 `STORAGE_UNAVAILABLE`。
 */

import type {
  EntityRecord,
  EntityType,
  PageRequest,
  ReadResult,
  SharedFilter,
  WriteResult,
} from '@shared'

import { envelopeOf, failStorageUnavailable, RegenError } from '../errors'
import type { RegenStore, StoreWriteOptions } from './port'

/** `API-004`（分页读取）的透传入口。 */
export function readEntities<T extends EntityType>(
  store: RegenStore,
  type: T,
  filter?: SharedFilter | null,
  page?: PageRequest | null,
): ReadResult<T> {
  try {
    return store.read(type, filter, page)
  } catch (error) {
    throw asRegenError(error, `读取 ${type} 失败`)
  }
}

/** `API-003`（写入，按记录身份去重）的透传入口。 */
export function writeEntities<T extends EntityType>(
  store: RegenStore,
  type: T,
  records: readonly EntityRecord<T>[],
  opts?: StoreWriteOptions,
): WriteResult {
  try {
    return store.write(type, records, opts)
  } catch (error) {
    throw asRegenError(error, `写入 ${type} 失败`)
  }
}

/**
 * 写入并要求整批成功：任何失败明细都按 `STORAGE_UNAVAILABLE` 抛出
 * （§6「批次整体失败、状态不变、可原样重试；不静默失败」）。
 */
export function writeAllOrFail<T extends EntityType>(
  store: RegenStore,
  type: T,
  records: readonly EntityRecord<T>[],
  opts?: StoreWriteOptions,
): void {
  if (records.length === 0) return
  const result = writeEntities(store, type, records, opts)
  if (result.failures.length > 0) {
    throw new RegenError({
      ...envelopeOf(null, `写入 ${type} 存在失败明细`),
      message: `写入 ${type} 未整批成功（失败 ${result.failures.length} 条）`,
      context: { entityType: type, failures: result.failures },
    })
  }
}

/** 分页收集选项（显式上限；默认值由调用方按场景给出，见 `constants.ts`）。 */
export interface ReadAllOptions {
  /** 每页条数 */
  pageSize: number
  /** 页数上限（达到上限即停止，返回已读部分） */
  maxPages: number
  /** 命中总数上限（达到即停止） */
  maxRecords?: number
}

/** 分页收集：按稳定排序逐页读取，直到耗尽 / 达到上限。 */
export function readAll<T extends EntityType>(
  store: RegenStore,
  type: T,
  filter: SharedFilter | null,
  options: ReadAllOptions,
): EntityRecord<T>[] {
  const collected: EntityRecord<T>[] = []
  for (let page = 1; page <= options.maxPages; page += 1) {
    const result = readEntities(store, type, filter, { page, pageSize: options.pageSize })
    collected.push(...result.records)
    if (options.maxRecords !== undefined && collected.length >= options.maxRecords) {
      return collected.slice(0, options.maxRecords)
    }
    if (page * result.pageInfo.pageSize >= result.pageInfo.total) return collected
    if (result.records.length === 0) return collected
  }
  return collected
}

/** 按谓词定位单条记录（分页扫描；未命中返回 null）。 */
export function findOne<T extends EntityType>(
  store: RegenStore,
  type: T,
  match: (record: EntityRecord<T>) => boolean,
  options: ReadAllOptions,
): EntityRecord<T> | null {
  for (let page = 1; page <= options.maxPages; page += 1) {
    const result = readEntities(store, type, null, { page, pageSize: options.pageSize })
    for (const record of result.records) {
      if (match(record)) return record
    }
    if (page * result.pageInfo.pageSize >= result.pageInfo.total) return null
    if (result.records.length === 0) return null
  }
  return null
}

/** 按谓词定位多条记录（分页扫描 + 按身份键去重；用于批量装配引用）。 */
export function findMany<T extends EntityType>(
  store: RegenStore,
  type: T,
  match: (record: EntityRecord<T>) => boolean,
  options: ReadAllOptions,
): EntityRecord<T>[] {
  const seen = new Set<EntityRecord<T>>()
  const collected: EntityRecord<T>[] = []
  for (let page = 1; page <= options.maxPages; page += 1) {
    const result = readEntities(store, type, null, { page, pageSize: options.pageSize })
    for (const record of result.records) {
      if (!match(record) || seen.has(record)) continue
      seen.add(record)
      collected.push(record)
    }
    if (page * result.pageInfo.pageSize >= result.pageInfo.total) break
    if (result.records.length === 0) break
  }
  return collected
}

/** 把任意异常收敛为 `RegenError`（存储侧信封原样透传；未知异常归 `STORAGE_UNAVAILABLE`）。 */
function asRegenError(error: unknown, fallbackMessage: string): RegenError {
  if (error instanceof RegenError) return error
  return new RegenError(envelopeOf(error, fallbackMessage))
}

/** 显式拒绝：存储不可用（供适配层在结构不满足时使用）。 */
export function storageUnavailable(message: string, context?: Record<string, unknown>): never {
  failStorageUnavailable(message, context)
}
