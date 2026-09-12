/**
 * 纠正改判规则（mod-005 §3.1「domain/Correction —— 纯规则」、§4 API-012）。
 *
 * 「合并到其他梗」写入前依次校验：目标存在 → 与本梗同群 → 非自环、非成环 → 解析链末端为可见梗；
 * 任一不满足 → 上层映射为 `NOT_FOUND`（§6：契约未给其它标识，原因写 message / context）。
 */

import type { Id, Meme } from '@shared'

import { normalize, type VisibilityIndex } from './visibility'

/** 合并被拒的原因分类（写进错误 message / context，便于使用者与日志定位）。 */
export type MergeRejectReason =
  | 'sourceMissing'
  | 'targetMissing'
  | 'crossGroup'
  | 'selfLoop'
  | 'cycle'
  | 'rootNotVisible'

export type MergeCheck =
  | { ok: true; rootId: Id }
  | { ok: false; reason: MergeRejectReason; detail: string }

/** 合并校验（纯函数）。 */
export function checkMerge(
  sourceId: Id,
  targetId: Id,
  index: VisibilityIndex,
  memes: readonly Meme[],
): MergeCheck {
  const byId = new Map<Id, Meme>()
  for (const meme of memes) byId.set(meme.memeId, meme)

  const source = byId.get(sourceId)
  if (source === undefined) {
    return { ok: false, reason: 'sourceMissing', detail: `梗不存在：${sourceId}` }
  }
  const target = byId.get(targetId)
  if (target === undefined) {
    return { ok: false, reason: 'targetMissing', detail: `合并目标不存在：${targetId}` }
  }
  if (source.groupId !== target.groupId) {
    return { ok: false, reason: 'crossGroup', detail: '合并目标与本梗不属于同一个群' }
  }
  if (target.memeId === source.memeId) {
    return { ok: false, reason: 'selfLoop', detail: '不能合并到自身' }
  }
  if (chainReaches(target, sourceId, byId)) {
    return { ok: false, reason: 'cycle', detail: '合并会形成闭环' }
  }

  const rootId = normalize(target.memeId, index)
  if (rootId === null) {
    return { ok: false, reason: 'rootNotVisible', detail: '合并目标所在链的末端不是可见梗' }
  }
  const rootEntry = index.entryOf(rootId)
  if (rootEntry === undefined || rootEntry.state !== 'visible') {
    return { ok: false, reason: 'rootNotVisible', detail: '合并目标所在链的末端不是可见梗' }
  }
  return { ok: true, rootId }
}

/** 沿目标的「合并目标」链检查是否到达 `needle`（用于成环判定；链本身异常时不额外报错）。 */
function chainReaches(start: Meme, needle: Id, byId: ReadonlyMap<Id, Meme>): boolean {
  let current: Meme | undefined = start
  const visited = new Set<Id>()
  while (current !== undefined && current.correction === '已合并至' && current.mergedIntoId !== null) {
    if (current.mergedIntoId === needle) return true
    if (visited.has(current.memeId)) return false
    visited.add(current.memeId)
    current = byId.get(current.mergedIntoId)
  }
  return false
}
