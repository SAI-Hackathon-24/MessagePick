/**
 * 进程内索引（mod-007 §3.1「build/」、§5.2）：查询路径的读取面；权威数据仍在库内（详设 §3.3）。
 *
 * - 索引：`PersonTagIndex`（人 → 有效标签、标签 → 人集）、`InteractionIndex`（互动记录）、
 *   `ScoreIndex`（派生分值的载体 = `Person` / `PairScore` 行）、`CandidateIndex`（未确认候选）；
 * - 载入：构建阶段 8 从 `API-004` 分页读回后物化（`buildIndexSnapshot`）；读路径不触发全表扫描；
 * - 失效：`dataEpoch` 变化 → 全量失效；写操作（`API-026` ~ `API-028`）→ `markStale()` 标脏并触发重建；
 *   标脏期间查询照常返回**旧快照**（「先渲染缓存 + 进度 + 重试」，HLD 决策 9、§4）；
 * - 进程重启即失效（纯内存，无持久化）。
 */

import type {
  ContactRecord,
  GroupMember,
  Id,
  IdentityCandidate,
  InteractionRecord,
  InterestTag,
  Person,
  PersonInterestTag,
  PersonalityTag,
  TagMergeGroup,
} from '@shared'

import { findMe, displayNameOf } from '../person'
import { effectiveTags, type EffectiveTag, type PersonTagLink } from '../scoring'
import { readAll, type SocialStorePort } from '../store'

/** 索引快照（一次构建物化出来的全部查询面数据；不可变使用，整体替换）。 */
export interface SocialIndexSnapshot {
  /** 快照对应的 `dataEpoch` */
  epoch: number
  /** 物化时刻（时钟注入） */
  builtAt: number
  /** 是否有任何已采集数据（群成员身份或消息） */
  hasData: boolean
  persons: Person[]
  personById: Map<Id, Person>
  personByMember: Map<Id, Id>
  members: GroupMember[]
  memberById: Map<Id, GroupMember>
  tags: InterestTag[]
  tagById: Map<Id, InterestTag>
  links: PersonTagLink[]
  mergeGroups: TagMergeGroup[]
  /** 人 → 有效标签（归并后） */
  effectiveByPerson: Map<Id, EffectiveTag[]>
  /** 人 → 性格标签（含候选与人工增改；使用方只取「已确认」） */
  personalityByPerson: Map<Id, PersonalityTag[]>
  candidates: IdentityCandidate[]
  candidateById: Map<Id, IdentityCandidate>
  interactions: InteractionRecord[]
  contacts: ContactRecord[]
  messageCount: number
}

/** 进程内索引：查询路径只经这里取数；`ready` 为假时查询返回空并按构建流程等待（§3.4 触发）。 */
export class SocialIndex {
  #snapshot: SocialIndexSnapshot | null = null
  #stale = false
  /** 群级增量覆盖：全量标志 + 已构建的群集合（触发去重用；随快照一起失效）。 */
  #coverageFull = false
  readonly #coveredGroups = new Set<Id>()

  /** 是否已有可用快照。 */
  get ready(): boolean {
    return this.#snapshot !== null && !this.#stale
  }

  /** 是否有**任意**快照（含已标脏的旧快照；「先渲染缓存」用）。 */
  get available(): boolean {
    return this.#snapshot !== null
  }

  /** 快照是否已标脏（写操作后；查询照常返回旧快照）。 */
  get stale(): boolean {
    return this.#stale
  }

  /** 快照对应的 `dataEpoch`；无快照为空。 */
  get epoch(): number | null {
    return this.#snapshot?.epoch ?? null
  }

  get builtAt(): number | null {
    return this.#snapshot?.builtAt ?? null
  }

  /** 是否有任何已采集数据（无快照时按「未知」处理为 `undefined`）。 */
  get hasData(): boolean | undefined {
    return this.#snapshot?.hasData
  }

  /** 物化快照（构建阶段 8）；覆盖旧快照并清除标脏。 */
  setSnapshot(snapshot: SocialIndexSnapshot): void {
    this.#snapshot = snapshot
    this.#stale = false
  }

