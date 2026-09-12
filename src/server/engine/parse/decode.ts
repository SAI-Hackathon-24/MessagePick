/**
 * 响应解析与结果条目浅校验（mod-003 §3.1「parse/decode.ts」；§3.3、决策 3、详设 §8.2）。
 *
 * - 容错：代码块包裹、前后杂讯可直接剥掉；多余字段忽略。
 * - 硬错：非法 JSON / 缺 `items` / 条目不是对象 / 条目不符合 `outputSchema` 的必填与类型
 *   → `OUTPUT_INVALID`（可自动重试，§6.1）。
 * - 软错：来源引用解析失败的条目**丢弃并计数**（决策 3），不使任务失败。
 * - 纯函数、无凭据、无配置：可整段搬进 worker（决策 7）。
 */

import type { Id, TaskOutputSchema, TaskResultItem } from '@shared'

import { isPlainObject, validateItemShape } from '../specs/schema'
import { extractRawRefValues, resolveRefs, type RefIndexUnit } from './refs'

/** 解码输入（worker 只收这一份纯计算数据）。 */
export interface DecodePayload {
  text: string
  schema: TaskOutputSchema
  units: RefIndexUnit[]
}

/** 单条解码结果：条目原文（含多余字段，原样保留）+ 回指本次输入的引用。 */
export interface DecodedItem {
  item: TaskResultItem
  refs: Id[]
}

/** 解码结果与计数。 */
export interface DecodeResult {
  items: DecodedItem[]
  /** 因来源引用不可解析而丢弃的条目数。 */
  dropped: number
  /** 无法回指本次输入的引用标记数。 */
  unknownRefs: number
}

/** 响应不符合协议（→ `OUTPUT_INVALID`，可自动重试）。 */
export class OutputInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputInvalidError'
  }
}

/** 解析模型响应文本（主线程与 worker 共用）。 */
export function decodeResponseText(payload: DecodePayload): DecodeResult {
  const root = parseJsonObject(payload.text)
  const rawItems = root.items
  if (!Array.isArray(rawItems)) {
    throw new OutputInvalidError('模型响应缺少 items 数组')
  }

  const items: DecodedItem[] = []
  let dropped = 0
  let unknownRefs = 0

  for (const raw of rawItems) {
    if (!isPlainObject(raw)) {
      throw new OutputInvalidError('结果条目不是对象')
    }
    const issues = validateItemShape(raw, payload.schema)
    if (issues.length > 0) {
      const first = issues[0]
      throw new OutputInvalidError(`结果条目不符合输出约束（${first?.path ?? 'item'}：${first?.message ?? '未知'}）`)
    }
    const { values } = extractRawRefValues(raw)
    const { ids, unknown } = resolveRefs(values, payload.units)
    unknownRefs += unknown
    if (ids.length === 0) {
      dropped += 1
      continue
    }
    items.push({ item: raw, refs: ids })
  }

  return { items, dropped, unknownRefs }
}

/** 从文本中提取 JSON 对象（容忍 Markdown 代码块与前后杂讯）。 */
function parseJsonObject(text: string): Record<string, unknown> {
  const candidate = extractJsonCandidate(text)
  if (candidate === null) throw new OutputInvalidError('模型响应不是合法 JSON')
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    throw new OutputInvalidError('模型响应不是合法 JSON')
  }
  if (!isPlainObject(parsed)) throw new OutputInvalidError('模型响应不是 JSON 对象')
  return parsed
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  // 代码块：```json ... ``` / ``` ... ```
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const body = fenceMatch?.[1]?.trim() ?? trimmed

  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return body.slice(start, end + 1)
}
