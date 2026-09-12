/**
 * MOD-008 模板库（mod-008 §3.3「render/registry.ts —— 模板库：内置、只读、带版本」、§8 决策 3）。
 *
 * 组织方式：模板 = 元数据（`templates/index.json`）+ 内置素材（`templates/assets/*.png`），
 * 随应用版本打包在 `src/server/regen/templates/`，**只读**、不做在线更新（无对外通道）。
 *
 * 启动时加载并校验（标识唯一、槽位矩形在画布内、引用素材存在、`tiers` 非空、版本号合法），
 * 校验失败即启动期报错（`TemplateLibraryError`），不静默降级。
 *
 * 生成历史按「模板 + 版本」记录并复现（`DM-020.模板` = `<模板标识>@<版本>`）；模板更新只增版本、
 * 不改旧版本文件（详设 §8.3：模板更新后旧缓存不命中、历史产物不回改）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { MaterialTier } from '@shared'

import { MAX_CANVAS_SIDE } from '../constants'
import type { MaterialKind } from '../materials/manifest'

// ---------------------------------------------------------------------------
// 类型（mod-008 §3.3 的模板元数据）
// ---------------------------------------------------------------------------

/** 画布矩形（像素；原点 = 左上角）。 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 字体引用（实现层内置位图光栅化只使用 `sizePx`；`family` / `weight` 为口径保留字段）。 */
export interface FontRef {
  family: string
  sizePx: number
  weight?: number
}

/** 文案槽位：4 条文案变体逐一填充（每张变体图使用全部文案槽位）。 */
export interface TextSlot {
  id: string
  box: Rect
  font: FontRef
  maxLines: number
  align: 'left' | 'center'
}

/** 素材槽位（可为空）。 */
export interface MediaSlot {
  id: string
  box: Rect
  shape: 'rect' | 'circle'
  required: boolean
  /** 允许装入的素材类别 */
  sources: MaterialKind[]
  /** true = 成员素材槽（头像 / 照片），装载即触发合规判定 */
  memberBound: boolean
}

/** 模板元数据（稳定标识 + 版本；历史产物锁定版本，不回改）。 */
export interface TemplateMeta {
  id: string
  version: number
  /** 中文展示名（REQ-017） */
  name: string
  /** 适用档位：`参考群内图片` | `改编热门表情包` | `纯模板生成` */
  tiers: MaterialTier[]
  size: { w: number; h: number }
  textSlots: TextSlot[]
  mediaSlots: MediaSlot[]
  /** 内置素材相对路径（只读；相对模板库目录） */
  builtinAssets: string[]
}

/** 模板库（只读；同一进程内共享）。 */
export interface TemplateRegistry {
  /** 全部模板（按元数据文件中的顺序，加载后稳定）。 */
  list(): readonly TemplateMeta[]
  /** 按标识取模板；不在清单内返回 undefined（调用方落 `INVALID_INPUT`）。 */
  get(id: string): TemplateMeta | undefined
  /** 内置素材字节（校验期已确认存在）。 */
  assetBytes(ref: string): Uint8Array
  /** 内置素材 MIME（按扩展名）。 */
  assetMime(ref: string): string
  /** 模板库目录（绝对路径；排障与测试用）。 */
  readonly dir: string
}

/** 模板库加载 / 校验失败（启动期错误：拒绝启动，不静默降级）。 */
export class TemplateLibraryError extends Error {
  readonly reasons: readonly string[]

  constructor(reasons: readonly string[], dir: string) {
    super(`模板库校验失败（${dir}）：${reasons.join('；')}`)
    this.name = 'TemplateLibraryError'
    this.reasons = reasons
  }
}

/** 模板库选项（测试注入点：自定义目录）。 */
export interface TemplateRegistryOptions {
  /** 模板库目录（默认随应用打包的 `src/server/regen/templates/`）。 */
  dir?: string
  /** 元数据文件名（默认 `index.json`）。 */
  manifestFile?: string
}

