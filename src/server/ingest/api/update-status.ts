/**
 * `API-002` 查询更新状态 —— 契约薄层（mod-001 §3.1「api/update-status.ts」、§4.2、§5.2）。
 *
 * - 调用链：经 `API-004` 读 `DM-001`（两条来源记录）与 `DM-003`（每页条数 = 1，只取命中总数）
 *   （`state/source-state.ts`）；
 * - 派生字段即时计算（不落库、不缓存）：「是否有数据」「记录更新至 X」；
 * - `meMemberId` 经 `DM-004`（成员标识 = `me`）读取 —— 契约出参需要、`DM-001` / `DM-003` 之外的一处读取；
 * - 错误：`API-004` 的 `STORAGE_UNAVAILABLE` **原样冒泡**（`AC-038`），不得转成「无数据」。
 */

import type { UpdateStatus } from '@shared'

import type { Store } from '@server/store'

import { readHasData, readMeMemberId, readSourceStatuses, sourceStatusEntries } from '../state/source-state'

/** 创建 `API-002` 实现（只读、幂等、无进程内缓存；装配见 `index.ts`）。 */
export function createUpdateStatus(options: { store: Store }): () => UpdateStatus {
  const { store } = options

  return () => {
    // 每次调用现读存储（删除 `DM-003` 后「是否有数据」必须立即回落，缓存会破坏这一点；§4.2、AC-029）
    const snapshot = readSourceStatuses(store)
    return {
      hasData: readHasData(store),
      updatedUntilX: snapshot.bySource.get('群消息')?.updatedUntilX ?? null,
      sourceStatuses: sourceStatusEntries(snapshot),
      meMemberId: readMeMemberId(store),
    }
  }
}
