/**
 * 来源标记 → 来源引用（mod-003 §3.1「parse/refs.ts」；决策 3）。
 *
 * - 协议样板要求条目带 `sourceRefs`；解析端容忍多种写法（字段别名、`[[n]]` / `[消息 n]` / `【消息 n】`
 *   等行内标记）。
 * - 解析结果只保留**能回指本次输入**的引用（编号 → 标识映射，或标识原文）；
 *   无法回指的引用计数上报（`unknownRefs`）。
 */

import type { Id, TaskResultItem } from '@shared'

/** 解析引用所需的最小单元索引（与 `NormalizedUnit` 结构兼容）。 */
export interface RefIndexUnit {
  marker: number
  id: Id
}

const REF_FIELD_NAMES = new Set(['sourcerefs', 'source_refs', 'sourcereference', 'sourcereferences', 'refs', 'ref', 'sources', '来源引用', '引用', '来源'])

const MARKER_PATTERNS: readonly RegExp[] = [
  /\[\[([^[\]\n]{1,120})\]\]/g,
  /[\[【(（]\s*(?:消息|msg|message|ref|source|来源)\s*[:：]?\s*([^\]】)）\n]{1,64}?)\s*[\]】)）]/gi,
]

/** 从条目提取原始引用写法（字段优先；缺字段时扫描字符串值中的行内标记）。 */
export function extractRawRefValues(item: TaskResultItem): { values: string[]; hasRefField: boolean } {
  for (const [key, value] of Object.entries(item)) {
    if (!REF_FIELD_NAMES.has(key.trim().toLowerCase())) continue
    return { values: flattenRefValue(value), hasRefField: true }
  }

  const scanned: string[] = []
  for (const value of collectStrings(item)) {
    scanned.push(...scanMarkers(value))
  }
  return { values: scanned, hasRefField: false }
}

/** 原始引用值 → 输入标识集合（编解码别名：编号 / 标识；无法回指的数量计入 `unknown`）。 */
export function resolveRefs(values: readonly string[], units: readonly RefIndexUnit[]): { ids: Id[]; unknown: number } {
  const byMarker = new Map<string, Id>()
  const ids = new Set<Id>()
  for (const unit of units) {
    byMarker.set(String(unit.marker), unit.id)
    ids.add(unit.id)
  }

  const resolved: Id[] = []
  const seen = new Set<Id>()
  let unknown = 0

  for (const raw of values) {
    const token = normalizeToken(raw)
    if (token.length === 0) continue
    const id = byMarker.get(token) ?? (ids.has(token) ? token : null)
    if (id === null) {
      unknown += 1
      continue
    }
    if (!seen.has(id)) {
      seen.add(id)
      resolved.push(id)
    }
  }

  return { ids: resolved, unknown }
}

function flattenRefValue(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const entry of value) {
      if (typeof entry === 'string' || typeof entry === 'number') out.push(String(entry))
      else if (entry !== null && typeof entry === 'object' && 'id' in entry) out.push(String((entry as { id: unknown }).id))
    }
    return out
  }
  return []
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((entry) => collectStrings(entry, depth + 1))
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((entry) => collectStrings(entry, depth + 1))
  }
  return []
}

function scanMarkers(text: string): string[] {
  const found: string[] = []
  for (const pattern of MARKER_PATTERNS) {
    pattern.lastIndex = 0
    let match = pattern.exec(text)
    while (match !== null) {
      const captured = match[1]
      if (captured !== undefined) {
        for (const token of captured.split(/[,，、\s]+/)) {
          if (token.length > 0) found.push(token)
        }
      }
      match = pattern.exec(text)
    }
  }
  return found
}

function normalizeToken(raw: string): string {
  let token = raw.trim()
  // 去掉可能残留的包裹符与「消息」前缀（如 "[[3]]" / "【消息 3】" / "来源: 3"）。
  token = token.replace(/^[\[【(（]+/, '').replace(/[\]】)）]+$/, '').trim()
  token = token.replace(/^(?:消息|msg|message|ref|source|来源)\s*[:：]?\s*/i, '').trim()
  return token
}
