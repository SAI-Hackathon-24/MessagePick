/**
 * 构建流水线的阶段实现（mod-007 §3.4 阶段 0 ~ 8、§3.5 任务落点；`REQ-052` ~ `REQ-057`、`REQ-078` ~ `REQ-081`）。
 *
 * 阶段与产出：
 * | 阶段 | 输入 | 产出 | 落库 |
 * | 0 人在同步 | DM-004、DM-012 | 人集合（新建 / 合并 / 保持独立） | DM-011 |
 * | 1 互动扫描 | DM-003（分页 + 引用索引） | 互动记录 | DM-017 |
 * | 2 活跃度与回复时长 | DM-003 计数、DM-017 | 活跃度、回复时长、未知标记 | DM-011 派生字段 |
 * | 3 兴趣抽取 | 逐人消息样本（`API-007` 抽取） | 标签 + 证据 | DM-013、DM-014 |
 * | 4 同义归并 | 二级标签名（`API-007` 聚类） | 归并组与代表标签 | DM-015、DM-013 |
 * | 5 维度分与热度分 | 有效标签、活跃度、已确认性格行 | 五维分、六维分、热度分 | DM-011、DM-013 |
 * | 6 性格推断 | 消息样本（`API-007` 推断） | 六维候选（状态 = 候选） | DM-016 |
 * | 7 身份候选 | DM-004、DM-005 | 候选映射（状态 = 未确认） | DM-012 |
 * | 8 索引物化 | 以上全部 | 进程内索引快照 | 内存（epoch 失效） |
 *
 * 口径要点：
 * - 未知成员（活跃度 < 5）**不进入抽取 / 推断任务输入、不产出任何标签**，五维分与六维分为 0（§8 决策 4）；
 * - 人工增改行（含墓碑）在重算中**不被覆盖**（`REQ-056`、`REQ-076` 的即时生效不被构建推翻）；
 * - 模型任务失败只记入阶段失败明细（含任务引用供 `API-008` 重试），其余人的结果照常落库（§3.4 阶段隔离）。
 */

import {
  DIMENSIONS,
  PERSONALITY_DIMENSIONS,
  ErrorCode,
  type ContactRecord,
  type EntityRecord,
  type EntityType,
  type Api007Request,
  type GroupMember,
  type Id,
  type IdentityCandidate,
  type InteractionRecord,
  type InterestTag,
  type Person,
  type PersonInterestTag,
  type PersonalityTag,
  type RawMessage,
  type SharedFilter,
  type TagMergeGroup,
  type TaskOutcome,
  type TaskRef,
  type TaskResult,
  type TaskUnit,
  type WriteResult,
} from '@shared'

import { mergeCandidateRecords } from '../align'
import { storageUnavailable, type SocialLogger } from '../errors'
import { buildReplyIndex, replyLatencyMedian, scanInteractions } from '../interactions'
import { syncPeople } from '../person'
import {
  applyInferredCandidates,
  parsePersonalityInference,
  personalityScoresOf,
} from '../personality'
import {
  dimensionScores,
  effectiveTags,
  emptyDimensionScores,
  emptyPersonalityScores,
  interestHeat,
  isUnknown,
  type EffectiveTag,
} from '../scoring'
import { parseExtraction, mergeTagRows } from '../tags/extract'
import { applyMergeGroups, parseClusterGroups, planMergeGroups } from '../tags/merge'
import { readAll, writeAll, type SocialStorePort } from '../store'

import { taskRefOf, type SocialTaskGateway } from './gateway'
import { buildIndexSnapshot, joinPersonTagLinks, SocialIndex } from './index-store'
import type { WorkerBridge } from './worker-bridge'

// ---------------------------------------------------------------------------
// 工作区与阶段接口
// ---------------------------------------------------------------------------

