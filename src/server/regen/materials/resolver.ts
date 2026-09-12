/**
 * 素材档位解析（mod-008 §3.1「materials/resolver」、§4.1 步骤 1、§5.3、§8 决策 8）。
 *
 * 三档收敛为同一 `MaterialManifest`，档位只决定外部素材的来源：
 * - 档位①「参考群内图片」：素材 = 梗上下文的精华图片引用（经 `API-004` 读 `DM-003` 取媒体引用与来源消息）；
 * - 档位②「改编热门表情包」：素材 = 该梗归属群（读 `DM-006`）时间窗内使用频次靠前的「表情包」消息媒体引用；
 * - 档位③「纯模板生成」：素材 = 模板内置素材，无外部来源。
 *
 * 判定与拒绝（§4.1 / §6）：档位值不在闭集 / 模板不适用该档位 → `INVALID_INPUT`；
 * 来源素材缺失 / 媒体不可用 / 无可选素材 → `SOURCE_UNAVAILABLE`。
 *
 * 成员素材判定照 §5.3 判定表：消息类型 = 图片 → 成员照片（从严）；`memberBound` 槽位 → 成员头像；
 * 文案与来源消息文本逐字一致（长度 ≥ 阈值）→ 成员原话。表情包 / 内置素材免确认。
 */

import type { Id, MaterialTier, MemeGenerationContext, RawMessage, Timestamp } from '@shared'

import {
  DAY_MS,
  HOT_MEME_MAX_ITEMS,
  HOT_MEME_WINDOW_DAYS,
  MATERIAL_SCAN_MAX_PAGES,
  MATERIAL_SCAN_PAGE_SIZE,
  QUOTE_MIN_CHARS,
} from '../constants'
import { failInvalidInput, failSourceUnavailable } from '../errors'
import type { TemplateMeta } from '../render/registry'
import { findOne, readAll } from '../store/regen-store'
import type { RegenStore } from '../store/port'
import {
  TIER_BY_KEY,
  builtinItem,
  groupImageItem,
  memberAvatarItem,
  memberPhotoItem,
  memberQuoteItem,
  tierKeyOf,
  type MaterialItem,
  type MaterialManifest,
  type TierKey,
} from './manifest'

/** 素材解析的取数面（测试可注入内存实现）。 */
export interface MaterialResolver {
  /**
   * 构造一次生成请求的素材清单（§3.4 签名）。
   * 出参只描述素材；合规判定与拒绝路径在 `evaluateCompliance` / 用例层。
   */
  resolveManifest(
    tier: MaterialTier,
    template: TemplateMeta,
    ctx: MemeGenerationContext,
    texts: readonly string[],
  ): MaterialManifest
}

/** 解析器装配（存储网关 + 时钟）。 */
export interface MaterialResolverDeps {
  store: RegenStore
  /** 当前时间（档位②的近期窗口右端；默认 `Date.now`） */
  now?: () => Timestamp
}

/** 构造素材解析器。 */
export function createMaterialResolver(deps: MaterialResolverDeps): MaterialResolver {
  const now = deps.now ?? Date.now

  return {
    resolveManifest(tier, template, ctx, texts) {
      const tierKey = tierKeyOf(tier)
      if (tierKey === null) {
        // 档位值不在闭集（含多值 / 非字符串形态）→ 拒绝调用、不触库
        failInvalidInput('素材档位非法：应为三档单选其一', { tier: String(tier) })
      }
      if (!template.tiers.includes(tier)) {
        failInvalidInput('模板不适用于该素材档位', { templateId: template.id, tier })
      }
      if (ctx === null || typeof ctx !== 'object' || typeof ctx.memeId !== 'string' || ctx.memeId === '') {
        failInvalidInput('梗上下文非法：缺少梗标识', { memeId: readMemeId(ctx) })
      }

      const { items: sources, messages } = sourceMaterialsOf(tierKey, deps.store, ctx, now)
      const items = assignToSlots(tierKey, template, sources, messages, ctx)
      const quotes = quotesOf(messages, texts)
      return { tier, templateId: template.id, items: [...items, ...quotes] }
    },
  }
}

// ---------------------------------------------------------------------------
// 内部：档位 → 来源素材
// ---------------------------------------------------------------------------

interface SourceMaterial {
  item: MaterialItem
  message: RawMessage
}

