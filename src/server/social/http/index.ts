/**
 * `API-020` ~ `API-029` 的适配层（mod-007 §3.1「http/」、§3.3、§4；`api-contract.md` 对应条目）。
 *
 * 通用口径（§4）：
 * - **入参先经 `validate.ts` 校验**，结构 / 闭集非法一律 `INVALID_INPUT`，不进业务层（详设 §4.4）；
 * - **线程语义**：查询在主线程做索引化读取 + 轻量组装（单次同步计算 ≤ 50 ms 量级）；组装段无 I/O 副作用；
 * - **副作用顺序**：写操作先落状态，再在同一使用者动作内重算受影响的派生值（`personalityScores` /
 *   `dimensionScores` / 热度分），最后失效内存索引并触发后台重建（`after-write`）；
 * - **可重入 / 幂等**：同一输入重复执输出一致；写路径按记录身份去重（§5.6）；
 * - **触发**：查询发现索引缺失 / epoch 过期 → 后台启动构建（`lazy` / `epoch`），本次请求照常返回现有缓存
 *   （HLD 决策 9「先渲染缓存 + 进度 + 重试」）；
 * - **错误**：全部经 `errors.ts` 抛 `SocialError`（契约错误标识闭集，不新增）；调用方经
 *   `toErrorEnvelope` 得统一信封。`NO_DATA` = 无任何已采集数据；`EMPTY_RESULT` = 有数据但筛选 / 检索无命中。
 *
 * 负向边界（§2）：无定时器与推送、无社交动作、无分享 / 导出通道；`API-029` 与任何列表接口不含性格标签
 * （`REQ-077`）；性格标签仅在 `API-020` 出参中可见且只取「已确认」（`REQ-075`）。
 */

import {
  ErrorCode,
  type Api020Request,
  type Api020Response,
  type Api021Request,
  type Api021Response,
  type Api022Request,
  type Api022Response,
  type Api023Response,
  type Api024Request,
  type Api024Response,
  type Api025Response,
  type Api026Request,
  type Api026Response,
  type Api027Request,
  type Api027Response,
  type Api028Request,
  type Api028Response,
  type Api029Request,
  type Api029Response,
  type EntityRecord,
  type EntityType,
  type Id,
  type IdentityCandidateStatus,
  type IdentityCandidateView,
  type InterestTag,
  type MyAffinityPair,
  type PairScore,
  type PairView,
  type PeopleEntry,
  type Person,
  type PersonInterestTag,
  type PersonalityTag,
  type ProfileView,
  type SharedFilter,
  type TaskOutcome,
} from '@shared'

import { applyDecision } from '../align'
import {
  createEngineTaskGateway,
  taskRefOf,
  type SocialTaskGateway,
} from '../build/gateway'
import type { BuildReport, BuildScope, ProfileBuildPipeline } from '../build/index'
import type { SocialIndex } from '../build/index-store'
import { tagHeatScores } from '../build/stages'
import {
  analysisFailure,
  isSocialError,
  socialError,
  storageUnavailable,
  toErrorEnvelope,
  type SocialLogger,
} from '../errors'
import { interactionCountBetween } from '../interactions'
import { myFriendPersonIds } from '../person'
import {
  personalityScoresOf,
  planPersonalityEdit,
  visiblePersonalityTags,
} from '../personality'
import {
  SCORING_VERSION,
  affinity,
  commonTagsOf,
  dimensionDiffs,
  dimensionScores,
  effectiveTags,
  emptyDimensionScores,
  emptyPersonalityScores,
  isUnknown,
  overallIntegration,
  pairKeyOf,
  type EffectiveTag,
  type FriendStats,
} from '../scoring'
import { readAll, writeAll, type SocialStorePort } from '../store'
import { buildGroupActivityRequest, parseGroupActivityText } from '../suggest'
import { normalizeTagName } from '../tags/normalize'
import { planInterestTagEdit } from '../tags/edits'
import {
  optionalFilter,
  optionalInterestTag,
  requireDimension,
  requireId,
  requireIdList,
  requireIdentityDecision,
  requireInterestAction,
  requirePeopleSearchEntry,
  requirePersonalityAction,
  requirePersonalityDimension,
  requireText,
} from './validate'
import { filterWindowOf, windowActivityOf, windowTagsOf, type FilterWindow } from './window'
import {
  containsKeyword,
  normalizeKeyword,
  peopleEntryOf,
  profileViewOf,
  secondaryTagsOf,
} from './views'