/** 构建过程中的读回数据（阶段间传递；避免重复分页读取）。 */
export interface BuildWorkspace {
  members: GroupMember[]
  candidates: IdentityCandidate[]
  messages: RawMessage[]
  interactions: InteractionRecord[]
  tags: InterestTag[]
  links: PersonInterestTag[]
  mergeGroups: TagMergeGroup[]
  persons: Person[]
  personality: PersonalityTag[]
  contacts: ContactRecord[]
  personByMember: Map<Id, Id>
}

/** 空工作区。 */
export function createWorkspace(): BuildWorkspace {
  return {
    members: [],
    candidates: [],
    messages: [],
    interactions: [],
    tags: [],
    links: [],
    mergeGroups: [],
    persons: [],
    personality: [],
    contacts: [],
    personByMember: new Map(),
  }
}

/** 阶段运行环境（依赖全部注入；不建连、不读配置文件）。 */
export interface StageEnv {
  store: SocialStorePort
  gateway: SocialTaskGateway
  bridge: WorkerBridge
  clock: () => number
  logger: SocialLogger
  /** 自然日判定注入点（跨天排除与事件流分箱共用；测试注入确定性日历）。 */
  dayKey?: (at: number) => string
  /** 模型任务重试表（幂等键 = `阶段:作用域`；失败 / 超时的任务引用在此等待 `API-008`）。 */
  retries: Map<string, TaskRef>
  workspace: BuildWorkspace
}

/** 阶段失败明细（错误码只取契约闭集；`taskRef` 供 `API-008` 重试）。 */
export interface StageFailure {
  scope: string
  code: ErrorCode
  message: string
  taskRef?: TaskRef
}

/** 阶段产出：计数 + 失败明细（有失败明细 = 阶段失败，partial 由流水线判定）。 */
export interface StageOutcome {
  counts: Record<string, number>
  failures: StageFailure[]
}

/** 每次模型任务的样本上限（护栏；取最近的消息）。 */
export const SAMPLE_MESSAGE_LIMIT = 200

// ---------------------------------------------------------------------------
// 阶段 0 ~ 8
// ---------------------------------------------------------------------------

/** 阶段 0 人在同步：结构绑定以成员表为准（MOD-002 §5.1），本阶段覆写派生字段与索引映射。 */
export async function runStage0(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const members = readOrThrow(env.store, 'DM-004', 'social.build.stage0.members')
  const candidates = readOrThrow(env.store, 'DM-012', 'social.build.stage0.candidates')
  env.workspace.members = members
  env.workspace.candidates = candidates

  const sync = syncPeople({ members, candidates })
  const existing = new Map(
    readOrThrow(env.store, 'DM-011', 'social.build.stage0.persons').map((row) => [row.personId, row]),
  )
  const rows = sync.persons.map((base) => {
    const previous = existing.get(base.personId)
    return previous === undefined ? base : { ...previous, memberIds: base.memberIds, isMe: base.isMe }
  })
  env.workspace.persons = rows
  env.workspace.personByMember = sync.personByMember
  const written = writeOrCollect(env, 'DM-011', rows, 'social.build.stage0.persons', failures)
  return { counts: { members: members.length, persons: rows.length, written }, failures }
}

/** 阶段 1 互动扫描：每条触发消息只落一条记录（§8 决策 3）；重放按记录身份去重。 */
export async function runStage1(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const messages = readOrThrow(env.store, 'DM-003', 'social.build.stage1.messages')
  env.workspace.messages = messages

  const replies = buildReplyIndex(messages)
  const scanned = scanInteractions(messages, replies, env.dayKey === undefined ? {} : { dayKey: env.dayKey })
  const existing = new Map(
    readOrThrow(env.store, 'DM-017', 'social.build.stage1.existing').map((row) => [row.interactionId, row]),
  )
  const changed = scanned.filter((row) => {
    const previous = existing.get(row.interactionId)
    return previous === undefined || JSON.stringify(previous) !== JSON.stringify(row)
  })
  env.workspace.interactions = scanned
  const written = writeOrCollect(env, 'DM-017', changed, 'social.build.stage1.interactions', failures)
  return { counts: { messages: messages.length, scanned: scanned.length, written }, failures }
}