/** 读 DM-006 取梗归属群；梗不存在 → 来源不可用（§6）。 */
function groupOfMeme(store: RegenStore, memeId: Id): Id {
  const meme = findOne(store, 'DM-006', (record) => record.memeId === memeId, {
    pageSize: MATERIAL_SCAN_PAGE_SIZE,
    maxPages: MATERIAL_SCAN_MAX_PAGES,
  })
  if (meme === null) {
    failSourceUnavailable('所基于的梗不存在或已删除', { memeId })
  }
  return meme.groupId
}

/** 档位①②的消息素材来源：把命中的消息转成素材条目（消息类型 → 素材类别的判定表）。 */
function sourceMaterialsOf(
  tierKey: TierKey,
  store: RegenStore,
  ctx: MemeGenerationContext,
  now: () => Timestamp,
): { items: SourceMaterial[]; messages: RawMessage[] } {
  if (tierKey === 'builtin') return { items: [], messages: [] }

  const groupId = groupOfMeme(store, ctx.memeId)
  const highlights = (Array.isArray(ctx.highlightMediaRefs) ? ctx.highlightMediaRefs : []).filter(
    (ref) => typeof ref === 'string' && ref !== '',
  )

  if (tierKey === 'groupImage') {
    if (highlights.length === 0) {
      failSourceUnavailable('梗上下文没有可用的精华图片引用', { memeId: ctx.memeId })
    }
    const matched = new Set(highlights)
    const scanned = scanMessages(store, groupId, null, (message) =>
      message.mediaRef !== null && matched.has(message.mediaRef),
    )
    const ordered = orderByHighlights(scanned, highlights)
    const items = ordered.map(toSourceMaterial).filter(isSourceMaterial)
    if (items.length === 0) {
      failSourceUnavailable('精华图片引用在本机数据中不可用（媒体缺失或消息已删除）', {
        memeId: ctx.memeId,
        highlights,
      })
    }
    return { items, messages: ordered }
  }

  // 档位②：本机数据内的高频表情包（§8 决策 8）——时间窗内按出现频次排序取候选
  const end = now()
  const from = end - HOT_MEME_WINDOW_DAYS * DAY_MS
  const scanned = scanMessages(
    store,
    groupId,
    { from, to: end },
    (message) => message.kind === '表情包' && message.mediaRef !== null,
  )
  if (scanned.length === 0) {
    failSourceUnavailable('本群近期没有可作为素材的表情包', { memeId: ctx.memeId, groupId })
  }
  const ranked = rankByFrequency(scanned).slice(0, HOT_MEME_MAX_ITEMS)
  return { items: ranked.map(toSourceMaterial).filter(isSourceMaterial), messages: ranked }
}

/** 消息类型 → 素材类别（§5.3 判定表；表情包 = 群内图片，图片 = 成员照片（从严））。 */
function toSourceMaterial(message: RawMessage): SourceMaterial | null {
  if (message.mediaRef === null) return null
  if (message.kind === '表情包') {
    return {
      item: groupImageItem(message.mediaRef, message.messageId),
      message,
    }
  }
  if (message.kind === '图片') {
    return {
      item: memberPhotoItem(message.mediaRef, message.senderMemberId, message.messageId),
      message,
    }
  }
  return null
}

function isSourceMaterial(value: SourceMaterial | null): value is SourceMaterial {
  return value !== null
}

/** 分页扫描群内消息（时间范围可空；显式上限，不一次拉全量）。 */
function scanMessages(
  store: RegenStore,
  groupId: Id,
  timeRange: { from: Timestamp; to: Timestamp } | null,
  match: (message: RawMessage) => boolean,
): RawMessage[] {
  const records = readAll(store, 'DM-003', { groupIds: [groupId], timeRange }, {
    pageSize: MATERIAL_SCAN_PAGE_SIZE,
    maxPages: MATERIAL_SCAN_MAX_PAGES,
  })
  return records.filter(match)
}

/** 按精华图片引用的给出顺序排序（同一引用的多条消息按发送时间升序）。 */
function orderByHighlights(messages: readonly RawMessage[], highlights: readonly string[]): RawMessage[] {
  const order = new Map(highlights.map((ref, index) => [ref, index]))
  return [...messages].sort((left, right) => {
    const leftOrder = order.get(left.mediaRef ?? '') ?? Number.MAX_SAFE_INTEGER
    const rightOrder = order.get(right.mediaRef ?? '') ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.sentAt - right.sentAt
  })
}

