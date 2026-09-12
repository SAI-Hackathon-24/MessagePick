/**
 * 任务定义与结果校验（mod-005 §3.1「domain/tasks.ts」、§6）。
 *
 * 任务语义与口径以 `engine/taskParams.ts` 的 instruction / outputSchema 交给 MOD-003；
 * 本文件负责**本模块侧的严格校验**：类型闭集、必填字段、来源引用可回指输入单元。
 * 任一非法 ⇒ 该分项不落库（上层按 `ANALYSIS_FAILED` 处理并给重试入口，§6）。
 *
 * 纯函数：无 IO、无依赖（不 import 模型 / 存储）。
 */

import type { Id, Meme, MemeKind, RawMessage, TaskResult, TaskResultItem } from '@shared'

import { ESSENCE_MAX, TYPE_CLOSED_SET } from '../constants'
import { isKnownKind } from './typeCatalog'

/** 本模块的任务分项类型（批次按「任务类型 × 分批窗口」切分，§3.5）。 */
export type MemeTaskKind = '识别' | '变体' | '精华'

export const MEME_TASK_KINDS: readonly MemeTaskKind[] = ['识别', '变体', '精华']

/** 输入单元索引：`marker` = 单元序号（1 起），`id` = 消息 / 梗标识。 */
export interface UnitRef {
  marker: number
  id: Id
}

/** 与 MOD-003 协议一致的来源引用字段名（引擎解析端的容错集合）。 */
const REF_FIELD_NAMES = new Set([
  'sourcerefs',
  'source_refs',
  'sourcereference',
  'sourcereferences',
  'refs',
  'ref',
  'sources',
  '来源引用',
  '引用',
  '来源',
])

/** 校验结果：成功给结构化条目与来源引用；失败给原因（不含消息正文）。 */
export type DraftResult<T> = { ok: true; items: T[]; sourceRefs: Id[] } | { ok: false; reason: string }

/** 识别条目（梗名 / 类型 / 解读三项全部有效才通过）。 */
export interface RecognitionDraft {
  name: string
  kind: MemeKind
  interpretation: string
  messageIds: Id[]
}

/** 变体簇（代表说法名称 + 成员梗标识；同群过滤在解析时完成）。 */
export interface VariantClusterDraft {
  representativeName: string
  memberIds: Id[]
}

/** 精华选取（每条 = 一组可回指的来源消息，展示序号由写入端按返回顺序给定）。 */
export interface EssencePickDraft {
  messageIds: Id[]
}

/**
 * 解析识别结果：条目必须含非空梗名 / 非空解读 / 闭集内类型 / 可回指至少一条消息。
 * 同名条目合并其来源消息（重复输出不产生第二行）。
 */
export function parseRecognition(
  result: TaskResult,
  units: readonly UnitRef[],
  messagesById: ReadonlyMap<Id, RawMessage>,
): DraftResult<RecognitionDraft> {
  const merged = new Map<string, RecognitionDraft>()
  const sourceRefs = new Set<Id>()

  for (const item of result.items) {
    const name = asText(item.name)
    const interpretation = asText(item.interpretation)
    if (name.length === 0) return { ok: false, reason: '识别结果缺少梗名' }
    if (interpretation.length === 0) return { ok: false, reason: `识别结果缺少解读（梗名：${name}）` }
    if (!isKnownKind(item.kind)) {
      return { ok: false, reason: `识别结果类型不在闭集内（梗名：${name}）` }
    }
    const messageIds = resolveRefsToMessages(item, units, messagesById)
    if (messageIds.length === 0) {
      return { ok: false, reason: `识别结果缺少可回指的来源消息（梗名：${name}）` }
    }
    for (const messageId of messageIds) sourceRefs.add(messageId)
    const existing = merged.get(name)
    if (existing === undefined) {
      merged.set(name, { name, kind: item.kind, interpretation, messageIds: [...messageIds] })
    } else {
      for (const messageId of messageIds) {
        if (!existing.messageIds.includes(messageId)) existing.messageIds.push(messageId)
      }
    }
  }

  return { ok: true, items: [...merged.values()], sourceRefs: [...sourceRefs] }
}

/**
 * 解析变体聚类结果：成员取 `members` 字段（`taskParams.ts` 变体协议的必填项），
 * 缺省时回退通用来源引用字段；每个簇至少 2 个可回指且**同群**的梗成员
 * （跨群成员被丢弃，REQ-040）；全部簇无效时按「来源引用缺失」失败。
 */