/** 阶段 2 活跃度与回复时长：跨群合并到人；未知标记按阈值重算（够量 ↔ 未知）。 */
export async function runStage2(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const activityByPerson = new Map<Id, number>()
  for (const message of env.workspace.messages) {
    const personId = env.workspace.personByMember.get(message.senderMemberId)
    if (personId === undefined) continue
    activityByPerson.set(personId, (activityByPerson.get(personId) ?? 0) + 1)
  }
  const latencyByPerson = new Map<Id, InteractionRecord[]>()
  for (const row of env.workspace.interactions) {
    const personId = env.workspace.personByMember.get(row.responseMemberId)
    if (personId === undefined) continue
    const bucket = latencyByPerson.get(personId)
    if (bucket === undefined) latencyByPerson.set(personId, [row])
    else bucket.push(row)
  }

  const rows = env.workspace.persons.map((person) => {
    const activity = activityByPerson.get(person.personId) ?? 0
    const unknown = isUnknown(activity)
    const samples = latencyByPerson.get(person.personId) ?? []
    return {
      ...person,
      activity,
      replyMedianMs: replyLatencyMedian(samples),
      unknown,
      dimensionScores: unknown ? emptyDimensionScores() : person.dimensionScores,
      personalityScores: unknown ? emptyPersonalityScores() : person.personalityScores,
    }
  })
  env.workspace.persons = rows
  const written = writeOrCollect(env, 'DM-011', rows, 'social.build.stage2.persons', failures)
  return {
    counts: { persons: rows.length, unknown: rows.filter((row) => row.unknown).length, written },
    failures,
  }
}

/** 阶段 3 兴趣抽取：逐人样本 → 抽取任务 → 标签与证据落库（无证据不入画像，`REQ-054`）。 */
export async function runStage3(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const messagesById = new Map(env.workspace.messages.map((row) => [row.messageId, row]))
  const existingTags = new Map(
    readOrThrow(env.store, 'DM-013', 'social.build.stage3.tags').map((row) => [row.tagId, row]),
  )
  const existingLinks = new Map(
    readOrThrow(env.store, 'DM-014', 'social.build.stage3.links').map((row) => [linkKey(row.personId, row.tagId), row]),
  )
  const tagRows = new Map(existingTags)
  const linkRows = new Map(existingLinks)
  let dropped = 0
  let tasks = 0

  for (const person of env.workspace.persons) {
    if (person.unknown) continue // 未知成员不进入抽取任务输入（决策 4）
    const samples = sampleMessagesOf(person, env.workspace.messages)
    if (samples.length === 0) continue
    tasks += 1
    const scope = `social.build.stage3:${person.personId}`
    const outcome = await runTask(env, `3:${person.personId}`, extractionRequest(samples), scope)
    if (!outcome.ok) {
      failures.push(outcome.failure)
      continue
    }
    const parsed = parseExtraction(normalizeEvidenceRefs(outcome.outcome.result, outcome.outcome.sourceRefs), {
      personId: person.personId,
      activity: person.activity,
      messages: messagesById,
      now: env.clock(),
    })
    dropped += parsed.dropped
    for (const tag of parsed.tags) {
      const previous = tagRows.get(tag.tagId)
      tagRows.set(tag.tagId, previous === undefined ? tag : mergeTagRows(previous, tag))
    }
    for (const link of parsed.links) {
      const key = linkKey(link.personId, link.tagId)
      const previous = linkRows.get(key)
      if (previous !== undefined && previous.origin === '人工增改') continue // 人工增改（含墓碑）不被重算覆盖
      linkRows.set(key, link)
    }
  }

  env.workspace.tags = [...tagRows.values()]
  env.workspace.links = [...linkRows.values()]
  const changedTags = [...tagRows.values()].filter((row) => JSON.stringify(existingTags.get(row.tagId)) !== JSON.stringify(row))
  const changedLinks = [...linkRows.values()].filter((row) => JSON.stringify(existingLinks.get(linkKey(row.personId, row.tagId))) !== JSON.stringify(row))
  const writtenTags = writeOrCollect(env, 'DM-013', changedTags, 'social.build.stage3.tags', failures)
  const writtenLinks = writeOrCollect(env, 'DM-014', changedLinks, 'social.build.stage3.links', failures)
  return {
    counts: { tasks, tags: tagRows.size, links: linkRows.size, writtenTags, writtenLinks, dropped },
    failures,
  }
}