  /** 全量失效（epoch 变化 / 进程内重建前）；构建覆盖随快照一起清零。 */
  invalidate(): void {
    this.#snapshot = null
    this.#stale = false
    this.#coverageFull = false
    this.#coveredGroups.clear()
  }

  /** 标记过期（写操作后同步失效相关键的粗粒度落点）：保留旧快照供渲染，同时触发重建。 */
  markStale(): void {
    this.#stale = true
  }

  /** 是否已覆盖全部群（全量构建成功后为真）。 */
  get coverageFull(): boolean {
    return this.#coverageFull
  }

  /** 登记一次构建覆盖的群；`null` = 全量覆盖（吞并历次群级增量）。 */
  markCoverage(groupIds: readonly Id[] | null): void {
    if (groupIds === null) {
      this.#coverageFull = true
      this.#coveredGroups.clear()
      return
    }
    if (this.#coverageFull) return
    for (const groupId of groupIds) this.#coveredGroups.add(groupId)
  }

  /** 请求范围中尚未构建过的群（空数组 = 已全部覆盖；全量请求应检查 `coverageFull`）。 */
  missingGroups(groupIds: readonly Id[]): Id[] {
    if (this.#coverageFull) return []
    return groupIds.filter((groupId) => !this.#coveredGroups.has(groupId))
  }

  /** 排障与测试用：读取快照本体（不复制）。 */
  snapshot(): SocialIndexSnapshot | null {
    return this.#snapshot
  }

  // -------------------------------------------------------------------------
  // 查询面（无快照时返回空；调用方据此返回缓存空态并等待构建）
  // -------------------------------------------------------------------------

  persons(): Person[] {
    return this.#snapshot?.persons ?? []
  }

  personById(personId: Id): Person | undefined {
    return this.#snapshot?.personById.get(personId)
  }

  /** 群成员身份 → 人（未确认映射不合并；§5.1）。 */
  personOfMember(memberId: Id): Id | undefined {
    return this.#snapshot?.personByMember.get(memberId)
  }

  members(): GroupMember[] {
    return this.#snapshot?.members ?? []
  }

  memberById(memberId: Id): GroupMember | undefined {
    return this.#snapshot?.memberById.get(memberId)
  }

  /** 展示名（源 = 群成员昵称 / 群名片；取成员标识最小者，跨群合并后仍稳定）。 */
  displayNameOf(personId: Id): string | undefined {
    const snapshot = this.#snapshot
    if (snapshot === null) return undefined
    const person = snapshot.personById.get(personId)
    if (person === undefined) return undefined
    return displayNameOf(person, snapshot.memberById)
  }

  tags(): InterestTag[] {
    return this.#snapshot?.tags ?? []
  }

  tagById(tagId: Id): InterestTag | undefined {
    return this.#snapshot?.tagById.get(tagId)
  }

  mergeGroups(): TagMergeGroup[] {
    return this.#snapshot?.mergeGroups ?? []
  }

  linksOf(personId: Id): PersonTagLink[] {
    return (this.#snapshot?.links ?? []).filter((link) => link.personId === personId)
  }

  /** 该人的有效标签（归并后；每人每组一条）。 */
  effectiveTagsOf(personId: Id): EffectiveTag[] {
    return this.#snapshot?.effectiveByPerson.get(personId) ?? []
  }

  /** 该人的性格标签全量行（含候选；使用方只取「已确认」）。 */
  personalityRowsOf(personId: Id): PersonalityTag[] {
    return this.#snapshot?.personalityByPerson.get(personId) ?? []
  }

  candidates(): IdentityCandidate[] {
    return this.#snapshot?.candidates ?? []
  }

  candidateById(candidateId: Id): IdentityCandidate | undefined {
    return this.#snapshot?.candidateById.get(candidateId)
  }

  interactions(): InteractionRecord[] {
    return this.#snapshot?.interactions ?? []
  }

  contacts(): ContactRecord[] {
    return this.#snapshot?.contacts ?? []
  }

  messageCount(): number {
    return this.#snapshot?.messageCount ?? 0
  }

  /** 「我」（全库至多一人；无快照或未就绪时为空）。 */
  me(): Person | undefined {
    return findMe(this.persons())
  }
}

/** 把 DM-014 连接行与 DM-013 标签行拼成评分层的输入形态（缺标签的行丢弃）。 */
export function joinPersonTagLinks(
  tags: readonly InterestTag[],
  links: readonly PersonInterestTag[],
): PersonTagLink[] {
  const tagById = new Map(tags.map((tag) => [tag.tagId, tag]))
  const joined: PersonTagLink[] = []
  for (const link of links) {
    const tag = tagById.get(link.tagId)
    if (tag === undefined) continue
    joined.push({ ...link, name: tag.name, dimension: tag.dimension })
  }
  return joined
}

/**
 * 成员索引：`memberId → 代表成员`。
 *
 * ⚠️ 真实数据里**同一个 memberId 会出现在多个群**（登录账号 `me` 在 22 个群里
 * 各有一条 DM-004；实测 4035 条成员只有 3100 个不同 memberId）。
 * 直接用 `new Map(成员.map(m => [m.memberId, m]))` 会让后写覆盖先写：
 *   · 映射塌缩（4035 → 3100）；
 *   · `/me/fit` 的 `index.me()` 取到的那条恰好是 `isMe=false` 的群成员
 *     → `findMe()` 返回 undefined → `API-023`/`API-025` 永远 `IDENTITY_NOT_READY`
 *     → 社交模块整体不可用。
 *
 * 该映射的消费方只需要**单条代表记录**（`isMe` 判定、`displayNameOf` 取昵称），
 * 因此这里按确定规则挑代表：**优先 `isMe = true` 的记录**，
 * 其次首次出现者（与数据顺序无关的稳定结果）。
 */
export function indexMembersById(members: readonly GroupMember[]): Map<Id, GroupMember> {
  const map = new Map<Id, GroupMember>()
  for (const member of members) {
    const existing = map.get(member.memberId)
    if (existing === undefined || (!existing.isMe && member.isMe)) {
      map.set(member.memberId, member)
    }
  }
  return map
}

/** 物化索引快照（构建阶段 8；全部经 `API-004` 分页读回）。 */
export function buildIndexSnapshot(port: SocialStorePort, epoch: number, builtAt: number): SocialIndexSnapshot {
  const members = readAll(port, 'DM-004')
  const persons = readAll(port, 'DM-011')
  const tags = readAll(port, 'DM-013')
  const personTags = readAll(port, 'DM-014')
  const mergeGroups = readAll(port, 'DM-015')
  const personality = readAll(port, 'DM-016')
  const candidates = readAll(port, 'DM-012')
  const interactions = readAll(port, 'DM-017')
  const contacts = readAll(port, 'DM-005')
  const messageCount = port.read('DM-003', null, { page: 1, pageSize: 1 }).pageInfo.total

  const snapshot: SocialIndexSnapshot = {
    epoch,
    builtAt,
    hasData: members.length > 0 || messageCount > 0,
    persons,
    personById: new Map(persons.map((person) => [person.personId, person])),
    personByMember: new Map(),
    members,
    memberById: indexMembersById(members),
    tags,
    tagById: new Map(tags.map((tag) => [tag.tagId, tag])),
    links: joinPersonTagLinks(tags, personTags),
    mergeGroups,
    effectiveByPerson: new Map(),
    personalityByPerson: new Map(),
    candidates,
    candidateById: new Map(candidates.map((candidate) => [candidate.candidateId, candidate])),
    interactions,
    contacts,
    messageCount,
  }

  for (const person of persons) {
    for (const memberId of person.memberIds) snapshot.personByMember.set(memberId, person.personId)
  }
  for (const tag of effectiveTags(snapshot.links, mergeGroups)) {
    const bucket = snapshot.effectiveByPerson.get(tag.personId)
    if (bucket === undefined) snapshot.effectiveByPerson.set(tag.personId, [tag])
    else bucket.push(tag)
  }
  for (const row of personality) {
    const bucket = snapshot.personalityByPerson.get(row.personId)
    if (bucket === undefined) snapshot.personalityByPerson.set(row.personId, [row])
    else bucket.push(row)
  }
  return snapshot
}