const MATERIAL_KINDS: readonly MaterialKind[] = [
  'builtinAsset',
  'groupImage',
  'memberAvatar',
  'memberPhoto',
  'memberQuote',
]

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** 默认模板库目录（相对本文件：`render/` → `../templates/`）。 */
export function defaultTemplatesDir(): string {
  return fileURLToPath(new URL('../templates/', import.meta.url))
}

/** 加载并校验模板库；失败抛 `TemplateLibraryError`（启动期报错）。 */
export function createTemplateRegistry(options: TemplateRegistryOptions = {}): TemplateRegistry {
  const dir = resolve(options.dir ?? defaultTemplatesDir())
  const manifestFile = options.manifestFile ?? 'index.json'
  const reasons: string[] = []
  const manifestPath = join(dir, manifestFile)

  if (!existsSync(manifestPath)) {
    throw new TemplateLibraryError([`模板清单不存在：${manifestFile}`], dir)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new TemplateLibraryError([`模板清单不是合法 JSON：${errorMessage(error)}`], dir)
  }

  const rawTemplates = isPlainObject(parsed) && Array.isArray(parsed.templates) ? parsed.templates : null
  if (rawTemplates === null) {
    throw new TemplateLibraryError(['模板清单结构非法：应为 { templates: [...] }'], dir)
  }

  const templates: TemplateMeta[] = []
  const seenIds = new Set<string>()
  for (const [index, raw] of rawTemplates.entries()) {
    const validated = validateTemplate(raw, index, dir, seenIds, reasons)
    if (validated !== null) {
      seenIds.add(validated.id)
      templates.push(validated)
    }
  }

  if (templates.length === 0 && reasons.length === 0) {
    reasons.push('模板清单为空')
  }
  if (reasons.length > 0) {
    throw new TemplateLibraryError(reasons, dir)
  }

  const byId = new Map(templates.map((template) => [template.id, template]))

  return {
    dir,
    list: () => templates,
    get: (id) => byId.get(id),
    assetBytes(ref) {
      return readFileSync(resolveAssetPath(dir, ref))
    },
    assetMime(ref) {
      const dot = ref.lastIndexOf('.')
      const extension = dot >= 0 ? ref.slice(dot).toLowerCase() : ''
      return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
    },
  }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function validateTemplate(
  raw: unknown,
  index: number,
  dir: string,
  seenIds: ReadonlySet<string>,
  reasons: string[],
): TemplateMeta | null {
  const label = `模板 #${index + 1}`
  if (!isPlainObject(raw)) {
    reasons.push(`${label} 不是对象`)
    return null
  }

  const id = text(raw.id, `${label}.id`, reasons)
  const version = positiveInt(raw.version, `${label}.version`, reasons)
  const name = text(raw.name, `${label}.name`, reasons)

  if (id !== null && seenIds.has(id)) reasons.push(`${label}.id 与既有模板重复：${id}`)

  const tiers = validateTiers(raw.tiers, `${label}.tiers`, reasons)
  const size = validateSize(raw.size, `${label}.size`, reasons)

  const slotIds = new Set<string>()
  const textSlots = Array.isArray(raw.textSlots)
    ? raw.textSlots
        .map((slot, slotIndex) =>
          validateTextSlot(slot, `${label}.textSlots[${slotIndex}]`, size, slotIds, reasons),
        )
        .filter((slot): slot is TextSlot => slot !== null)
    : []
  if (!Array.isArray(raw.textSlots)) reasons.push(`${label}.textSlots 应为数组`)

  const mediaSlots = Array.isArray(raw.mediaSlots)
    ? raw.mediaSlots
        .map((slot, slotIndex) =>
          validateMediaSlot(slot, `${label}.mediaSlots[${slotIndex}]`, size, slotIds, reasons),
        )
        .filter((slot): slot is MediaSlot => slot !== null)
    : []
  if (!Array.isArray(raw.mediaSlots)) reasons.push(`${label}.mediaSlots 应为数组`)

  const builtinAssets = Array.isArray(raw.builtinAssets) ? raw.builtinAssets : []
  if (!Array.isArray(raw.builtinAssets)) reasons.push(`${label}.builtinAssets 应为数组`)
  for (const [assetIndex, asset] of builtinAssets.entries()) {
    const path = text(asset, `${label}.builtinAssets[${assetIndex}]`, reasons)
    if (path === null) continue
    if (!isContainedRelative(dir, path)) {
      reasons.push(`${label}.builtinAssets[${assetIndex}] 必须是模板库目录内的相对路径：${path}`)
      continue
    }
    if (!existsSync(join(dir, path))) {
      reasons.push(`${label}.builtinAssets[${assetIndex}] 引用的素材不存在：${path}`)
    }
  }

  if (
    id === null ||
    version === null ||
    name === null ||
    tiers === null ||
    size === null ||
    !Array.isArray(raw.textSlots) ||
    !Array.isArray(raw.mediaSlots) ||
    !Array.isArray(raw.builtinAssets)
  ) {
    return null
  }

  return {
    id,
    version,
    name,
    tiers,
    size,
    textSlots,
    mediaSlots,
    builtinAssets: builtinAssets.filter((asset): asset is string => typeof asset === 'string'),
  }
}

function validateTiers(raw: unknown, label: string, reasons: string[]): MaterialTier[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    reasons.push(`${label} 应为非空数组`)
    return null
  }
  const tiers: MaterialTier[] = []
  for (const value of raw) {
    if (value === '参考群内图片' || value === '改编热门表情包' || value === '纯模板生成') {
      tiers.push(value)
    } else {
      reasons.push(`${label} 含非法档位值：${String(value)}`)
      return null
    }
  }
  return tiers
}