/** 按出现频次降序排列（同频次按最近发送时间降序；§8 决策 8）。 */
function rankByFrequency(messages: readonly RawMessage[]): RawMessage[] {
  const byMedia = new Map<string, { count: number; latest: RawMessage }>()
  for (const message of messages) {
    const ref = message.mediaRef
    if (ref === null) continue
    const entry = byMedia.get(ref)
    if (entry === undefined) {
      byMedia.set(ref, { count: 1, latest: message })
    } else {
      entry.count += 1
      if (message.sentAt > entry.latest.sentAt) entry.latest = message
    }
  }
  return [...byMedia.values()]
    .sort((left, right) => right.count - left.count || right.latest.sentAt - left.latest.sentAt)
    .map((entry) => entry.latest)
}

// ---------------------------------------------------------------------------
// 内部：槽位装配
// ---------------------------------------------------------------------------

/**
 * 把来源素材装入模板槽位（槽位顺序确定；`memberBound` 槽位优先成员头像）。
 * 必填槽位装不上 → `SOURCE_UNAVAILABLE`（§6）。
 */
function assignToSlots(
  tierKey: TierKey,
  template: TemplateMeta,
  sources: readonly SourceMaterial[],
  messages: readonly RawMessage[],
  ctx: MemeGenerationContext,
): MaterialItem[] {
  const items: MaterialItem[] = []
  const used = new Set<string>()
  const primary = sources[0]?.message ?? messages[0] ?? null

  for (const [slotIndex, slot] of template.mediaSlots.entries()) {
    const candidates = candidatesForSlot(tierKey, template, slot, sources, primary, slotIndex)

    let assigned: MaterialItem | null = null
    for (const candidate of candidates) {
      const key = `${candidate.kind}\u0000${candidate.ref}`
      if (used.has(key)) continue
      used.add(key)
      assigned = { ...candidate, slotId: slot.id }
      break
    }

    if (assigned === null) {
      if (slot.required) {
        failSourceUnavailable('模板的必填素材槽位没有可用素材', {
          templateId: template.id,
          slotId: slot.id,
          tier: TIER_BY_KEY[tierKey],
        })
      }
      continue
    }
    items.push(assigned)
  }

  // 档位①②要求至少解析出一项外部素材（§4.1「引用缺失或媒体不可用 → SOURCE_UNAVAILABLE」）
  if (tierKey !== 'builtin' && sources.length === 0) {
    failSourceUnavailable('来源素材不可用', { templateId: template.id, memeId: ctx.memeId })
  }
  return items
}

/** 槽位候选（按优先级排序：成员头像 → 档位来源素材 → 内置素材兜底）。 */
function candidatesForSlot(
  tierKey: TierKey,
  template: TemplateMeta,
  slot: TemplateMeta['mediaSlots'][number],
  sources: readonly SourceMaterial[],
  primary: RawMessage | null,
  slotIndex: number,
): MaterialItem[] {
  const candidates: MaterialItem[] = []
  const allows = (kind: MaterialItem['kind']): boolean => slot.sources.includes(kind)

  if (slot.memberBound && tierKey !== 'builtin' && primary !== null && allows('memberAvatar')) {
    candidates.push(memberAvatarItem(primary.senderMemberId, primary.messageId))
  }
  for (const source of sources) {
    if (allows(source.item.kind)) candidates.push(source.item)
  }

  const builtinAssets = template.builtinAssets.filter((asset) => asset !== '')
  if (builtinAssets.length > 0 && allows('builtinAsset')) {
    // 轮转兜底：多槽位时从不同内置素材起步，其余依序排在其后
    const start = slotIndex % builtinAssets.length
    candidates.push(builtinItem(builtinAssets[start]!))
    for (const [offset, asset] of builtinAssets.entries()) {
      if (offset !== start) candidates.push(builtinItem(asset))
    }
  }
  return candidates
}

/** 成员原话判定（§5.3）：文案与来源消息文本逐字一致、长度 ≥ 阈值的片段。 */
function quotesOf(messages: readonly RawMessage[], texts: readonly string[]): MaterialItem[] {
  const quotes: MaterialItem[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    const text = (message.text ?? '').trim()
    if (text.length < QUOTE_MIN_CHARS) continue
    if (!texts.some((candidate) => typeof candidate === 'string' && candidate.includes(text))) continue
    if (seen.has(message.messageId)) continue
    seen.add(message.messageId)
    quotes.push(memberQuoteItem(message.messageId, message.senderMemberId))
  }
  return quotes
}

/** 防御性取梗标识（错误上下文用，不参与判定）。 */
function readMemeId(ctx: unknown): unknown {
  if (ctx === null || typeof ctx !== 'object') return undefined
  return (ctx as { memeId?: unknown }).memeId
}