/** 阶段 4 同义归并：聚类任务 → 归并组与代表标签（归并不改变证据与置信度）。 */
export async function runStage4(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const tagById = new Map(env.workspace.tags.map((tag) => [tag.tagId, tag]))
  const units = [...tagById.values()]
    .sort((left, right) => (left.tagId < right.tagId ? -1 : 1))
    .map((tag) => ({ id: tag.tagId, text: tag.name }))
  if (units.length < 2) {
    env.workspace.mergeGroups = []
    return { counts: { tags: units.length, groups: 0, written: 0 }, failures }
  }

  const outcome = await runTask(env, '4', clusterRequest(units), 'social.build.stage4')
  if (!outcome.ok) {
    failures.push(outcome.failure)
    return { counts: { tags: units.length, groups: 0, written: 0 }, failures }
  }
  const groups = planMergeGroups(parseClusterGroups(outcome.outcome.result), tagById)
  const existingGroups = new Map(
    readOrThrow(env.store, 'DM-015', 'social.build.stage4.existing').map((row) => [row.mergeGroupId, row]),
  )
  const changedGroups = groups.filter((group) => JSON.stringify(existingGroups.get(group.mergeGroupId)) !== JSON.stringify(group))
  const applied = applyMergeGroups([...tagById.values()], groups)
  const changedTags = applied.filter((tag) => JSON.stringify(tagById.get(tag.tagId)) !== JSON.stringify(tag))
  env.workspace.tags = applied
  env.workspace.mergeGroups = groups
  const writtenGroups = writeOrCollect(env, 'DM-015', changedGroups, 'social.build.stage4.groups', failures)
  const writtenTags = writeOrCollect(env, 'DM-013', changedTags, 'social.build.stage4.tags', failures)
  return { counts: { tags: units.length, groups: groups.length, writtenGroups, writtenTags }, failures }
}

/** 阶段 5 维度分与热度分：维度分 = Σ 有效标签置信度；性格六维只统计已确认；热度按归并后标签。 */
export async function runStage5(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const links = joinPersonTagLinks(env.workspace.tags, env.workspace.links)
  const effective = effectiveTags(links, env.workspace.mergeGroups)
  const effectiveByPerson = new Map<Id, EffectiveTag[]>()
  for (const tag of effective) {
    const bucket = effectiveByPerson.get(tag.personId)
    if (bucket === undefined) effectiveByPerson.set(tag.personId, [tag])
    else bucket.push(tag)
  }
  const personality = readOrThrow(env.store, 'DM-016', 'social.build.stage5.personality')
  env.workspace.personality = personality

  const rows = env.workspace.persons.map((person) => {
    if (person.unknown) {
      return { ...person, dimensionScores: emptyDimensionScores(), personalityScores: emptyPersonalityScores() }
    }
    const tags = effectiveByPerson.get(person.personId) ?? []
    return {
      ...person,
      dimensionScores: dimensionScores(tags),
      personalityScores: personalityScoresOf(personality.filter((row) => row.personId === person.personId)),
    }
  })
  env.workspace.persons = rows
  const writtenPersons = writeOrCollect(env, 'DM-011', rows, 'social.build.stage5.persons', failures)

  const heat = tagHeatScores(env.workspace.tags, env.workspace.mergeGroups, effectiveByPerson, rows)
  const nextTags = env.workspace.tags.map((tag) => {
    const score = heat.get(tag.tagId) ?? 0
    return score === tag.heatScore ? tag : { ...tag, heatScore: score }
  })
  const heatRows = nextTags.filter((tag, index) => tag !== env.workspace.tags[index])
  env.workspace.tags = nextTags
  const writtenTags = writeOrCollect(env, 'DM-013', heatRows, 'social.build.stage5.tags', failures)
  return { counts: { persons: rows.length, writtenPersons, writtenTags }, failures }
}

