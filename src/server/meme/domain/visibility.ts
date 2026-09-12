/**
 * 可见性与合并折叠（mod-005 §5.3、§3.1「domain/Visibility」）。
 *
 * 纯函数：无 IO、无时钟。折叠算法：对范围内 `DM-006` 行构建 `source → root` 映射
 * （沿「合并目标」逐跳解析，跳跃上限 32，防御性截断并记 warn）；聚合与展示单位均为 root；
 * root 为「不是梗」时整条链从视图排除。
 */

import type { Id, Meme, MemeCorrection } from '@shared'

import { VISIBILITY_JUMP_LIMIT } from '../constants'

/** 行对视图的暴露状态。 */
export type VisibilityState =
  /** 正常进入词云 / 表格 / 生命周期 / 我相关 / 直访。 */
  | 'visible'
  /** 不感兴趣（或链端为「不感兴趣」）：不进视图，但允许直访（显示改判标记）。 */
  | 'hidden'
  /** 不是梗（或链端为「不是梗」）：不进任何视图，直访返回 `NOT_FOUND`。 */
  | 'excluded'

/** 单行（`DM-006`）的可见性条目。 */
export interface VisibilityEntry {
  memeId: Id
  state: VisibilityState
  /** 合并折叠后的根梗标识；`excluded` 或无法解析时为 null。 */
  rootId: Id | null
  correction: MemeCorrection
  /** 自身为「已合并至」（折叠来源）。 */
  mergedAway: boolean
}

/** 可见性索引（请求内构造，随响应丢弃）。 */
export interface VisibilityIndex {
  entryOf(memeId: Id): VisibilityEntry | undefined
  /** 归一化到根梗；不可见 / 未知返回 null（§3.3 的 `normalize` 语义）。 */
  rootOf(memeId: Id): Id | null
  /** 全部 `visible` 条目（稳定按 memeId 升序）。 */
  visibleEntries(): VisibilityEntry[]
  /** 索引内的全部条目（含 hidden / excluded；稳定按 memeId 升序）。 */
  entries(): VisibilityEntry[]
}

/** 防御性情形的告警出口（默认静默；由调用方接日志口）。 */
export type VisibilityWarn = (event: string, fields?: Record<string, unknown>) => void

interface Resolution {
  rootId: Id | null
  rootCorrection: MemeCorrection | null
}

/**
 * 构建可见性索引。
 *
 * - 合并链终点为「不是梗」→ 链上全部成员 `excluded`；
 * - 终点为「不感兴趣」→ 链上全部成员 `hidden`；
 * - 链断裂（目标不在范围内）/ 成环 / 超过跳跃上限 → 该行 `excluded` 并记 warn（防御性截断）。
 */
export function resolveVisibility(memes: readonly Meme[], onWarn?: VisibilityWarn): VisibilityIndex {
  const byId = new Map<Id, Meme>()
  for (const meme of memes) byId.set(meme.memeId, meme)

  const entries = new Map<Id, VisibilityEntry>()
  for (const meme of memes) {
    const resolved = resolveRoot(meme, byId, onWarn)
    let state: VisibilityState
    if (meme.correction === '不是梗') {
      state = 'excluded'
    } else if (resolved.rootCorrection === '不是梗' || resolved.rootId === null) {
      state = 'excluded'
    } else if (resolved.rootCorrection === '不感兴趣' || meme.correction === '不感兴趣') {
      state = 'hidden'
    } else {
      state = 'visible'
    }
    entries.set(meme.memeId, {
      memeId: meme.memeId,
      state,
      rootId: state === 'excluded' ? null : resolved.rootId,
      correction: meme.correction,
      mergedAway: meme.correction === '已合并至',
    })
  }

  const ordered = [...entries.values()].sort((a, b) => compareIds(a.memeId, b.memeId))
  return {
    entryOf: (memeId) => entries.get(memeId),
    rootOf: (memeId) => entries.get(memeId)?.rootId ?? null,
    visibleEntries: () => ordered.filter((entry) => entry.state === 'visible'),
    entries: () => [...ordered],
  }
}

/** 合并链解析：沿「合并目标」逐跳到链端；异常情形返回 `rootId: null`。 */
function resolveRoot(meme: Meme, byId: ReadonlyMap<Id, Meme>, onWarn?: VisibilityWarn): Resolution {
  let current = meme
  const visited = new Set<Id>([meme.memeId])
  let jumps = 0

  while (current.correction === '已合并至' && current.mergedIntoId !== null) {
    if (jumps >= VISIBILITY_JUMP_LIMIT) {
      onWarn?.('meme.visibility.jump-limit', { memeId: meme.memeId, limit: VISIBILITY_JUMP_LIMIT })
      return { rootId: null, rootCorrection: null }
    }
    const next = byId.get(current.mergedIntoId)
    if (next === undefined) {
      onWarn?.('meme.visibility.chain-broken', { memeId: meme.memeId, missingTarget: current.mergedIntoId })
      return { rootId: null, rootCorrection: null }
    }
    if (visited.has(next.memeId)) {
      onWarn?.('meme.visibility.chain-cycle', { memeId: meme.memeId, at: next.memeId })
      return { rootId: null, rootCorrection: null }
    }
    visited.add(next.memeId)
    current = next
    jumps += 1
  }

  return { rootId: current.memeId, rootCorrection: current.correction }
}

/** 归一化：`memeId` → 根梗；不可见 / 未知 → null（§3.3）。 */
export function normalize(memeId: Id, index: VisibilityIndex): Id | null {
  return index.rootOf(memeId)
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0
}