export function parseVariantClusters(
  result: TaskResult,
  units: readonly UnitRef[],
  memesById: ReadonlyMap<Id, Meme>,
): DraftResult<VariantClusterDraft> {
  const clusters: VariantClusterDraft[] = []
  const sourceRefs = new Set<Id>()

  for (const item of result.items) {
    const representativeName = asText(item.representative ?? item.name)
    const memberIds = resolveRefs(item, units, new Set(memesById.keys()), ['members'])
    if (memberIds.length < 2) continue

    const representative = memberIds[0]
    if (representative === undefined) continue
    const groupId = memesById.get(representative)?.groupId
    if (groupId === undefined) continue
    const sameGroup = memberIds.filter((id) => memesById.get(id)?.groupId === groupId)
    if (sameGroup.length < 2) continue

    for (const id of sameGroup) sourceRefs.add(id)
    clusters.push({ representativeName, memberIds: sameGroup })
  }

  if (clusters.length === 0 && result.items.length > 0) {
    return { ok: false, reason: '变体聚类结果缺少可回指的同群成员' }
  }
  return { ok: true, items: clusters, sourceRefs: [...sourceRefs] }
}

/**
 * 解析精华选取：按返回顺序保留可回指的来源消息；空结果按「来源引用缺失」失败。
 * 返回的条目已按顺序摊平上限 `ESSENCE_MAX` 条消息。
 */
export function parseEssencePicks(
  result: TaskResult,
  units: readonly UnitRef[],
  messageIds: ReadonlySet<Id>,
): DraftResult<EssencePickDraft> {
  const picks: EssencePickDraft[] = []
  const sourceRefs = new Set<Id>()

  for (const item of result.items) {
    const resolved = resolveRefs(item, units, messageIds)
    if (resolved.length === 0) continue
    for (const id of resolved) sourceRefs.add(id)
    picks.push({ messageIds: resolved })
  }

  if (picks.length === 0) {
    return { ok: false, reason: '精华选取结果缺少可回指的来源消息' }
  }

  const capped: EssencePickDraft[] = []
  let budget = ESSENCE_MAX
  for (const pick of picks) {
    if (budget <= 0) break
    const taken = pick.messageIds.slice(0, budget)
    capped.push({ messageIds: taken })
    budget -= taken.length
  }
  return { ok: true, items: capped, sourceRefs: [...sourceRefs] }
}

/**
 * 从条目里取来源引用并按 `units` 回指；只保留可回指的标识（保持出现顺序、去重）。
 * `preferredFields` 命中的字段优先（如变体条目的 `members`），未命中回退通用来源引用字段。
 */
function resolveRefs(
  item: TaskResultItem,
  units: readonly UnitRef[],
  allowed: ReadonlySet<Id>,
  preferredFields: readonly string[] = [],
): Id[] {
  const tokens = extractRefTokens(item, preferredFields)
  if (tokens.length === 0) return []
  const byMarker = new Map<string, Id>()
  for (const unit of units) {
    byMarker.set(String(unit.marker), unit.id)
    byMarker.set(unit.id, unit.id)
  }
  const resolved: Id[] = []
  const seen = new Set<Id>()
  for (const token of tokens) {
    const id = byMarker.get(token) ?? (allowed.has(token) ? token : null)
    if (id === null || !allowed.has(id) || seen.has(id)) continue
    seen.add(id)
    resolved.push(id)
  }
  return resolved
}

/** 识别专用：回指到消息集合。 */
function resolveRefsToMessages(
  item: TaskResultItem,
  units: readonly UnitRef[],
  messagesById: ReadonlyMap<Id, RawMessage>,
): Id[] {
  return resolveRefs(item, units, new Set(messagesById.keys()))
}

/** 从条目的来源引用字段 / 行内标记提取令牌（与 MOD-003 协议字段名保持一致）。 */
function extractRefTokens(item: TaskResultItem, preferredFields: readonly string[] = []): string[] {
  for (const field of preferredFields) {
    const value = item[field]
    if (value !== undefined && value !== null) return flatten(value)
  }
  for (const [key, value] of Object.entries(item)) {
    if (REF_FIELD_NAMES.has(key.trim().toLowerCase()) || REF_FIELD_NAMES.has(key.trim())) {
      return flatten(value)
    }
  }
  const scanned: string[] = []
  for (const value of collectStrings(item)) {
    for (const match of value.matchAll(/[\[【(（]\s*(?:消息|msg|message|ref|source|来源)\s*[:：]?\s*([^\]】)）\n]{1,64}?)\s*[\]】)）]/gi)) {
      if (match[1] !== undefined) scanned.push(match[1].trim())
    }
  }
  return scanned
}

function flatten(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value).trim()]
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const entry of value) {
      if (typeof entry === 'string' || typeof entry === 'number') out.push(String(entry).trim())
      else if (entry !== null && typeof entry === 'object' && 'id' in entry) out.push(String((entry as { id: unknown }).id).trim())
    }
    return out
  }
  return []
}

function collectStrings(item: TaskResultItem): string[] {
  const out: string[] = []
  for (const value of Object.values(item)) {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') out.push(entry)
      }
    }
  }
  return out
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 类型闭集（供 schema 与图例共用；越界输出按任务失败处理）。 */
export const CLOSED_KINDS: readonly MemeKind[] = TYPE_CLOSED_SET