/** 阶段 6 性格推断：六维闭集校验 → 候选落库（未确认不出产物；人工增改 / 已确认不被覆盖）。 */
export async function runStage6(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const existing = readOrThrow(env.store, 'DM-016', 'social.build.stage6.personality')
  env.workspace.personality = existing
  const pending: PersonalityTag[] = []
  let tasks = 0
  let dropped = 0

  for (const person of env.workspace.persons) {
    if (person.unknown) continue
    const samples = sampleMessagesOf(person, env.workspace.messages)
    if (samples.length === 0) continue
    tasks += 1
    const scope = `social.build.stage6:${person.personId}`
    const outcome = await runTask(env, `6:${person.personId}`, personalityRequest(samples), scope)
    if (!outcome.ok) {
      failures.push(outcome.failure)
      continue
    }
    const parsed = parsePersonalityInference(outcome.outcome.result, person.personId)
    dropped += parsed.dropped
    pending.push(...applyInferredCandidates(existing, parsed.rows))
  }

  const written = writeOrCollect(env, 'DM-016', pending, 'social.build.stage6.personality', failures)
  return { counts: { tasks, candidates: pending.length, written, dropped }, failures }
}

/** 阶段 7 身份候选：本地确定性匹配（O(成员 × 联系人) 段在 worker 桥）；不覆盖已有结论。 */
export async function runStage7(env: StageEnv): Promise<StageOutcome> {
  const failures: StageFailure[] = []
  const contacts = readOrThrow(env.store, 'DM-005', 'social.build.stage7.contacts')
  env.workspace.contacts = contacts
  let drafts: IdentityCandidate[]
  try {
    drafts = await env.bridge.generateIdentityCandidates({
      members: env.workspace.members,
      contacts,
    })
  } catch (error) {
    const envelope = toFailure(error, 'social.build.stage7')
    failures.push(envelope)
    return { counts: { contacts: contacts.length, drafted: 0, written: 0 }, failures }
  }
  const newOnes = mergeCandidateRecords(env.workspace.candidates, drafts)
  const written = writeOrCollect(env, 'DM-012', newOnes, 'social.build.stage7.candidates', failures)
  return { counts: { contacts: contacts.length, drafted: drafts.length, written }, failures }
}

/** 阶段 8 索引物化：从 `API-004` 分页读回并物化进程内索引（读路径不触发全表扫描）。 */
export async function runStage8(env: StageEnv, index: SocialIndex): Promise<StageOutcome> {
  const snapshot = buildIndexSnapshot(env.store, env.store.currentEpoch(), env.clock())
  index.setSnapshot(snapshot)
  return {
    counts: {
      persons: snapshot.persons.length,
      tags: snapshot.tags.length,
      interactions: snapshot.interactions.length,
      candidates: snapshot.candidates.length,
    },
    failures: [],
  }
}

// ---------------------------------------------------------------------------
// 任务参数构造（模块内唯一构造模型任务参数的地方；一切调用经 `SocialTaskGateway`）
// ---------------------------------------------------------------------------

/** 抽取任务（`API-007` 抽取）：五类闭集 + 强度 + 证据消息编号。 */
export function extractionRequest(samples: readonly RawMessage[]): Api007Request {
  return {
    taskType: '抽取',
    input: { kind: '消息集合', units: unitsOf(samples) },
    params: {
      instruction:
        '从消息样本中抽取该成员的兴趣标签：二级标签自由命名，但每条必须归属运动 / 艺术 / 游戏 / 娱乐 / 社交五类之一；' +
        '给出抽取强度（0~1，越大越确定）与支撑该标签的证据消息编号。无法给出证据的标签不要输出。',
      outputSchema: {
        type: 'object',
        required: ['name', 'dimension', 'strength', 'evidence'],
        properties: {
          name: { type: 'string' },
          dimension: { type: 'string', enum: [...DIMENSIONS] },
          strength: { type: 'number' },
          evidence: { type: 'array' },
        },
      },
      options: { language: 'zh' },
    },
  }
}