function validateSize(raw: unknown, label: string, reasons: string[]): { w: number; h: number } | null {
  if (!isPlainObject(raw)) {
    reasons.push(`${label} 应为 { w, h }`)
    return null
  }
  const w = positiveInt(raw.w, `${label}.w`, reasons)
  const h = positiveInt(raw.h, `${label}.h`, reasons)
  if (w === null || h === null) return null
  if (w > MAX_CANVAS_SIDE || h > MAX_CANVAS_SIDE) {
    reasons.push(`${label} 超过单张画布上限 ${MAX_CANVAS_SIDE}×${MAX_CANVAS_SIDE}（§4.1）`)
    return null
  }
  return { w, h }
}

function validateTextSlot(
  raw: unknown,
  label: string,
  size: { w: number; h: number } | null,
  slotIds: Set<string>,
  reasons: string[],
): TextSlot | null {
  if (!isPlainObject(raw)) {
    reasons.push(`${label} 不是对象`)
    return null
  }
  const id = text(raw.id, `${label}.id`, reasons)
  if (id !== null) {
    if (slotIds.has(id)) reasons.push(`${label}.id 与既有槽位重复：${id}`)
    slotIds.add(id)
  }
  const box = validateBox(raw.box, `${label}.box`, size, reasons)
  const font = validateFont(raw.font, `${label}.font`, reasons)
  const maxLines = positiveInt(raw.maxLines, `${label}.maxLines`, reasons)
  const align = raw.align === 'left' || raw.align === 'center' ? raw.align : null
  if (align === null) reasons.push(`${label}.align 应为 left / center`)

  if (id === null || box === null || font === null || maxLines === null || align === null) return null
  return { id, box, font, maxLines, align }
}

