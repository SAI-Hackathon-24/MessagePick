/**
 * 绘制指令构造（mod-008 §3.1「render/layout —— 模板 + 文案 → 绘制指令，纯函数」、§3.4）。
 *
 * 纯函数、确定性：同一（模板 + 文案）输出同一指令树；无 IO、无随机、不依赖时钟。
 * 文案换行 / 截断规则集中在 `wrapLines`（§7.2「空 / 超长文案的截断由 layout 规则覆盖」）。
 * 「创作」标注作为指令树的一部分（`badge`）注入，不呈现为真实聊天记录（REQ-013）。
 */

import { CREATION_BADGE_LABEL } from '../constants'
import type { FontRef, Rect, TemplateMeta, TextSlot } from './registry'

/** 背景色（模板体系的内置基调；不引入主题系统）。 */
export const CANVAS_BACKGROUND = '#f7f4ee'
/** 「创作」标注底色。 */
export const BADGE_BACKGROUND = '#1f2937'
/** 「创作」标注文字色。 */
export const BADGE_FOREGROUND = '#ffffff'

/** 单条绘制指令（可序列化；worker 与主线程共用）。 */
export type DrawDirective =
  | { op: 'background'; fill: string }
  | { op: 'media'; slotId: string; box: Rect; shape: 'rect' | 'circle' }
  | { op: 'text'; slotId: string; box: Rect; lines: string[]; align: 'left' | 'center'; font: FontRef }
  | { op: 'badge'; text: string; box: Rect; font: FontRef; fill: string; foreground: string }

/** 「创作」标注的固定字号与内边距（像素）。 */
const BADGE_FONT: FontRef = { family: 'sans-serif', sizePx: 16 }
const BADGE_PADDING_X = 10
const BADGE_PADDING_Y = 6
const BADGE_INSET = 12

/**
 * 构造一张画布的绘制指令树（§3.4 签名）。
 *
 * `texts` 按文案槽位顺序逐一填充：第 i 个槽位取 `texts[i]`；不足则对应槽位留空。
 * 4 个文案变体各调用一次（每次传入该变体的文案），指令树互异由文案决定。
 */
export function buildDirectives(template: TemplateMeta, texts: readonly string[]): DrawDirective[] {
  const directives: DrawDirective[] = [{ op: 'background', fill: CANVAS_BACKGROUND }]

  for (const slot of template.mediaSlots) {
    directives.push({ op: 'media', slotId: slot.id, box: slot.box, shape: slot.shape })
  }

  for (const [index, slot] of template.textSlots.entries()) {
    const text = texts[index]
    if (typeof text !== 'string') continue
    const lines = wrapLines(text, slot)
    if (lines.length === 0) continue
    directives.push({
      op: 'text',
      slotId: slot.id,
      box: slot.box,
      lines,
      align: slot.align,
      font: slot.font,
    })
  }

  const badgeBox = badgeBoxOf(template)
  directives.push({
    op: 'badge',
    text: CREATION_BADGE_LABEL,
    box: badgeBox,
    font: BADGE_FONT,
    fill: BADGE_BACKGROUND,
    foreground: BADGE_FOREGROUND,
  })
  return directives
}

/** 「创作」标注的位置与尺寸（右下角，画布内）。 */
export function badgeBoxOf(template: TemplateMeta): Rect {
  const width = estimateTextWidth(CREATION_BADGE_LABEL, BADGE_FONT) + BADGE_PADDING_X * 2
  const height = BADGE_FONT.sizePx + BADGE_PADDING_Y * 2
  const w = Math.min(width, template.size.w)
  const h = Math.min(height, template.size.h)
  return { x: Math.max(0, template.size.w - w - BADGE_INSET), y: Math.max(0, template.size.h - h - BADGE_INSET), w, h }
}

/** 长文案换行 + `maxLines` 截断（超出末尾以 `…` 表示）。 */
export function wrapLines(text: string, slot: TextSlot): string[] {
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n')
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (trimmed === '') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      continue
    }
    lines.push(...wrapParagraph(trimmed, slot.box.w, slot.font))
  }
  if (lines.length <= slot.maxLines) return lines
  const kept = lines.slice(0, slot.maxLines)
  kept[kept.length - 1] = ellipsize(kept[kept.length - 1]!, slot)
  return kept
}

/** 单段贪心换行（按字符；全角字符按一个字号宽、半角按 0.55 字号宽估算）。 */
function wrapParagraph(paragraph: string, maxWidth: number, font: FontRef): string[] {
  const lines: string[] = []
  let current = ''
  let width = 0
  for (const char of paragraph) {
    const charWidth = estimateTextWidth(char, font)
    if (current !== '' && width + charWidth > maxWidth) {
      lines.push(current)
      current = char
      width = charWidth
    } else {
      current += char
      width += charWidth
    }
  }
  if (current !== '') lines.push(current)
  return lines.length === 0 ? [''] : lines
}

/** 末尾加省略号并尽量保留可显示内容。 */
function ellipsize(line: string, slot: TextSlot): string {
  let kept = line
  while (kept.length > 1 && estimateTextWidth(`${kept}…`, slot.font) > slot.box.w) {
    kept = kept.slice(0, -1)
  }
  return `${kept}…`
}

/** 文案宽度估算（布局与标注框共用；非精确字距，保证确定性）。 */
export function estimateTextWidth(text: string, font: FontRef): number {
  let width = 0
  for (const char of text) {
    width += isFullWidth(char) ? font.sizePx : font.sizePx * 0.55
  }
  return width
}

/** 全角判定（CJK / 全角标点 / 表情符号按全角计）。 */
export function isFullWidth(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  )
}
