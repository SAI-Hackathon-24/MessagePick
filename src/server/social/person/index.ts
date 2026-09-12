/**
 * 人的同步与身份合并（mod-007 §3.1「person/」、§5.1 DM-011；`REQ-006`、`REQ-082`、`AC-129`、`AC-130`）。
 *
 * 口径：
 * - 未确认映射时一人 = 一个群成员；**只有状态为「已确认」的候选映射**才把群成员合并到同一个人；
 * - 人的标识取成员标识的最小值（合并后仍稳定，派生记录按此键幂等写入）；
 * - 「我」= 含带 Me 标识成员的唯一人（`REQ-006`）；未知标记由活跃度在阶段 2 判定。
 */

import { DIMENSIONS, PERSONALITY_DIMENSIONS, type GroupMember, type IdentityCandidate, type Id, type Person } from '@shared'

/** 同步输入：群成员身份（DM-004）与身份对齐候选（DM-012）。 */
export interface PersonSyncInput {
  members: readonly GroupMember[]
  candidates: readonly IdentityCandidate[]
}

/** 同步结果：人记录（基础行）与「群成员 → 人」映射。 */
export interface PersonSyncResult {
  /** 按 personId 升序的基础行（派生字段为零值，阶段 2 / 5 覆写） */
  persons: Person[]
  /** 群成员标识 → 人标识 */
  personByMember: Map<Id, Id>
}

/** 由群成员身份与已确认映射同步出人集合。 */
export function syncPeople(input: PersonSyncInput): PersonSyncResult {
  const parent = new Map<Id, Id>()
  const find = (memberId: Id): Id => {
    let root = memberId
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as Id
    }
    return root
  }
  const union = (left: Id, right: Id): void => {
    const rootLeft = find(left)
    const rootRight = find(right)
    if (rootLeft === rootRight) return
    // 取字典序小者为根：与「人标识 = 最小成员标识」一致。
    if (rootLeft < rootRight) parent.set(rootRight, rootLeft)
    else parent.set(rootLeft, rootRight)
  }

  for (const member of input.members) {
    if (!parent.has(member.memberId)) parent.set(member.memberId, member.memberId)
  }
  for (const candidate of input.candidates) {
    if (candidate.status !== '已确认') continue
    const [first, ...rest] = candidate.memberIds
    if (first === undefined) continue
    for (const memberId of rest) {
      if (!parent.has(memberId)) parent.set(memberId, memberId)
      if (!parent.has(first)) parent.set(first, first)
      union(first, memberId)
    }
  }

  const memberByRoot = new Map<Id, GroupMember[]>()
  for (const member of input.members) {
    const root = find(member.memberId)
    const bucket = memberByRoot.get(root)
    if (bucket === undefined) memberByRoot.set(root, [member])
    else bucket.push(member)
  }

  const persons: Person[] = []
  const personByMember = new Map<Id, Id>()
  for (const [root, members] of memberByRoot) {
    const memberIds = members.map((member) => member.memberId).sort()
    const personId = memberIds[0] ?? root
    persons.push({
      personId,
      memberIds,
      isMe: members.some((member) => member.isMe),
      unknown: false,
      activity: 0,
      replyMedianMs: null,
      dimensionScores: zeroDimensionScores(),
      personalityScores: zeroPersonalityScores(),
    })
    for (const memberId of memberIds) personByMember.set(memberId, personId)
  }
  persons.sort((left, right) => (left.personId < right.personId ? -1 : 1))
  return { persons, personByMember }
}

/** 解析群成员所属的人（未知成员返回 `undefined`）。 */
export function personOfMember(
  personByMember: ReadonlyMap<Id, Id>,
  memberId: Id,
): Id | undefined {
  return personByMember.get(memberId)
}

/** 展示名（REQ-005：源 = 群成员昵称 / 群名片）：取成员标识最小的群成员的昵称，跨群合并后仍稳定。 */
export function displayNameOf(person: Person, memberById: ReadonlyMap<Id, GroupMember>): string {
  for (const memberId of person.memberIds) {
    const member = memberById.get(memberId)
    if (member !== undefined && member.displayName !== '') return member.displayName
  }
  return person.personId
}

/** 人涉及的群集合（跨全部已采集群）。 */
export function groupsOf(person: Person, memberById: ReadonlyMap<Id, GroupMember>): Set<Id> {
  const groups = new Set<Id>()
  for (const memberId of person.memberIds) {
    const member = memberById.get(memberId)
    if (member !== undefined) groups.add(member.groupId)
  }
  return groups
}

/** 「我的群友」：与「我」至少同属一个群的人（去重到人、排除「我」）。 */
export function myFriendPersonIds(
  me: Person,
  persons: readonly Person[],
  memberById: ReadonlyMap<Id, GroupMember>,
): Id[] {
  const myGroups = groupsOf(me, memberById)
  const friends: Id[] = []
  for (const person of persons) {
    if (person.personId === me.personId) continue
    const groups = groupsOf(person, memberById)
    let shares = false
    for (const groupId of groups) {
      if (myGroups.has(groupId)) {
        shares = true
        break
      }
    }
    if (shares) friends.push(person.personId)
  }
  return friends.sort()
}

/** 「我」（全库至多一人；未就绪时返回 `undefined`，`API-023` 据此返回 `IDENTITY_NOT_READY`）。 */
export function findMe(persons: readonly Person[]): Person | undefined {
  return persons.find((person) => person.isMe)
}

function zeroDimensionScores(): Person['dimensionScores'] {
  const scores = {} as Person['dimensionScores']
  for (const dimension of DIMENSIONS) scores[dimension] = 0
  return scores
}

function zeroPersonalityScores(): Person['personalityScores'] {
  const scores = {} as Person['personalityScores']
  for (const dimension of PERSONALITY_DIMENSIONS) scores[dimension] = 0
  return scores
}