function validateMediaSlot(
  raw: unknown,
  label: string,
  size: { w: number; h: number } | null,
  slotIds: Set<string>,
  reasons: string[],
): MediaSlot | null {
  if (!isPlainObject(raw)) {
    reasons.push(`${label} 不是对象`)
    return null
  }
  const id = text(raw.id, `${label}.id`, reasons)
  if (id !== null) {
    if (slotIds.has(id)) reasons.push(`${label}.id 与既有槽位重复：${id}`)
    slotIds.add(id)
  }
  const box = validateBox(raw.box, `${label}.box`, size, reasons)
  const shape = raw.shape === 'rect' || raw.shape === 'circle' ? raw.shape : null
  if (shape === null) reasons.push(`${label}.shape 应为 rect / circle`)
  if (typeof raw.required !== 'boolean') reasons.push(`${label}.required 应为布尔`)
  if (typeof raw.memberBound !== 'boolean') reasons.push(`${label}.memberBound 应为布尔`)

  const sources: MaterialKind[] = []
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    reasons.push(`${label}.sources 应为非空数组`)
  } else {
    for (const source of raw.sources) {
      if (typeof source === 'string' && (MATERIAL_KINDS as readonly string[]).includes(source)) {
        sources.push(source as MaterialKind)
      } else {
        reasons.push(`${label}.sources 含未知素材类别：${String(source)}`)
      }
    }
  }

  if (
    id === null ||
    box === null ||
    shape === null ||
    typeof raw.required !== 'boolean' ||
    typeof raw.memberBound !== 'boolean' ||
    sources.length === 0
  ) {
    return null
  }
  return { id, box, shape, required: raw.required, sources, memberBound: raw.memberBound }
}

function validateBox(
  raw: unknown,
  label: string,
  size: { w: number; h: number } | null,
  reasons: string[],
): Rect | null {
  if (!isPlainObject(raw)) {
    reasons.push(`${label} 应为 { x, y, w, h }`)
    return null
  }
  const values = ['x', 'y', 'w', 'h'].map((key) => nonNegativeInt(raw[key], `${label}.${key}`, reasons))
  const [x, y, w, h] = values
  if (x === null || y === null || w === null || h === null) return null
  if (w === 0 || h === 0) {
    reasons.push(`${label} 的宽高必须为正`)
    return null
  }
  if (size !== null && (x + w > size.w || y + h > size.h)) {
    reasons.push(`${label} 越出画布 ${size.w}×${size.h}`)
    return null
  }
  return { x, y, w, h }
}

function validateFont(raw: unknown, label: string, reasons: string[]): FontRef | null {
  if (!isPlainObject(raw)) {
    reasons.push(`${label} 应为 { family, sizePx }`)
    return null
  }
  const family = text(raw.family, `${label}.family`, reasons)
  const sizePx = positiveInt(raw.sizePx, `${label}.sizePx`, reasons)
  if (family === null || sizePx === null) return null
  return typeof raw.weight === 'number' ? { family, sizePx, weight: raw.weight } : { family, sizePx }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function resolveAssetPath(dir: string, ref: string): string {
  if (!isContainedRelative(dir, ref)) {
    throw new TemplateLibraryError([`内置素材引用非法：${ref}`], dir)
  }
  return join(dir, ref)
}

function isContainedRelative(dir: string, ref: string): boolean {
  if (ref === '' || isAbsolute(ref) || ref.includes('\u0000')) return false
  const root = resolve(dir)
  const target = resolve(root, ref)
  return target !== root && target.startsWith(root + sep)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, label: string, reasons: string[]): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value
  reasons.push(`${label} 应为非空字符串`)
  return null
}

function positiveInt(value: unknown, label: string, reasons: string[]): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  reasons.push(`${label} 应为正整数`)
  return null
}

function nonNegativeInt(value: unknown, label: string, reasons: string[]): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  reasons.push(`${label} 应为非负整数`)
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 仅供测试 / 排障：模板库目录内所有内置素材的相对路径。 */
export function builtinAssetRefs(template: TemplateMeta): readonly string[] {
  return template.builtinAssets
}

/** 相对模板库目录的展示路径（诊断日志用）。 */
export function relativeToTemplates(dir: string, ref: string): string {
  return relative(dir, resolveAssetPath(dir, ref))
}