/** 十条接口的模块面（签名级与 §3.3 对应；入出参类型与 `API-020` ~ `API-029` 对齐）。 */
export interface SocialProfileApi {
  /** `API-020` 查询人物画像。 */
  getProfile(request: Api020Request): Promise<Api020Response>
  /** `API-021` 查询兴趣 → 人（跨全部已采集群）。 */
  searchPeople(request: Api021Request): Promise<Api021Response>
  /** `API-022` 查询两人配对。 */
  getPair(request: Api022Request): Promise<Api022Response>
  /** `API-023` 查询「我的社交契合度」（无入参；「我」取 MOD-002 持有的 Me 标识）。 */
  getMyAffinity(): Promise<Api023Response>
  /** `API-024` 生成组局建议（纯文字、不落库）。 */
  suggestGroupActivity(request: Api024Request): Promise<Api024Response>
  /** `API-025` 查询身份对齐候选（无入参）。 */
  listIdentityCandidates(): Promise<Api025Response>
  /** `API-026` 提交身份对齐结论。 */
  submitIdentityDecision(request: Api026Request): Promise<Api026Response>
  /** `API-027` 确认与增删改性格标签（六维闭集）。 */
  editPersonalityTag(request: Api027Request): Promise<Api027Response>
  /** `API-028` 增删改兴趣标签（即时生效）。 */
  editInterestTag(request: Api028Request): Promise<Api028Response>
  /** `API-029` 查询成员兴趣提示（仅已确认数据）。 */
  getInterestHints(request: Api029Request): Promise<Api029Response>
  /** 非契约（外壳用）：按当前筛选预声明构建范围（群级增量；缺省全量）。 */
  ensureIndex?(scope: BuildScope): void
}

/** 装配依赖（全部注入；不建连、不读配置文件）。 */
export interface SocialApiOptions {
  /** `API-003` / `API-004` 端口（MOD-002 适配）。 */
  store: SocialStorePort
  /** 与构建流水线共用的进程内索引（查询取数只经它）。 */
  index: SocialIndex
  /** 构建流水线（查询触发 `lazy` / `epoch`、写后触发 `after-write`）；缺省不触发后台构建。 */
  pipeline?: ProfileBuildPipeline
  /** `API-007` / `API-008` 网关（`API-024` 用）；缺省 = 懒加载 MOD-003 进程级引擎。 */
  gateway?: SocialTaskGateway
  clock?: () => number
  logger?: SocialLogger
}

/** 十条接口的实现（无状态除进程内缓存；索引与缓存的权威数据仍在库内）。 */
export class SocialHttpAdapter implements SocialProfileApi {
  readonly #store: SocialStorePort
  readonly #index: SocialIndex
  readonly #pipeline: ProfileBuildPipeline | undefined
  readonly #gateway: SocialTaskGateway
  readonly #clock: () => number
  readonly #logger: SocialLogger
  /** 进程内契合度缓存（键 = 有序对 + dataEpoch + `SCORING_VERSION`；§5.2 `ScoreIndex`、§5.6 幂等键）。 */
  readonly #pairCache = new Map<string, PairView>()
  /** 外壳预声明的构建范围（最近一次 `ensureIndex`）；查询触发的 `lazy` / `epoch` 沿用它。 */
  #requestedScope: BuildScope = { groupIds: null }

  constructor(options: SocialApiOptions) {
    this.#store = options.store
    this.#index = options.index
    this.#pipeline = options.pipeline
    this.#gateway = options.gateway ?? createEngineTaskGateway()
    this.#clock = options.clock ?? Date.now
    this.#logger = options.logger ?? {}
  }

  // -------------------------------------------------------------------------
  // 查询（API-020 ~ API-023、API-029）
  // -------------------------------------------------------------------------

