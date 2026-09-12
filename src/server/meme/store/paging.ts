/**
 * 存储读取适配（mod-005 §3.1「store/paging.ts —— 分页读取与护栏」）。
 *
 * - `PagedRead`：按页拼接读取（默认页 1 000），受 `hardCap` 约束；触达硬上限即截断并标记，
 *   截断信息随响应返回（详设 §5.4：截断时返回截断标记与总数）。
 * - 批间让出事件循环（§3.6：主线程分批 ≤ 2 000 行 / 批，批间让出）。
 * - 一切读取经 `API-004`；失败（`STORAGE_UNAVAILABLE`）由调用方原样上抛，不静默吞掉（§6）。
 */

import type { EntityRecord, EntityType, PageRequest, ReadResult } from '@shared'

import { SCAN_BATCH_ROWS } from '../constants'

/** 单页读取函数（绑定到具体实体类型与筛选；由 `MemeStore` 提供）。 */
export type PageReader<T extends EntityType> = (page: PageRequest) => ReadResult<T>

/** 分页读取选项。 */
export interface PagedReadOptions {
  /** 每页条数（默认 1 000 = `API-004` 上限）。 */
  pageSize?: number
  /** 读取硬上限（默认 `READ_HARD_CAP`）。 */
  hardCap?: number
}

const DEFAULT_PAGE_SIZE = 1_000

/** 分页读取迭代器（`AsyncPageIterator`；逐页拼接、硬上限截断）。 */
export class PagedRead<T extends EntityType> implements AsyncIterable<EntityRecord<T>> {
  readonly #reader: PageReader<T>
  readonly #pageSize: number
  readonly #hardCap: number
  #total = 0
  #fetched = 0
  #truncated = false

  constructor(reader: PageReader<T>, options: PagedReadOptions = {}) {
    this.#reader = reader
    this.#pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE)
    this.#hardCap = Math.max(1, options.hardCap ?? Number.MAX_SAFE_INTEGER)
  }

  /** 命中总条数（首读后已知）。 */
  get total(): number {
    return this.#total
  }

  /** 已读取条数。 */
  get fetched(): number {
    return this.#fetched
  }

  /** 是否因硬上限而截断。 */
  get truncated(): boolean {
    return this.#truncated
  }

  async *[Symbol.asyncIterator](): AsyncIterator<EntityRecord<T>> {
    let page = 1
    let done = false
    while (!done) {
      const size = Math.min(this.#pageSize, this.#hardCap - this.#fetched)
      if (size <= 0) {
        this.#truncated = this.#total > this.#fetched
        return
      }
      const result = this.#reader({ page, pageSize: size })
      this.#total = result.pageInfo.total
      for (const record of result.records) {
        yield record
      }
      this.#fetched += result.records.length
      if (result.records.length === 0 || this.#fetched >= result.pageInfo.total) return
      if (this.#fetched >= this.#hardCap) {
        this.#truncated = this.#total > this.#fetched
        return
      }
      if (this.#fetched % SCAN_BATCH_ROWS < size) await yieldToEventLoop()
      page += 1
    }
  }
}

/** 集齐一页读取的全部记录（含截断信息）。 */
export async function collectRead<T extends EntityType>(
  read: PagedRead<T>,
): Promise<{ records: EntityRecord<T>[]; total: number; truncated: boolean }> {
  const records: EntityRecord<T>[] = []
  for await (const record of read) records.push(record)
  return { records, total: read.total, truncated: read.truncated }
}

/** 批间让出事件循环（不阻塞服务进程的响应）。 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
