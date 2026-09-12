/**
 * 识别与抽取（mod-006 §3.1「pipeline/recognition.ts —— 任务参数构造、结果校验、人物要素映射」）。
 *
 * - 本文件是模块内**唯一构造模型任务参数**的地方之一（另一处 = `topic-cluster.ts`）；一切模型调用
 *   经注入的 `TaskGateway`（`API-007` / `API-008`），模块内不出现模型地址、凭据与 SDK 调用点（§2）。
 * - 结果校验口径（§5.1）：识别类型宽松校验（闭集外新值透传）、优先级严格闭集（越界取「中」）、
 *   要素缺项留空不猜、人物要素映射到 `DM-004` 引用（映射不上的人名不删除、留在事项文本里）。
 * - 条目标识 = 内容哈希（识别类型 + 来源消息集合 + 来源群），天然是写入幂等键：
 *   重放同一批不产生副本（§5.1）。
 */

import type {
  Api007Request,
  ErrorEnvelope,
  GroupMember,
  Id,
  Priority,
  RawMessage,
  RecognitionType,
  TaskOutcome,
  TaskRef,
  TaskResultItem,
  Timestamp,
} from '@shared'
import { PRIORITIES } from '@shared'

import {
  PRIORITIES as MODULE_PRIORITIES,
  RECOGNITION_TYPES,
  TOPIC_MAX_CHARS,
  TOPIC_MIN_CHARS,
} from '../constants'

// ---------------------------------------------------------------------------
// 任务网关（API-007 / API-008 的最小面）
// ---------------------------------------------------------------------------

/** 任务执行与重试的最小接口（测试注入 mock，不真调云端；先例见 `meme/engine/analysisGateway.ts`）。 */
export interface TaskGateway {
  /** `API-007`：执行任务。 */
  execute(req: Api007Request): Promise<TaskOutcome>
  /** `API-008`：按任务引用重试失败 / 超时的任务。 */
  retry(taskRef: TaskRef): Promise<TaskOutcome>
}

const TASK_SCOPE_PREFIX = 'task:'

/** 从失败 / 超时的错误信封取回任务引用（mod-003 约定 `scope = task:<ref>`）。 */
export function taskRefOf(error: ErrorEnvelope): TaskRef | null {
  if (typeof error.scope !== 'string' || !error.scope.startsWith(TASK_SCOPE_PREFIX)) return null
  const ref = error.scope.slice(TASK_SCOPE_PREFIX.length)
  return ref.length > 0 ? ref : null
}

let engineModule: Promise<typeof import('@server/engine')> | null = null

/** 绑定 MOD-003 进程级引擎的默认网关（动态 import：测试注入替身时不加载引擎）。 */
export function createEngineTaskGateway(): TaskGateway {
  return {
    execute: async (req) => {
      engineModule ??= import('@server/engine')
      const engine = await engineModule
      return engine.executeTask(req)
    },
    retry: async (taskRef) => {
      engineModule ??= import('@server/engine')
      const engine = await engineModule
      return engine.retryTask(taskRef)
    },
  }
}

// ---------------------------------------------------------------------------
// 输入单元
// ---------------------------------------------------------------------------

/** 输入单元文本：图片 / 表情包无文本，以类型标记占位（不参与关键词匹配，识别仅作上下文）。 */
export function messageUnitText(message: RawMessage): string {
  const text = message.text?.trim() ?? ''
  if (text.length > 0) return text
  if (message.kind === '图片') return '[图片]'
  if (message.kind === '表情包') return '[表情包]'
  return '[无文本]'
}

/** 消息 → 输入单元（`id` 即来源引用回传的标识）。 */
export function toUnits(messages: readonly RawMessage[]): Array<{ id: Id; text: string }> {
  return messages.map((message) => ({ id: message.messageId, text: messageUnitText(message) }))
}

/**
 * 结果条目的来源引用 → 来源消息标识。
 * `MOD-003` 的编号在整次任务内唯一（= 输入顺序 + 1），故主线程可按同一序号还原标识；
 * 同时容忍模型直接回传消息标识、`[[n]]` / `【消息 n】` 等包裹写法（对齐引擎解析端）。
 */
export function resolveItemSourceIds(item: TaskResultItem, messages: readonly RawMessage[]): Id[] {
  return resolveUnitRefs(
    item,
    messages.map((message) => message.messageId),
  )
}

