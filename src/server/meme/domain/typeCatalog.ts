/**
 * 类型目录（mod-005 §3.1「domain/TypeCatalog —— 类型闭集与图例」；REQ-020）。
 *
 * 纯函数 / 纯常量：无 IO。类型闭集 = 3 类（口头禅 / 内部梗 / 表情包梗），
 * 图例始终 ≤ 3 项且每项带文字标签（颜色不单独承载信息）。
 */

import { MEME_KINDS, type CloudLegendItem, type MemeKind } from '@shared'

import { KIND_COLORS, TYPE_CLOSED_SET } from '../constants'

/** 类型闭集（越界输出按任务失败处理，§6）。 */
export function isKnownKind(value: unknown): value is MemeKind {
  return typeof value === 'string' && (TYPE_CLOSED_SET as readonly string[]).includes(value)
}

/** 类型 → 颜色（图例与词云共用同一取值来源）。 */
export function colorOf(kind: MemeKind): string {
  return KIND_COLORS[kind]
}

/**
 * 由图例基数（出现的类型集合）构造图例：输出顺序固定为闭集声明顺序、最多 3 项。
 * 输入为空时返回空图例。
 */
export function legendOf(kinds: Iterable<MemeKind>): CloudLegendItem[] {
  const present = new Set<MemeKind>()
  for (const kind of kinds) {
    if (isKnownKind(kind)) present.add(kind)
  }
  return MEME_KINDS.filter((kind) => present.has(kind)).map((kind) => ({
    kind,
    color: colorOf(kind),
    label: kind,
  }))
}
