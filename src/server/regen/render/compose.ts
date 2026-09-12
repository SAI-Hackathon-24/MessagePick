/**
 * 本地合成（mod-008 §3.1「render/compose —— 指令 + 素材 → 位图，纯函数」、§8 决策 4）。
 *
 * 纯函数、确定性：同一指令树 + 同一素材集 → 字节级一致的产物；无网络、无随机、不依赖时钟。
 * 序列化目标 = SVG（矢量、可缩放、浏览器直接呈现；中文文案由渲染器按系统字体真渲染）。
 * 本文件是**可替换的序列化点**：若后续引入位图光栅化（PNG），只替换本文件即可，
 * 指令树与管线不变（§7.3「光栅化适配点单点隔离以便测试桩替换」）。
 */

import { failInvalidInput } from '../errors'
import type { DrawDirective } from './layout'

/** 已解析的素材（槽位 → 字节；内置素材与群内媒体都先经 `MOD-002` 取得字节）。 */
export interface ResolvedAsset {
  /** 装入的模板槽位 */
  slotId: string
  /** 素材引用（媒体引用 / 内置素材路径；排障用，不参与呈现） */
  ref: string
  bytes: Uint8Array
  /** 素材 MIME（用于 data URI） */
  mime: string
}

/** 指令树 + 素材 → 产物字节（§3.4 签名）。 */
export function compose(directives: readonly DrawDirective[], assets: readonly ResolvedAsset[]): Uint8Array {
  const canvas = directives.find((directive) => directive.op === 'background')
  const size = canvasSizeOf(directives)
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}">`,
  ]

  for (const directive of directives) {
    switch (directive.op) {
      case 'background':
        parts.push(`<rect x="0" y="0" width="${size.w}" height="${size.h}" fill="${directive.fill}"/>`)
        break
      case 'media':
        parts.push(mediaElement(directive, assets))
        break
      case 'text':
        parts.push(textElement(directive))
        break
      case 'badge':
        parts.push(badgeElement(directive))
        break
      default:
        break
    }
  }

  parts.push('</svg>')
  return new TextEncoder().encode(parts.join(''))
}

/** 画布尺寸：取全部指令包围盒的最大值（模板尺寸已由注册表校验 ≤ 上限）。 */
function canvasSizeOf(directives: readonly DrawDirective[]): { w: number; h: number } {
  let w = 0
  let h = 0
  for (const directive of directives) {
    if (directive.op === 'background') continue
    w = Math.max(w, directive.box.x + directive.box.w)
    h = Math.max(h, directive.box.y + directive.box.h)
  }
  return { w: Math.max(1, w), h: Math.max(1, h) }
}

/** 素材槽位 → `<image>`（circle 形态用 clipPath 裁剪；素材缺失即拒绝）。 */
function mediaElement(
  directive: Extract<DrawDirective, { op: 'media' }>,
  assets: readonly ResolvedAsset[],
): string {
  const asset = assets.find((candidate) => candidate.slotId === directive.slotId)
  if (asset === undefined) {
    failInvalidInput('素材槽位缺少素材', { slotId: directive.slotId })
  }
  const { box } = directive
  const href = dataUri(asset.mime, asset.bytes)
  const clipId = `clip-${sanitizeId(directive.slotId)}`
  const clip =
    directive.shape === 'circle'
      ? `<clipPath id="${clipId}"><circle cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" r="${Math.min(box.w, box.h) / 2}"/></clipPath>`
      : ''
  const clipRef = directive.shape === 'circle' ? ` clip-path="url(#${clipId})"` : ''
  return `${clip}<image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid slice"${clipRef} href="${href}"/>`
}

/** 文案槽位 → 逐行 `<text>`（基线按字号与行高排布）。 */
function textElement(directive: Extract<DrawDirective, { op: 'text' }>): string {
  const { box, font, align, lines } = directive
  const anchor = align === 'center' ? 'middle' : 'start'
  const x = align === 'center' ? box.x + box.w / 2 : box.x
  const lineHeight = font.sizePx * 1.3
  const parts: string[] = []
  for (const [index, line] of lines.entries()) {
    if (line === '') continue
    const y = round(box.y + font.sizePx + index * lineHeight)
    parts.push(
      `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${escapeAttribute(font.family)}" font-size="${font.sizePx}"${
        font.weight !== undefined ? ` font-weight="${font.weight}"` : ''
      } fill="#111827">${escapeText(line)}</text>`,
    )
  }
  return parts.join('')
}

/** 「创作」标注（圆角底板 + 居中文字；REQ-013）。 */
function badgeElement(directive: Extract<DrawDirective, { op: 'badge' }>): string {
  const { box, font, text, fill, foreground } = directive
  const radius = Math.min(box.h / 2, 12)
  const x = box.x + box.w / 2
  const y = box.y + box.h / 2 + font.sizePx / 2 - 2
  return (
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${radius}" ry="${radius}" fill="${fill}" opacity="0.88"/>` +
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="${escapeAttribute(font.family)}" font-size="${font.sizePx}" fill="${foreground}">${escapeText(text)}</text>`
  )
}

/** 字节 → data URI（素材随产物内联，产物自包含、可下载后离线查看）。 */
function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
