/**
 * 身份对齐候选的生成与结论提交（mod-007 §3.1「align/」、§8 决策 5、§5.3 状态机；DM-012、`REQ-082`）。
 *
 * - **候选锚定联系人记录（DM-005）**：仅当同一联系人匹配到 ≥ 2 个不同群的群成员时产出；
 * - 候选标识 = 联系人标识 + 群成员集合的规范化哈希（同集合重复生成得到同一标识，幂等）；
 * - **重复生成不覆盖已确认 / 已否定**（`REQ-082`）；未确认与已否定均不生效，相关人按独立个体处理；
 * - 来源（通讯录 / 好友列表）不可用 → `SOURCE_UNAVAILABLE`（`AC-131`），由查询路径判定。
 */

import type { ContactRecord, GroupMember, IdentityCandidate, Id } from '@shared'

import { fnv1aHex } from '../hash'
import { ALIGN_MIN_GROUPS } from './constants'
import { matchLevel, type MatchLevel } from './matching'

/** 候选生成输入（纯函数：不读库、不调模型；O(成员 × 联系人) 段由 worker 执行，见 build/worker-bridge.ts）。 */
export interface AlignInput {
  members: readonly GroupMember[]
  contacts: readonly ContactRecord[]
}

/** 候选标识派生（联系人标识 + 群成员集合的规范化哈希）。 */
export function candidateIdOf(contactId: Id, memberIds: readonly Id[]): Id {
  const normalized = [...memberIds].sort().join('\u0001')
  return `${contactId}@${fnv1aHex(normalized)}`
}

/** 联系人匹配到的群成员（含匹配级别，按级别与成员标识稳定排序）。 */
export interface ContactMatch {
  contact: ContactRecord
  level: MatchLevel
  memberIds: Id[]
}

/** 单联系人匹配（供测试与 worker 分片使用）。 */
export function matchMembersOfContact(
  contact: ContactRecord,
  members: readonly GroupMember[],
): ContactMatch | null {
  const matched: { memberId: Id; level: MatchLevel; groupId: Id }[] = []
  for (const member of members) {
    const level = matchLevel(member.displayName, contact.displayName)
    if (level === null) continue
    matched.push({ memberId: member.memberId, level, groupId: member.groupId })
  }
  const groups = new Set(matched.map((entry) => entry.groupId))
  if (matched.length < 2 || groups.size < ALIGN_MIN_GROUPS) return null
  const best = matched.some((entry) => entry.level === '精确') ? '精确' : matched.some((entry) => entry.level === '包含') ? '包含' : '编辑距离'
  return {
    contact,
    level: best,
    memberIds: matched.map((entry) => entry.memberId).sort(),
  }
}

/** 生成候选映射（状态恒为「未确认」；幂等：同输入同输出同标识）。 */
export function generateCandidates(input: AlignInput): IdentityCandidate[] {
  const candidates = new Map<Id, IdentityCandidate>()
  for (const contact of input.contacts) {
    const match = matchMembersOfContact(contact, input.members)
    if (match === null) continue
    const candidateId = candidateIdOf(contact.contactId, match.memberIds)
    if (candidates.has(candidateId)) continue
    candidates.set(candidateId, {
      candidateId,
      sourceContactId: contact.contactId,
      memberIds: [...match.memberIds],
      status: '未确认',
      confirmedAt: null,
    })
  }
  return [...candidates.values()].sort((left, right) => (left.candidateId < right.candidateId ? -1 : 1))
}

/**
 * 合并候选与既有记录：
 * - 既有候选（任何状态）**不覆盖**（`REQ-082`：重新生成不覆盖已确认 / 已否定，也不重置未确认候选）；
 * - 仅写入新候选。
 */
export function mergeCandidateRecords(
  existing: readonly IdentityCandidate[],
  drafts: readonly IdentityCandidate[],
): IdentityCandidate[] {
  const known = new Set(existing.map((candidate) => candidate.candidateId))
  return drafts.filter((draft) => !known.has(draft.candidateId))
}

/** 结论提交：返回状态变更后的记录（`confirmedAt` 只在「确认」时写入；「否定」清空）。 */
export function applyDecision(
  candidate: IdentityCandidate,
  decision: '确认' | '否定',
  now: number,
): IdentityCandidate {
  const status = decision === '确认' ? '已确认' : '已否定'
  return {
    ...candidate,
    status,
    confirmedAt: decision === '确认' ? now : null,
  }
}
