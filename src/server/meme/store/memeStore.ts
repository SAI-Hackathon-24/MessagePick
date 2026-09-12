/**
 * 读写适配（mod-005 §3.1「store/MemeStore」、§3.3 签名级接口）。
 *
 * - 只经 `API-003` / `API-004`；写批按 1 000 行 / 2 MB 拆批（详设 §3.2），拆批在本层完成，
 *   保证任何实现（含测试替身）都收到合规格的批次。
 * - `readAll`：分页拼接 + 硬上限截断标记（`paging.ts`）。
 * - `readAt`：单时间点窄窗（窗宽 ≤ 2 s）+ 一次容错扩窗（§8 决策 1）。
 * - 失败不吞：`API-003` / `API-004` 的错误原样上抛，由上层映射为 `STORAGE_UNAVAILABLE`（§6）。
 */

import type {
  EntityRecord,
  EntityType,
  ReadResult,
  SharedFilter,
  Timestamp,
  WriteResult,
} from '@shared'

import {
  READ_HARD_CAP,
  REF_READ_EXPAND_MS,
  REF_READ_MAX_PAGES,
  REF_READ_PAGE_SIZE,
  REF_READ_WINDOW_MS,
  WRITE_BATCH_BYTES,
  WRITE_BATCH_ROWS,
} from '../constants'
import { PagedRead } from './paging'
import type { StorePort, StoreWriteOptions } from './port'

export interface MemeStoreOptions {
  /** 单请求读取硬上限（默认 `READ_HARD_CAP`）。 */
  hardCap?: number
  /** 分页读取的每页条数（默认 `API-004` 上限 1 000）。 */
  pageSize?: number
}

/** `API-003` / `API-004` 的读写适配器。 */
export class MemeStore {
  readonly #port: StorePort
  readonly #hardCap: number
  readonly #pageSize: number

  constructor(port: StorePort, options: MemeStoreOptions = {}) {
    this.#port = port
    this.#hardCap = options.hardCap ?? READ_HARD_CAP
    this.#pageSize = options.pageSize ?? 1_000
  }

  /** 分页读取（AsyncPageIterator；硬上限截断标记随迭代结束可用）。 */
  readAll<T extends EntityType>(
    type: T,
    filter: SharedFilter | null,
    hardCap: number = this.#hardCap,
  ): PagedRead<T> {
    return new PagedRead<T>((page) => this.#port.read(type, filter, page), {
      pageSize: this.#pageSize,
      hardCap,
    })
  }

  /**
   * 单时间点窄窗读取：窄窗无命中时做一次容错扩窗（§8 决策 1）；窗内返回全部记录，
   * 调用方按标识对号（窄窗内命中极少）。
   */
  async readAt<T extends EntityType>(
    type: T,
    filter: SharedFilter | null,
    timePoint: Timestamp,
  ): Promise<EntityRecord<T>[]> {
    const narrow = await this.#readWindow(type, filter, timePoint, REF_READ_WINDOW_MS)
    if (narrow.length > 0) return narrow
    return await this.#readWindow(type, filter, timePoint, REF_READ_EXPAND_MS)
  }

  /** 写入记录（按批拆分后逐批提交；聚合失败明细，不吞错）。 */
  async upsertEntities<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    opts?: StoreWriteOptions,
  ): Promise<WriteResult> {
    const result: WriteResult = { written: 0, failures: [] }
    for (const batch of splitWriteBatches(records)) {
      const written = this.#port.write(type, batch, opts)
      result.written += written.written
      result.failures.push(...written.failures)
    }
    return result
  }

  async #readWindow<T extends EntityType>(
    type: T,
    filter: SharedFilter | null,
    timePoint: Timestamp,
    halfWindowMs: number,
  ): Promise<EntityRecord<T>[]> {
    const windowFilter: SharedFilter = {
      groupIds: filter?.groupIds ?? null,
      timeRange: { from: timePoint - halfWindowMs, to: timePoint + halfWindowMs },
    }
    const records: EntityRecord<T>[] = []
    for (let page = 1; page <= REF_READ_MAX_PAGES; page += 1) {
      const result: ReadResult<T> = this.#port.read(type, windowFilter, { page, pageSize: REF_READ_PAGE_SIZE })
      records.push(...result.records)
      if (result.records.length === 0 || records.length >= result.pageInfo.total) break
    }
    return records
  }
}

/**
 * 写批拆分（详设 §3.2：单批上限 1 000 行或 2 MB，先到者为限）。
 * 字节估算用 JSON 序列化长度（不做精确编码计算，偏保守即可）。
 */
export function splitWriteBatches<T>(records: readonly T[]): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let currentBytes = 0
  for (const record of records) {
    const size = estimateBytes(record)
    if (current.length > 0 && (current.length >= WRITE_BATCH_ROWS || currentBytes + size > WRITE_BATCH_BYTES)) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(record)
    currentBytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function estimateBytes(record: unknown): number {
  try {
    return JSON.stringify(record)?.length ?? 0
  } catch {
    return 0
  }
}