  async getProfile(request: Api020Request): Promise<Api020Response> {
    const scope = 'social.http.API-020'
    const memberId = requireId(request.memberId, scope, '成员标识')
    const filter = optionalFilter(request.filter, scope)
    this.#kickBuild()
    if (!this.#hasAnyData()) throw noData(scope)

    const personId = this.#resolvePersonId(memberId)
    const person = personId === undefined ? undefined : this.#index.personById(personId)
    if (personId === undefined || person === undefined) {
      throw socialError(ErrorCode.EMPTY_RESULT, '未找到该成员的人画像', { scope })
    }
    if (!this.#personInGroups(person, filter?.groupIds)) {
      throw socialError(ErrorCode.EMPTY_RESULT, '筛选条件下无结果', { scope })
    }

    const window = this.#windowOf(filter)
    const unknown = window.active ? isUnknown(windowActivityOf(person, window)) : person.unknown
    let tags = windowTagsOf(person, this.#index.effectiveTagsOf(personId), window)
    const keyword = normalizeKeyword(filter?.keyword)
    if (keyword !== null) {
      const displayName = this.#index.displayNameOf(personId) ?? personId
      if (!containsKeyword(displayName, keyword)) {
        // 昵称未命中：再按标签名过滤；一条标签都不命中 → 空结果（与 NO_DATA 严格区分）。
        tags = tags.filter((tag) => containsKeyword(tag.name, keyword))
        if (tags.length === 0) {
          throw socialError(ErrorCode.EMPTY_RESULT, '关键词无命中', { scope })
        }
      }
    }
    return profileViewOf({
      person,
      tags,
      personality: this.#index.personalityRowsOf(personId),
      unknown,
    })
  }

  async searchPeople(request: Api021Request): Promise<Api021Response> {
    const scope = 'social.http.API-021'
    const entry = requirePeopleSearchEntry(request.entry, scope)
    const filter = optionalFilter(request.filter, scope)
    this.#kickBuild()
    if (!this.#hasAnyData()) throw noData(scope)

    const window = this.#windowOf(filter)
    const keyword = normalizeKeyword(filter?.keyword)
    const persons = this.#index.persons().filter((person) => this.#personInGroups(person, filter?.groupIds))

    let representativeTagId: Id | null = null
    let dimension: string | null = null
    if (entry === '按一级维度') {
      dimension = requireDimension(request.value, scope)
    } else {
      const value = requireText(request.value, scope, '检索值')
      const target = this.#resolveTag(value)
      if (target === undefined) {
        throw socialError(ErrorCode.EMPTY_RESULT, '该二级标签不存在', { scope })
      }
      representativeTagId = this.#representativeOf(target.tagId)
    }

    const hits: PeopleEntry[] = []
    const unknownTail: PeopleEntry[] = []
    for (const person of persons) {
      const tags = windowTagsOf(person, this.#index.effectiveTagsOf(person.personId), window)
      const activity = windowActivityOf(person, window)
      const unknown = window.active ? isUnknown(activity) : person.unknown
      if (keyword !== null && !this.#keywordHitsPerson(person, tags, keyword)) continue
      const matched =
        representativeTagId === null
          ? tags.some((tag) => tag.dimension === dimension)
          : tags.some((tag) => tag.tagId === representativeTagId)
      const item = peopleEntryOf({
        person,
        displayName: this.#index.displayNameOf(person.personId) ?? person.personId,
        activity,
        unknown,
      })
      if (matched) {
        hits.push(item)
      } else if (representativeTagId === null && unknown) {
        // 决策 4：「仍列出」的落点 = 按一级维度检索结果尾部的「未知成员」分组；按二级标签不含未知。
        unknownTail.push(item)
      }
    }
    if (hits.length === 0 && unknownTail.length === 0) {
      throw socialError(ErrorCode.EMPTY_RESULT, '检索无命中', { scope })
    }
    return { people: [...sortEntries(hits), ...sortEntries(unknownTail)] }
  }

  async getPair(request: Api022Request): Promise<Api022Response> {
    const scope = 'social.http.API-022'
    const memberAId = requireId(request.memberAId, scope, '成员标识 A')
    const memberBId = requireId(request.memberBId, scope, '成员标识 B')
    if (memberAId === memberBId) {
      throw socialError(ErrorCode.INVALID_INPUT, '两人配对的成员标识必须不同', { scope })
    }
    this.#kickBuild()

    const personAId = this.#resolvePersonId(memberAId)
    const personBId = this.#resolvePersonId(memberBId)
    const personA = personAId === undefined ? undefined : this.#index.personById(personAId)
    const personB = personBId === undefined ? undefined : this.#index.personById(personBId)
    if (personA === undefined || personB === undefined) {
      throw socialError(ErrorCode.NOT_FOUND, '成员不存在', { scope })
    }

    const epoch = this.#index.epoch
    const cacheKey =
      epoch === null
        ? null
        : `${personA.personId}\u0001${personB.personId}\u0001${epoch}\u0001${SCORING_VERSION}`
    if (cacheKey !== null) {
      const cached = this.#pairCache.get(cacheKey)
      if (cached !== undefined) return { ...cached, commonTagIds: [...cached.commonTagIds] }
    }

    const tagsA = this.#index.effectiveTagsOf(personA.personId)
    const tagsB = this.#index.effectiveTagsOf(personB.personId)
    // 未知成员无连线（共同爱好者一项为空）；其余因子照常按纯函数计算。
    const common = personA.unknown || personB.unknown ? [] : commonTagsOf(tagsA, tagsB)
    const interactions = interactionCountBetween(
      this.#index.interactions(),
      new Set(personA.memberIds),
      new Set(personB.memberIds),
    )
    const view: PairView = {
      personAId: personA.personId,
      personBId: personB.personId,
      commonTagIds: common.map((tag) => tag.tagId),
      fitScore: affinity(personA, personB, common, interactions),
      dimensionDiffs: dimensionDiffs(scoresOf(personA, tagsA), scoresOf(personB, tagsB)),
    }
    if (cacheKey !== null) this.#pairCache.set(cacheKey, view)
    return { ...view, commonTagIds: [...view.commonTagIds] }
  }

  async getMyAffinity(): Promise<Api023Response> {
    const scope = 'social.http.API-023'
    this.#kickBuild()
    const me = this.#index.me()
    if (me === undefined) {
      throw socialError(ErrorCode.IDENTITY_NOT_READY, '「我」的身份未就绪', { scope })
    }

    const memberById = new Map(this.#index.members().map((member) => [member.memberId, member]))
    const friendIds = myFriendPersonIds(me, this.#index.persons(), memberById)
    const myTags = this.#index.effectiveTagsOf(me.personId)
    const myScores = scoresOf(me, myTags)
    const pairs: MyAffinityPair[] = []
    const pairRows: PairScore[] = []
    const friends: FriendStats[] = []
    for (const friendId of friendIds) {
      const friend = this.#index.personById(friendId)
      if (friend === undefined) continue
      const friendTags = this.#index.effectiveTagsOf(friendId)
      const common = me.unknown || friend.unknown ? [] : commonTagsOf(myTags, friendTags)
      const interactions = interactionCountBetween(
        this.#index.interactions(),
        new Set(me.memberIds),
        new Set(friend.memberIds),
      )
      const fitScore = affinity(me, friend, common, interactions)
      pairs.push({ personId: friend.personId, score: fitScore })
      pairRows.push({
        pairId: pairKeyOf(me.personId, friend.personId),
        personAId: me.personId,
        personBId: friend.personId,
        commonTagIds: common.map((tag) => tag.tagId),
        fitScore,
        dimensionDiffs: dimensionDiffs(myScores, scoresOf(friend, friendTags)),
      })
      friends.push({ personId: friend.personId, activity: friend.activity })
    }
    pairs.sort((left, right) => right.score - left.score || compareIds(left.personId, right.personId))
    return { pairs, overallFit: overallIntegration(pairRows, friends) }
  }

  async getInterestHints(request: Api029Request): Promise<Api029Response> {
    const scope = 'social.http.API-029'
    const memberIds = requireIdList(request.memberIds, scope, '成员标识集合')
    this.#kickBuild()

    const seen = new Set<Id>()
    const hints: Api029Response['hints'] = []
    for (const memberId of memberIds) {
      if (seen.has(memberId)) continue
      seen.add(memberId)
      const personId = this.#resolvePersonId(memberId)
      const person = personId === undefined ? undefined : this.#index.personById(personId)
      if (person === undefined || person.unknown) continue
      const tags = this.#index.effectiveTagsOf(person.personId)
      if (tags.length === 0) continue
      hints.push({ memberId, tags: secondaryTagsOf(tags) })
    }
    if (hints.length === 0) {
      // 集合内全部成员均无已确认数据：调用方静默忽略（不弹错误）。
      throw noData(scope)
    }
    return { hints }
  }

  // -------------------------------------------------------------------------
  // 写操作（API-024 为编排不落库；API-026 ~ API-028 为单事务语义写路径）
  // -------------------------------------------------------------------------

  async suggestGroupActivity(request: Api024Request): Promise<Api024Response> {
    const scope = 'social.http.API-024'
    const interest = requireText(request.interest, scope, '选定兴趣')
    const candidateMemberIds = requireIdList(request.candidateMemberIds, scope, '候选人集合')
    if (candidateMemberIds.length === 0) {
      throw socialError(ErrorCode.EMPTY_RESULT, '没有候选成员（请重新选择兴趣）', { scope })
    }

    const seen = new Set<Id>()
    const candidates = [] as { memberId: Id; displayName: string }[]
    for (const memberId of candidateMemberIds) {
      if (seen.has(memberId)) continue
      seen.add(memberId)
      const personId = this.#resolvePersonId(memberId)
      const displayName =
        personId === undefined ? memberId : this.#index.displayNameOf(personId) ?? memberId
      candidates.push({ memberId: personId ?? memberId, displayName })
    }

    let outcome: TaskOutcome
    try {
      outcome = await this.#gateway.execute(buildGroupActivityRequest({ interest, candidates }))
    } catch (error) {
      if (isSocialError(error)) throw error
      throw analysisFailure(ErrorCode.ANALYSIS_FAILED, messageOf(error, '组局建议生成失败'), scope)
    }
    if (!outcome.ok) {
      // 只透传 TIMEOUT，其余任务失败归 `ANALYSIS_FAILED`（API-024 声明的错误集合；保存任务引用供重试）。
      const code = outcome.error.code === ErrorCode.TIMEOUT ? ErrorCode.TIMEOUT : ErrorCode.ANALYSIS_FAILED
      throw analysisFailure(code, outcome.error.message, scope, taskRefOf(outcome.error) ?? undefined)
    }
    const text = parseGroupActivityText(outcome.result)
    if (text === null) {
      throw socialError(ErrorCode.EMPTY_RESULT, '生成结果为空（不读残缺输出）', { scope })
    }
    // 只出文字、不落库、不生成待办、不执行任何社交动作（REQ-063、REQ-083 ~ REQ-085）。
    return { text }
  }

  async listIdentityCandidates(): Promise<Api025Response> {
    const scope = 'social.http.API-025'
    this.#kickBuild()
    const sources = this.#read('DM-001', scope)
    const contactSource = sources.find((row) => row.source === '通讯录与好友列表')
    if (contactSource === undefined || contactSource.status !== '成功') {
      throw socialError(ErrorCode.SOURCE_UNAVAILABLE, '通讯录 / 好友列表未采集或不可读', { scope })
    }
    const contacts = new Map(this.#index.contacts().map((contact) => [contact.contactId, contact]))
    const candidates: IdentityCandidateView[] = []
    for (const candidate of [...this.#index.candidates()].sort((left, right) =>
      compareIds(left.candidateId, right.candidateId),
    )) {
      const contact = contacts.get(candidate.sourceContactId)
      if (contact === undefined) continue
      candidates.push({
        candidateId: candidate.candidateId,
        memberIds: [...candidate.memberIds],
        source: contact.source,
        sourceContactId: candidate.sourceContactId,
        status: candidate.status,
      })
    }
    return { candidates }
  }

  async submitIdentityDecision(request: Api026Request): Promise<Api026Response> {
    const scope = 'social.http.API-026'
    const candidateId = requireId(request.candidateId, scope, '候选标识')
    const conclusion = requireIdentityDecision(request.conclusion, scope)
    this.#kickBuild()

    const candidate = this.#read('DM-012', scope).find((row) => row.candidateId === candidateId)
    if (candidate === undefined) {
      throw socialError(ErrorCode.NOT_FOUND, '身份对齐候选不存在', { scope })
    }
    const target: IdentityCandidateStatus = conclusion === '确认' ? '已确认' : '已否定'
    if (candidate.status === target) {
      // 同结论重复提交：幂等空操作（不改 `confirmedAt`，不重复触发重建）。
      return { status: target }
    }
    const updated = applyDecision(candidate, conclusion, this.#clock())
    this.#write('DM-012', [updated], scope, { bumpEpoch: true })
    this.#logger.info?.('social.identity.decision', {
      module: 'MOD-007',
      candidateId: updated.candidateId,
      decision: conclusion,
    })
    this.#invalidateAfterWrite()
    return { status: updated.status }
  }

  async editPersonalityTag(request: Api027Request): Promise<Api027Response> {
    const scope = 'social.http.API-027'
    const memberId = requireId(request.memberId, scope, '成员标识')
    const action = requirePersonalityAction(request.action, scope)
    const dimension =
      request.dimension === undefined || request.dimension === null
        ? null
        : requirePersonalityDimension(request.dimension, scope)
    if (action !== '删' && dimension === null) {
      throw socialError(ErrorCode.INVALID_INPUT, '确认 / 增 / 改 操作必须给出六维标签', { scope })
    }
    this.#kickBuild()

    const personId = this.#resolvePersonId(memberId)
    const person =
      personId === undefined
        ? undefined
        : this.#read('DM-011', scope).find((row) => row.personId === personId)
    if (personId === undefined || person === undefined) {
      throw socialError(ErrorCode.NOT_FOUND, '成员不存在', { scope })
    }

    const existing = this.#read('DM-016', scope).filter((row) => row.personId === personId)
    const plan = planPersonalityEdit({
      edit: { memberId, action, dimension },
      personId,
      existing,
      now: this.#clock(),
    })
    if (plan.rows.length === 0) {
      // 幂等空操作（例如重复确认）：不写库、不触发重建。
      return { tags: visiblePersonalityTags(existing, personId) }
    }

    // 1) 先落状态（改判落库 → epoch 递增，全部派生缓存失效）。
    this.#write('DM-016', plan.rows, scope, { bumpEpoch: true })
    // 2) 同一使用者动作内重算受影响的派生值（性格六维分；§5.5）。
    const merged = mergePersonalityRows(existing, plan.rows)
    const scores = person.unknown ? emptyPersonalityScores() : personalityScoresOf(merged)
    if (JSON.stringify(scores) !== JSON.stringify(person.personalityScores)) {
      this.#write('DM-011', [{ ...person, personalityScores: scores }], scope)
    }
    // 3) 失效内存索引并触发后台重建。
    this.#invalidateAfterWrite()
    this.#logger.info?.('social.recompute', { module: 'MOD-007', scope, personId, range: 'personality' })
    return { tags: visiblePersonalityTags(merged, personId) }
  }

  async editInterestTag(request: Api028Request): Promise<Api028Response> {
    const scope = 'social.http.API-028'
    const memberId = requireId(request.memberId, scope, '成员标识')
    const action = requireInterestAction(request.action, scope)
    const tag = optionalInterestTag(request.tag, scope)
    if (tag === null) {
      // 增 / 改 的条件必填在契约中已声明；「删」也需要标签定位（MOD-002 无记录级删除，见 tags/edits.ts）。
      throw socialError(ErrorCode.INVALID_INPUT, `${action} 操作缺少标签（定位所需）`, { scope })
    }
    this.#kickBuild()

    const personId = this.#resolvePersonId(memberId)
    const persons = this.#read('DM-011', scope)
    const person = personId === undefined ? undefined : persons.find((row) => row.personId === personId)
    if (personId === undefined || person === undefined) {
      throw socialError(ErrorCode.NOT_FOUND, '成员不存在', { scope })
    }

    // 写路径以正确性优先：全量读回受影响的实体（读路径仍走进程内索引）。
    const tags = this.#read('DM-013', scope)
    const links = joinLinks(tags, this.#read('DM-014', scope))
    const mergeGroups = this.#read('DM-015', scope)
    const personality = this.#read('DM-016', scope)
    const plan = planInterestTagEdit({
      edit: { memberId, action, tag },
      personId,
      links,
      tags,
      mergeGroups,
      now: this.#clock(),
    })

    if (plan.tagRows.length + plan.linkRows.length > 0) {
      // 1) 先落状态：新增标签本体（如有）+ 人工标签 / 墓碑行；改判落库 → epoch 递增。
      this.#write('DM-013', plan.tagRows, scope, { bumpEpoch: true })
      this.#write('DM-014', plan.linkRows, scope)
      // 2) 同一使用者动作内重算受影响派生值：该人五维分（DM-011）与标签热度分（DM-013；§5.5）。
      const nextTags = upsertTags(tags, plan.tagRows)
      const nextLinks = upsertLinks(links, plan.linkRows, nextTags)
      const effective = effectiveTags(nextLinks, mergeGroups)
      const mine = effective.filter((row) => row.personId === personId)
      const scores = person.unknown ? emptyDimensionScores() : dimensionScores(mine)
      const updatedPerson: Person = { ...person, dimensionScores: scores }
      if (JSON.stringify(scores) !== JSON.stringify(person.dimensionScores)) {
        this.#write('DM-011', [updatedPerson], scope)
      }
      const heat = tagHeatScores(nextTags, mergeGroups, groupEffective(effective), persons)
      const heatRows = nextTags
        .map((row) => ({ tagId: row.tagId, heatScore: heat.get(row.tagId) ?? 0, current: row }))
        .filter((row) => row.heatScore !== row.current.heatScore)
        .map((row) => ({ ...row.current, heatScore: row.heatScore }))
      this.#write('DM-013', heatRows, scope)
      // 3) 失效内存索引并触发后台重建（归并组与索引由构建重算）。
      this.#invalidateAfterWrite()
      this.#logger.info?.('social.recompute', { module: 'MOD-007', scope, personId, range: 'interest' })
      return {
        profile: profileViewOf({ person: updatedPerson, tags: mine, personality, unknown: person.unknown }),
      }
    }

    // 幂等空操作：目标状态与当前一致，不写库；返回最新画像。
    const effective = effectiveTags(links, mergeGroups).filter((row) => row.personId === personId)
    return { profile: profileViewOf({ person, tags: effective, personality, unknown: person.unknown }) }
  }

  // -------------------------------------------------------------------------
  // 触发与索引
  // -------------------------------------------------------------------------

  /** 外壳按当前筛选预声明构建范围（非契约）：随后的查询触发与补跑沿用它。 */
  ensureIndex(scope: BuildScope): void {
    this.#requestedScope = scope
    this.#kickBuild()
  }

  /**
   * 索引缺失 / 陈旧时的后台构建（§3.4 触发口径；不阻塞本次查询——「先渲染缓存 + 进度 + 重试」）。
   * 返回被触发的构建（供测试与外壳预热取数等待）；无需构建时返回 `null`。
   */
  ensureFresh(scope: BuildScope = this.#requestedScope): Promise<BuildReport> | null {
    const pipeline = this.#pipeline
    if (pipeline === undefined) return null
    let epoch: number
    try {
      epoch = this.#store.currentEpoch()
    } catch (error) {
      throw storageUnavailable(error, 'social.index.epoch')
    }
    const requested = scope.groupIds
    if (requested === null || requested.length === 0) {
      // 全量请求不自动触发构建（全量代价极大；构建由「选了群聊」的请求按群增量驱动）。
      return null
    }
    if (!this.#index.available) return pipeline.run('lazy', scope)
    if (this.#index.stale || this.#index.epoch !== epoch) return pipeline.run('epoch', scope)
    // 群级增量：所选群尚未构建过 → 只补缺失的群。
    const missing = this.#index.missingGroups(requested)
    if (missing.length > 0) return pipeline.run('lazy', { groupIds: missing })
    return null
  }

  #kickBuild(): void {
    const promise = this.ensureFresh()
    if (promise !== null) void promise.catch(() => undefined)
  }

  /** 写后失效：标脏索引（保留旧快照供渲染）、清进程内配对缓存、按当前范围触发 `after-write` 重建。 */
  #invalidateAfterWrite(): void {
    this.#index.markStale()
    this.#pairCache.clear()
    const promise = this.#pipeline?.run('after-write', this.#requestedScope)
    if (promise !== undefined) void promise.catch(() => undefined)
  }

  #windowOf(filter: SharedFilter | null): FilterWindow {
    return filterWindowOf(this.#store, this.#index, filter)
  }

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------

  #resolvePersonId(memberId: Id): Id | undefined {
    const byMember = this.#index.personOfMember(memberId)
    if (byMember !== undefined) return byMember
    return this.#index.personById(memberId)?.personId
  }

  #hasAnyData(): boolean {
    const known = this.#index.hasData
    if (known !== undefined) return known
    // 无快照：按 DM-004 / DM-003 各探一页，区分 NO_DATA 与「缓存未就绪」的 EMPTY_RESULT。
    try {
      if (this.#store.read('DM-004', null, { page: 1, pageSize: 1 }).pageInfo.total > 0) return true
      return this.#store.read('DM-003', null, { page: 1, pageSize: 1 }).pageInfo.total > 0
    } catch (error) {
      throw storageUnavailable(error, 'social.query.probe')
    }
  }

  #personInGroups(person: Person, groupIds: readonly Id[] | null | undefined): boolean {
    if (groupIds === undefined || groupIds === null || groupIds.length === 0) return true
    const wanted = new Set(groupIds)
    return person.memberIds.some((memberId) => {
      const member = this.#index.memberById(memberId)
      return member !== undefined && wanted.has(member.groupId)
    })
  }

  /** 关键词命中：昵称命中 → 该人整体命中；未命中 → 该人的任一标签名命中（§4 筛选语义）。 */
  #keywordHitsPerson(person: Person, tags: readonly EffectiveTag[], keyword: string): boolean {
    const displayName = this.#index.displayNameOf(person.personId) ?? person.personId
    if (containsKeyword(displayName, keyword)) return true
    return tags.some((tag) => containsKeyword(tag.name, keyword))
  }

  /** 二级标签定位：先按标识，再按规范化名（`api-contract.md` API-021「二级标签名或标识」）。 */
  #resolveTag(value: string): InterestTag | undefined {
    const byId = this.#index.tagById(value)
    if (byId !== undefined) return byId
    const wanted = normalizeTagName(value)
    return this.#index.tags().find((tag) => normalizeTagName(tag.name) === wanted)
  }

  /** 归并组内取代表标签；未归并取自身。 */
  #representativeOf(tagId: Id): Id {
    const group = this.#index
      .mergeGroups()
      .find((row) => row.representativeTagId === tagId || row.mergedTagIds.includes(tagId))
    return group === undefined ? tagId : group.representativeTagId
  }

  #read<T extends EntityType>(type: T, scope: string): EntityRecord<T>[] {
    try {
      return readAll(this.#store, type)
    } catch (error) {
      throw storageUnavailable(error, scope)
    }
  }

  #write<T extends EntityType>(
    type: T,
    rows: readonly EntityRecord<T>[],
    scope: string,
    opts?: { bumpEpoch?: boolean },
  ): void {
    if (rows.length === 0) return
    let failures: { reason: string }[]
    try {
      failures = writeAll(this.#store, type, rows, opts).failures
    } catch (error) {
      throw storageUnavailable(error, scope)
    }
    if (failures.length > 0) {
      // 写失败时前序状态不落地（同一使用者动作 = 一个事务域）。
      throw socialError(ErrorCode.STORAGE_UNAVAILABLE, '写入未全部成功', {
        scope,
        context: { failed: failures.length, reason: failures[0]?.reason },
      })
    }
  }
}

/** 装配十条接口（组合根 / 测试用法；索引与构建流水线共用同一实例）。 */
export function createSocialProfileApi(options: SocialApiOptions): SocialProfileApi {
  return new SocialHttpAdapter(options)
}

/** 统一信封映射入口（外壳在进程 / 模块边界上使用；见 `errors.ts`）。 */
export { toErrorEnvelope }

// ---------------------------------------------------------------------------
// 内部纯函数（可单测路径均经子模块导出，这里只做视图与状态合并）
// ---------------------------------------------------------------------------

function noData(scope: string) {
  return socialError(ErrorCode.NO_DATA, '尚无任何已采集数据', { scope })
}

function scoresOf(person: Person, tags: readonly EffectiveTag[]) {
  return person.unknown ? emptyDimensionScores() : dimensionScores(tags)
}

function sortEntries(entries: PeopleEntry[]): PeopleEntry[] {
  return [...entries].sort(
    (left, right) => right.activity - left.activity || compareIds(left.personId, right.personId),
  )
}

function compareIds(left: Id, right: Id): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function mergePersonalityRows(
  existing: readonly PersonalityTag[],
  rows: readonly PersonalityTag[],
): PersonalityTag[] {
  const byTagId = new Map(existing.map((row) => [row.tagId, row]))
  for (const row of rows) byTagId.set(row.tagId, row)
  return [...byTagId.values()]
}

function upsertTags(tags: readonly InterestTag[], rows: readonly InterestTag[]): InterestTag[] {
  const byTagId = new Map(tags.map((row) => [row.tagId, row]))
  for (const row of rows) byTagId.set(row.tagId, row)
  return [...byTagId.values()]
}

/** 人-标签链接的连接视图（`DM-014` 记录 + 标签名与一级维度）。 */
type PersonTagLink = PersonInterestTag & { name: string; dimension: InterestTag['dimension'] }

function upsertLinks(
  links: readonly PersonTagLink[],
  rows: readonly PersonInterestTag[],
  tags: readonly InterestTag[],
): PersonTagLink[] {
  const tagById = new Map(tags.map((row) => [row.tagId, row]))
  const byKey = new Map(links.map((row) => [`${row.personId}\u0001${row.tagId}`, row]))
  for (const row of rows) {
    const tag = tagById.get(row.tagId)
    if (tag === undefined) continue
    byKey.set(`${row.personId}\u0001${row.tagId}`, {
      ...row,
      name: tag.name,
      dimension: tag.dimension,
    })
  }
  return [...byKey.values()]
}

function joinLinks(tags: readonly InterestTag[], rows: readonly PersonInterestTag[]): PersonTagLink[] {
  const tagById = new Map(tags.map((row) => [row.tagId, row]))
  return rows.flatMap((row) => {
    const tag = tagById.get(row.tagId)
    return tag === undefined ? [] : [{ ...row, name: tag.name, dimension: tag.dimension }]
  })
}

function groupEffective(tags: readonly EffectiveTag[]): Map<Id, EffectiveTag[]> {
  const byPerson = new Map<Id, EffectiveTag[]>()
  for (const tag of tags) {
    const bucket = byPerson.get(tag.personId)
    if (bucket === undefined) byPerson.set(tag.personId, [tag])
    else bucket.push(tag)
  }
  return byPerson
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message !== '') return error.message
  return fallback
}