/** 聚类任务（`API-007` 聚类）：同义标签归并组。 */
export function clusterRequest(units: readonly TaskUnit[]): Api007Request {
  return {
    taskType: '聚类',
    input: { kind: '消息集合', units: [...units] },
    params: {
      instruction:
        '把语义相同的二级标签归并为同一条（如「羽毛球 / 打羽球 / 约球」）：每个组给出至少 2 个标签标识；不同语义不要合并。',
      outputSchema: {
        type: 'object',
        required: ['tags'],
        properties: { tags: { type: 'array' } },
      },
      options: { language: 'zh' },
    },
  }
}

/** 推断任务（`API-007` 推断）：性格六维强度。 */
export function personalityRequest(samples: readonly RawMessage[]): Api007Request {
  return {
    taskType: '推断',
    input: { kind: '消息集合', units: unitsOf(samples) },
    params: {
      instruction:
        '按六个固定维度（领导式 / 活泼 / 幽默 / 冷静 / 理性 / 判断）推断该成员的性格标签强度（0~1）；' +
        '没有把握的维度不要输出。',
      outputSchema: {
        type: 'object',
        required: ['dimension', 'strength'],
        properties: {
          dimension: { type: 'string', enum: [...PERSONALITY_DIMENSIONS] },
          strength: { type: 'number' },
        },
      },
      options: { language: 'zh' },
    },
  }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

type TaskSuccess = Extract<TaskOutcome, { ok: true }>

/** 执行一次模型任务：优先重试已失败的任务引用（API-008），否则执行（API-007）。 */
async function runTask(
  env: StageEnv,
  key: string,
  request: Api007Request,
  scope: string,
): Promise<{ ok: true; outcome: TaskSuccess } | { ok: false; failure: StageFailure }> {
  const retryRef = env.retries.get(key)
  let outcome: TaskOutcome
  try {
    outcome =
      retryRef === undefined ? await env.gateway.execute(request) : await env.gateway.retry(retryRef)
  } catch (error) {
    return { ok: false, failure: toFailure(error, scope) }
  }
  if (outcome.ok) {
    env.retries.delete(key)
    return { ok: true, outcome }
  }
  const taskRef = taskRefOf(outcome.error) ?? undefined
  if (taskRef !== undefined) env.retries.set(key, taskRef)
  return {
    ok: false,
    failure: {
      scope,
      code: outcome.error.code,
      message: outcome.error.message,
      ...(taskRef === undefined ? {} : { taskRef }),
    },
  }
}

function toFailure(error: unknown, scope: string): StageFailure {
  if (error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const typed = error as { code: ErrorCode; message: string }
    return { scope, code: typed.code, message: typed.message }
  }
  return {
    scope,
    code: ErrorCode.ANALYSIS_FAILED,
    message: error instanceof Error ? error.message : `未识别的内部异常：${String(error)}`,
  }
}

/** 分页读尽；MOD-002 读失败 → `STORAGE_UNAVAILABLE`（透传，不静默失败）。 */
function readOrThrow<T extends EntityType>(
  store: SocialStorePort,
  type: T,
  scope: string,
  filter: SharedFilter | null = null,
): EntityRecord<T>[] {
  try {
    return readAll(store, type, filter)
  } catch (error) {
    throw storageUnavailable(error, scope)
  }
}

/** 按批写入；逐条失败明细按 `STORAGE_UNAVAILABLE` 记入阶段失败（不静默）。 */
function writeOrCollect<Type extends EntityType>(
  env: StageEnv,
  type: Type,
  rows: readonly EntityRecord<Type>[],
  scope: string,
  failures: StageFailure[],
): number {
  if (rows.length === 0) return 0
  let result: WriteResult
  try {
    result = writeAll(env.store, type, rows)
  } catch (error) {
    throw storageUnavailable(error, scope)
  }
  for (const failure of result.failures) {
    failures.push({ scope, code: ErrorCode.STORAGE_UNAVAILABLE, message: failure.reason })
  }
  return result.written
}

function unitsOf(samples: readonly RawMessage[]): TaskUnit[] {
  return samples.map((row) => ({ id: row.messageId, text: row.text ?? '' }))
}

/** 该人的消息样本：文字消息、按时间升序、取最近 `SAMPLE_MESSAGE_LIMIT` 条。 */
function sampleMessagesOf(person: Person, messages: readonly RawMessage[]): RawMessage[] {
  const memberIds = new Set(person.memberIds)
  const rows = messages
    .filter(
      (row) =>
        memberIds.has(row.senderMemberId) &&
        row.kind === '文字' &&
        typeof row.text === 'string' &&
        row.text.trim() !== '',
    )
    .sort((left, right) => left.sentAt - right.sentAt)
  return rows.slice(-SAMPLE_MESSAGE_LIMIT)
}

/** 证据引用归一：数字 / 编号写法按 `sourceRefs` 顺序还原为消息标识（mod-003 原样回传 TaskUnit.id）。 */
function normalizeEvidenceRefs(result: TaskResult, sourceRefs: readonly string[]): TaskResult {
  return {
    items: result.items.map((item) => {
      const raw = item.evidence
      if (!Array.isArray(raw)) return item
      const evidence = raw
        .map((value) => {
          if (typeof value === 'number') return sourceRefs[value - 1]
          if (typeof value !== 'string') return undefined
          const trimmed = value.trim()
          const numeric = /^\[*【?(\d+)】?\]*$/.exec(trimmed)
          if (numeric !== null) return sourceRefs[Number(numeric[1]) - 1]
          return trimmed
        })
        .filter((value): value is string => typeof value === 'string' && value !== '')
      return { ...item, evidence }
    }),
  }
}

/** 标签热度分：归并后代表标签遍历全部非未知成员；归入标签沿用代表热度（呈现一致）。 */
export function tagHeatScores(
  tags: readonly InterestTag[],
  groups: readonly TagMergeGroup[],
  effectiveByPerson: ReadonlyMap<Id, readonly EffectiveTag[]>,
  persons: readonly Person[],
): Map<Id, number> {
  const representativeOfTag = new Map<Id, Id>()
  for (const group of groups) {
    representativeOfTag.set(group.representativeTagId, group.representativeTagId)
    for (const tagId of group.mergedTagIds) representativeOfTag.set(tagId, group.representativeTagId)
  }
  const knownPersons = new Set(persons.filter((person) => !person.unknown).map((person) => person.personId))
  const stats = persons.map((person) => ({ personId: person.personId, activity: person.activity }))
  const buckets = new Map<Id, EffectiveTag[]>()
  for (const [personId, list] of effectiveByPerson) {
    if (!knownPersons.has(personId)) continue
    for (const tag of list) {
      const representative = representativeOfTag.get(tag.tagId) ?? tag.tagId
      const bucket = buckets.get(representative)
      if (bucket === undefined) buckets.set(representative, [tag])
      else bucket.push(tag)
    }
  }
  const heat = new Map<Id, number>()
  for (const tag of tags) {
    const representative = representativeOfTag.get(tag.tagId) ?? tag.tagId
    if (!heat.has(representative)) {
      heat.set(representative, interestHeat(buckets.get(representative) ?? [], stats))
    }
    if (representative !== tag.tagId) heat.set(tag.tagId, heat.get(representative) as number)
  }
  return heat
}

function linkKey(personId: Id, tagId: string): string {
  return `${personId}\u0001${tagId}`
}
