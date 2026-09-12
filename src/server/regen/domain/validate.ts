/**
 * 任务结果与候选校验（mod-008 §3.1「domain/validate」、§4.1 步骤 3、§4.3、§8 决策 5）。
 *
 * 纯函数、无 IO：
 * - 文案变体：条数与结构校验失败按任务失败处理（`ANALYSIS_FAILED`）；多于期望条数按序取前 N；
 * - 候选梗单元：逐条校验（含义推测 / 出处消息 / 使用示例；出处消息必须真实存在且落在读取范围内），
 *   失败逐条丢弃并记日志，不落半成品；
 * - 补全任务：梗名 / 类型（三分闭集）/ 解读缺一不可。
 */

import type { Id, MemeKind, TaskResultItem, TaskUnit } from '@shared'
import { MEME_KINDS } from '@shared'

import { failAnalysis } from '../errors'

/** 从任务结果条目取文案变体（G1 / G2 共用）。 */
export function textsFromTaskItems(items: readonly TaskResultItem[], expected: number): string[] {
  const texts: string[] = []
  for (const item of items) {
    const value = item.text
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text === '') continue
    texts.push(text)
  }
  if (texts.length < expected) {
    failAnalysis('文案变体条数不足', { context: { expected, received: texts.length } })
  }
  const taken = texts.slice(0, expected)
  if (new Set(taken).size !== expected) {
    failAnalysis('文案变体存在重复', { context: { expected, received: texts.length } })
  }
  return taken
}

/** 已校验的候选梗单元（`DM-021` 的字段前身）。 */
export interface ValidatedCandidate {
  meaningGuess: string
  usageExample: string
  sourceMessageIds: Id[]
}

/** 候选校验结果：通过项 + 逐条丢弃的原因（供日志，不落半成品）。 */
export interface CandidateValidationResult {
  candidates: ValidatedCandidate[]
  rejected: string[]
}

/**
 * 逐条校验候选（§4.3）：三条字段缺一不可；出处消息必须落在本次读取范围内。
 * 出处引用取值为输入单元标识（消息标识）或 1 起的输入单元编号。
 */
export function candidatesFromTaskItems(
  items: readonly TaskResultItem[],
  units: readonly TaskUnit[],
  maxCount: number,
): CandidateValidationResult {
  const candidates: ValidatedCandidate[] = []
  const rejected: string[] = []

  for (const [index, item] of items.entries()) {
    if (candidates.length >= maxCount) break
    const label = `candidate#${index + 1}`
    const meaningGuess = textOf(item.meaningGuess)
    if (meaningGuess === null) {
      rejected.push(`${label}: 缺少含义推测`)
      continue
    }
    const usageExample = textOf(item.usageExample)
    if (usageExample === null) {
      rejected.push(`${label}: 缺少使用示例`)
      continue
    }
    const sourceMessageIds = resolveSourceRefs(item.sourceRefs, units)
    if (sourceMessageIds.length === 0) {
      rejected.push(`${label}: 出处消息缺失或不在读取范围内`)
      continue
    }
    candidates.push({ meaningGuess: meaningGuess, usageExample: usageExample, sourceMessageIds })
  }

  return { candidates, rejected }
}

/** 出处引用解析（输入单元标识或 1 起的编号；去重、保持给出顺序）。 */
export function resolveSourceRefs(refs: unknown, units: readonly TaskUnit[]): Id[] {
  if (!Array.isArray(refs) || units.length === 0) return []
  const known = new Set(units.map((unit) => unit.id))
  const resolved: Id[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    let id: Id | null = null
    if (typeof ref === 'string') {
      id = known.has(ref) ? ref : null
    } else if (typeof ref === 'number' && Number.isInteger(ref) && ref >= 1 && ref <= units.length) {
      id = units[ref - 1]!.id
    }
    if (id === null || seen.has(id)) continue
    seen.add(id)
    resolved.push(id)
  }
  return resolved
}

/** 补全任务的输出（§8 决策 5：梗名 / 类型（三分闭集）/ 解读）。 */
export interface CompletionResult {
  name: string
  kind: MemeKind
  interpretation: string
}

/** 校验补全任务结果；失败归 `ANALYSIS_FAILED`（沿用既有稳定标识，不新增）。 */
export function completionFromTaskItems(items: readonly TaskResultItem[]): CompletionResult {
  const first = items[0]
  if (first === undefined) {
    failAnalysis('补全任务没有结果条目', { context: { expected: 1, received: 0 } })
  }
  const name = textOf(first.name)
  if (name === null) failAnalysis('补全任务缺少梗名', { context: { field: 'name' } })
  const kind = first.kind
  if (typeof kind !== 'string' || !(MEME_KINDS as readonly string[]).includes(kind)) {
    failAnalysis('补全任务返回的梗类型不在闭集内', { context: { field: 'kind', value: String(kind) } })
  }
  const interpretation = textOf(first.interpretation)
  if (interpretation === null) failAnalysis('补全任务缺少解读', { context: { field: 'interpretation' } })
  return { name, kind: kind as MemeKind, interpretation }
}

/** 去空白文本；空串 / 非字符串 / 全空白返回 null。 */
export function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
}