/** 通用版：结果条目的来源引用 → 输入单元标识（按全任务编号还原，容忍包裹写法）。 */
export function resolveUnitRefs(item: TaskResultItem, unitIds: readonly Id[]): Id[] {
  const values = rawRefValues(item)
  const ids = new Set<Id>()
  for (const raw of values) {
    const token = normalizeRefToken(raw)
    if (token.length === 0) continue
    const byMarker = /^\d+$/.test(token) ? unitIds[Number(token) - 1] : undefined
    if (byMarker !== undefined) {
      ids.add(byMarker)
      continue
    }
    if (unitIds.includes(token)) ids.add(token)
  }
  return [...ids]
}

function rawRefValues(item: TaskResultItem): string[] {
  const refKeys = new Set([
    'sourcerefs',
    'source_refs',
    'sourcereferences',
    'refs',
    'ref',
    'sources',
    'sourceids',
    'source_message_ids',
    '来源引用',
    '引用',
    '来源',
  ])
  const out: string[] = []
  for (const [key, value] of Object.entries(item)) {
    if (!refKeys.has(key.trim().toLowerCase())) continue
    out.push(...flattenRefValue(value))
  }
  return out
}

function flattenRefValue(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((entry) => flattenRefValue(entry))
  if (value !== null && typeof value === 'object' && 'id' in value) {
    return [String((value as { id: unknown }).id)]
  }
  return []
}

function normalizeRefToken(raw: string): string {
  return raw
    .trim()
    .replace(/^[\[【(（]+/, '')
    .replace(/[\]】)）]+$/, '')
    .replace(/^(?:消息|msg|message|ref|source|来源|编号)\s*[:：]?\s*/i, '')
    .trim()
}

// ---------------------------------------------------------------------------
// 识别（API-007 · 任务类型「识别」）
// ---------------------------------------------------------------------------

/** 识别任务的任务说明（基线九类注入提示词；闭集外的新值可透传）。 */
export const RECOGNITION_INSTRUCTION = [
  '从输入消息中识别「通知 / 事项类」消息：群公告、@所有人、接龙、投票、报名、缴费、会议、活动、截止日期九类。',
  '也可给出九类以外的新类型名（2~6 个汉字），不要为普通闲聊输出条目。',
  '每个条目给出：recognitionType（类型名）与 sourceRefs（该条所依据的输入单元编号或标识，至少一个）。',
  '只依据输入消息，不推断、不编造；同一事项只输出一次。',
].join('\n')

/** 识别任务结果约束：类型宽松（非空文本），引用交协议层处理。 */
export function recognitionOutputSchema(): Api007Request['params']['outputSchema'] {
  return {
    type: 'object',
    required: ['recognitionType'],
    properties: {
      recognitionType: { type: 'string' },
      sourceRefs: { type: 'array' },
    },
  }
}

/** 构造识别任务（输入 = 一批消息；引擎按可分块规格逐块调用）。 */
export function buildRecognitionRequest(messages: readonly RawMessage[]): Api007Request {
  return {
    taskType: '识别',
    input: { kind: '消息集合', units: toUnits(messages) },
    params: {
      instruction: RECOGNITION_INSTRUCTION,
      outputSchema: recognitionOutputSchema(),
      options: { recognitionTypes: [...RECOGNITION_TYPES], language: 'zh' },
    },
  }
}

/** 识别结果条目（已解析出来源消息标识）。 */
export interface RecognizedItem {
  recognitionType: RecognitionType
  sourceMessageIds: Id[]
}

/** 校验并解析识别结果（空类型 / 无来源引用的条目丢弃，不落半成品）。 */
export function parseRecognizedItems(items: readonly TaskResultItem[], messages: readonly RawMessage[]): RecognizedItem[] {
  const parsed: RecognizedItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const type = typeof item.recognitionType === 'string' ? item.recognitionType.trim() : ''
    if (type.length === 0) continue
    const sourceMessageIds = resolveItemSourceIds(item, messages)
    if (sourceMessageIds.length === 0) continue
    const key = `${type}\u0000${[...sourceMessageIds].sort().join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    parsed.push({ recognitionType: type, sourceMessageIds })
  }
  return parsed
}

// ---------------------------------------------------------------------------
// 抽取（API-007 · 任务类型「抽取」）
// ---------------------------------------------------------------------------

/** 抽取任务的任务说明（要素口径：缺项留空、不填猜测值）。 */
export function extractionInstruction(recognitionType: string): string {
  return [
    `抽取该「${recognitionType}」条目的要素与总结，只依据输入消息。`,
    '输出字段：',
    '- timeElement：事项发生时间（ISO 8601 字符串；无则留空）',
    '- locationElement：地点（文本；无则留空）',
    '- personElement：出现的人名数组（原文写法；无则空数组）',
    '- subjectElement：事项要点（文本；无则留空）',
    '- deadline：截止时间（ISO 8601 字符串；无则留空）',
    '- headline：一句话总结（不超过 40 字）',
    '- aiSummary：内容总结（2~4 句）',
    '- priority：高 / 中 / 低；无法判定时取「中」',
    '缺项留空、不编造；每个条目带 sourceRefs（所依据的输入单元编号或标识）。',
  ].join('\n')
}

/** 抽取任务结果约束（必填 = 两个总结字段；其余缺项留空）。 */
export function extractionOutputSchema(): Api007Request['params']['outputSchema'] {
  return {
    type: 'object',
    required: ['headline', 'aiSummary'],
    properties: {
      timeElement: { type: 'string' },
      locationElement: { type: 'string' },
      personElement: { type: 'array' },
      subjectElement: { type: 'string' },
      deadline: { type: 'string' },
      headline: { type: 'string' },
      aiSummary: { type: 'string' },
      priority: { type: 'string', enum: [...MODULE_PRIORITIES] },
      sourceRefs: { type: 'array' },
    },
  }
}

/** 构造抽取任务（输入 = 该识别条目的全部来源消息）。 */
export function buildExtractionRequest(recognitionType: string, messages: readonly RawMessage[]): Api007Request {
  return {
    taskType: '抽取',
    input: { kind: '消息集合', units: toUnits(messages) },
    params: {
      instruction: extractionInstruction(recognitionType),
      outputSchema: extractionOutputSchema(),
      options: { language: 'zh' },
    },
  }
}

/** 抽取草稿（写库前的 `DM-010` 要素；主题由聚类阶段补齐）。 */
export interface ExtractedDraft {
  entryId: Id
  groupId: Id
  recognitionType: RecognitionType
  sourceMessageIds: Id[]
  timeElement: Timestamp | null
  locationElement: string | null
  personElementMemberIds: Id[]
  subjectElement: string | null
  deadline: Timestamp | null
  headline: string
  aiSummary: string
  priority: Priority
}

/** 解析抽取结果（必填缺失 → null，由管线记分项失败）。 */
export function parseExtractedDraft(
  item: TaskResultItem,
  context: {
    groupId: Id
    recognitionType: RecognitionType
    sourceMessageIds: Id[]
    members: MemberNameIndex
    /** 来源消息时间（无年份日期就近补年用；缺省则不解析无年份写法）。 */
    sourceTime?: Timestamp | null
  },
): ExtractedDraft | null {
  const headline = textOrNull(item.headline)
  const aiSummary = textOrNull(item.aiSummary)
  if (headline === null || aiSummary === null) return null
  const personNames = stringArray(item.personElement)
  return {
    entryId: buildEntryId(context.groupId, context.recognitionType, context.sourceMessageIds),
    groupId: context.groupId,
    recognitionType: context.recognitionType,
    sourceMessageIds: [...context.sourceMessageIds],
    timeElement: parseTimestamp(item.timeElement, context.sourceTime),
    locationElement: textOrNull(item.locationElement),
    personElementMemberIds: mapPersonNames(personNames, context.members),
    subjectElement: textOrNull(item.subjectElement),
    deadline: parseTimestamp(item.deadline, context.sourceTime),
    headline,
    aiSummary,
    priority: normalizePriority(item.priority),
  }
}

/** 人物名称 → 成员引用索引（同名多候选 / 无候选记为不可映射）。 */
export class MemberNameIndex {
  readonly #byName = new Map<string, Id[]>()

  constructor(members: readonly GroupMember[]) {
    for (const member of members) {
      const name = member.displayName.trim()
      if (name.length === 0) continue
      const list = this.#byName.get(name)
      if (list === undefined) this.#byName.set(name, [member.memberId])
      else list.push(member.memberId)
    }
  }

  /** 唯一命中返回成员标识；无命中或同名多候选返回 null（人名留在事项文本中，§5.1）。 */
  resolve(name: string): Id | null {
    const candidates = this.#byName.get(name.trim())
    if (candidates === undefined || candidates.length !== 1) return null
    return candidates[0] ?? null
  }

  /** 批量映射（去重，保持出现顺序）。 */
  resolveAll(names: readonly string[]): Id[] {
    const ids: Id[] = []
    const seen = new Set<Id>()
    for (const name of names) {
      const id = this.resolve(name)
      if (id === null || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    return ids
  }
}

function mapPersonNames(names: readonly string[], members: MemberNameIndex): Id[] {
  return members.resolveAll(names)
}

/** 优先级严格闭集校验；模型不可判定 / 越界 → 「中」（§8 决策 7）。 */
export function normalizePriority(value: unknown): Priority {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((PRIORITIES as readonly string[]).includes(trimmed)) return trimmed as Priority
  }
  return '中'
}

/** 时间要素解析：epoch 毫秒（需落在合理区间）/ ISO 8601 文本；无年份日期按来源消息时间就近补年；不可解析 → null（不猜，§5.1）。 */
export function parseTimestamp(value: unknown, contextTime?: Timestamp | null): Timestamp | null {
  if (typeof value === 'number') return plausibleEpoch(value)
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length === 0) return null
  if (/^\d+$/.test(text)) return plausibleEpoch(Number(text))
  /* 无年份写法（模型常输出「09-24」「10.15」「9月24日」）：不得交给 Date.parse 回退解析
     （JS 会把它固定成 2001 年）；按来源消息时间就近补年，无上下文则视为不可解析。 */
  const yearless = matchYearlessDate(text)
  if (yearless !== null) {
    if (contextTime === undefined || contextTime === null) return null
    return resolveYearlessDate(yearless, contextTime)
  }
  const parsed = Date.parse(text.includes('T') || /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : text.replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : null
}

/** 无年份日期分解（`M-D` / `M.D` / `M/D` / `M月D日`，可带 `HH:mm`）。 */
interface YearlessDate {
  month: number
  day: number
  hour: number
  minute: number
}

/** epoch 毫秒合理区间（2000-01-01 ~ 2100-01-01）：区间外视为无效数字（如模型误输出的「2026」），不猜。 */
const EPOCH_MIN_MS = 946_684_800_000
const EPOCH_MAX_MS = 4_102_444_800_000

function plausibleEpoch(value: number): Timestamp | null {
  if (!Number.isFinite(value)) return null
  const truncated = Math.trunc(value)
  return truncated >= EPOCH_MIN_MS && truncated <= EPOCH_MAX_MS ? truncated : null
}

function matchYearlessDate(text: string): YearlessDate | null {
  const match =
    /^(\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text) ??
    /^(\d{1,2})月(\d{1,2})日(?:[ T]?(\d{1,2}):(\d{2}))?$/.exec(text)
  if (match === null) return null
  const month = Number(match[1])
  const day = Number(match[2])
  const hour = match[3] === undefined ? 0 : Number(match[3])
  const minute = match[4] === undefined ? 0 : Number(match[4])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  return { month, day, hour, minute }
}

/** 就近补年：在来源年份 ±1 内取与来源消息时间最接近的候选（覆盖「12 月聊 1 月的事」这类跨年语句）。 */
function resolveYearlessDate(date: YearlessDate, contextTime: Timestamp): Timestamp | null {
  const baseYear = new Date(contextTime).getFullYear()
  let best: Timestamp | null = null
  for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
    const candidate = new Date(year, date.month - 1, date.day, date.hour, date.minute).getTime()
    const check = new Date(candidate)
    if (check.getFullYear() !== year || check.getMonth() !== date.month - 1 || check.getDate() !== date.day) continue
    if (best === null || Math.abs(candidate - contextTime) < Math.abs(best - contextTime)) best = candidate
  }
  return best
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim().length === 0 ? [] : [value.trim()]
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length > 0) out.push(trimmed)
  }
  return out
}

/** 主题名合法化（粒度 2 ~ 6 字；非法即返回 null，由聚类阶段按兜底处理）。 */
export function normalizeTopicName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name.length < TOPIC_MIN_CHARS || name.length > TOPIC_MAX_CHARS) return null
  return name
}

// ---------------------------------------------------------------------------
// 条目标识（内容哈希 = 写入幂等键，§5.1）
// ---------------------------------------------------------------------------

/** 条目标识：`entry_` + 内容哈希（来源群 + 识别类型 + 来源消息集合）；重放同一批结果一致。 */
export function buildEntryId(groupId: Id, recognitionType: RecognitionType, sourceMessageIds: readonly Id[]): Id {
  const canonical = [groupId, recognitionType, [...sourceMessageIds].sort().join(',')].join('\u0000')
  return `entry_${fnv1aHex(canonical)}`
}

/** FNV-1a 64 位变体（局部实现，避免依赖与跨模块引用；分布足够、确定性稳定）。 */
function fnv1aHex(text: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0) ?? 0)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}
