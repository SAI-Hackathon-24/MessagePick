/**
 * MOD-008 素材清单（mod-008 §3.3「materials/ —— 三档收敛为同一素材清单」、§5.3）。
 *
 * 三档位只决定外部素材的来源；清单本身是「档位 × 模板槽位 × 上下文引用 × 文案」的确定性派生，
 * 全部在服务端完成（`API-030` 的入参不含素材字段）。判定表见 §5.3 与 §8 决策 2。
 *
 * 素材类别（内部命名；契约层 `MaterialTier` 用中文原文，见 `entities.ts` 的映射说明）：
 * - `builtinAsset`  模板内置素材（非成员素材）
 * - `groupImage`    群内图片：来源消息类型 = 表情包（非成员素材）
 * - `memberPhoto`   成员照片：来源消息类型 = 图片（可能含真实人物，从严判定）
 * - `memberAvatar`  成员头像：装入 `memberBound = true` 的模板槽位
 * - `memberQuote`   成员原话：文案与本次素材来源消息文本逐字一致、长度 ≥ 6 字的片段
 */

import type { Id, MaterialTier, MediaRef } from '@shared'

/** 内部档位键（英文短名；契约层为中文原文，见 `TIER_BY_KEY`）。 */
export type TierKey = 'groupImage' | 'hotMeme' | 'builtin'

/** 内部素材类别。 */
export type MaterialKind = 'builtinAsset' | 'groupImage' | 'memberAvatar' | 'memberPhoto' | 'memberQuote'

/** 档位键 ↔ 契约层档位值（`data-model.md` 原文）。 */
export const TIER_BY_KEY: Readonly<Record<TierKey, MaterialTier>> = {
  groupImage: '参考群内图片',
  hotMeme: '改编热门表情包',
  builtin: '纯模板生成',
}

/** 契约层档位值 → 内部档位键（值非法时返回 null，由调用方落 `INVALID_INPUT`）。 */
export function tierKeyOf(tier: unknown): TierKey | null {
  for (const [key, value] of Object.entries(TIER_BY_KEY) as Array<[TierKey, MaterialTier]>) {
    if (value === tier) return key
  }
  return null
}

/** 需要 `DM-022` 确认的素材类别（成员素材：头像 / 照片 / 原话）。 */
export const MEMBER_MATERIAL_KINDS: readonly MaterialKind[] = ['memberAvatar', 'memberPhoto', 'memberQuote']

/** 是否为成员素材（装载即触发合规判定）。 */
export function isMemberMaterial(kind: MaterialKind): boolean {
  return MEMBER_MATERIAL_KINDS.includes(kind)
}

/** 素材条目（清单的一项；`memberRef` 仅成员素材必填）。 */
export interface MaterialItem {
  readonly kind: MaterialKind
  /** 媒体引用 / 成员标识 / 内置素材路径 / 原话句柄（确定性） */
  readonly ref: string
  /** 涉及成员（成员素材必填） */
  readonly memberRef?: Id
  /** 来源消息（群内图片 / 照片 / 原话） */
  readonly originMsgRef?: Id
  /** 装入的模板槽位（仅图片类素材有；原话不装槽位） */
  readonly slotId?: string
}

/** 素材清单（一次生成请求内使用；`MATERIAL_NOT_CONFIRMED` 的 context 携带同一份清单）。 */
export interface MaterialManifest {
  readonly tier: MaterialTier
  readonly templateId: Id
  readonly items: readonly MaterialItem[]
}

/** 素材句柄构造：成员头像（由成员标识确定性派生，不指向具体文件）。 */
export function avatarRefOf(memberId: Id): string {
  return `member-avatar/${memberId}`
}

/** 素材句柄构造：成员原话（由出处消息确定性派生）。 */
export function quoteRefOf(messageId: Id): string {
  return `member-quote/${messageId}`
}

/** 群内图片条目（来源消息类型 = 表情包）。 */
export function groupImageItem(mediaRef: MediaRef, messageId: Id, slotId?: string): MaterialItem {
  return { kind: 'groupImage', ref: mediaRef, originMsgRef: messageId, ...(slotId ? { slotId } : {}) }
}

/** 成员照片条目（来源消息类型 = 图片，从严判定）。 */
export function memberPhotoItem(
  mediaRef: MediaRef,
  memberId: Id,
  messageId: Id,
  slotId?: string,
): MaterialItem {
  return { kind: 'memberPhoto', ref: mediaRef, memberRef: memberId, originMsgRef: messageId, ...(slotId ? { slotId } : {}) }
}

/** 成员头像条目（`memberBound = true` 的模板槽位）。 */
export function memberAvatarItem(memberId: Id, messageId: Id, slotId?: string): MaterialItem {
  return { kind: 'memberAvatar', ref: avatarRefOf(memberId), memberRef: memberId, originMsgRef: messageId, ...(slotId ? { slotId } : {}) }
}

/** 成员原话条目（文案与来源消息文本逐字一致）。 */
export function memberQuoteItem(messageId: Id, memberId: Id): MaterialItem {
  return { kind: 'memberQuote', ref: quoteRefOf(messageId), memberRef: memberId, originMsgRef: messageId }
}

/** 内置素材条目（模板元数据的 `builtinAssets`）。 */
export function builtinItem(assetPath: string, slotId?: string): MaterialItem {
  return { kind: 'builtinAsset', ref: assetPath, ...(slotId ? { slotId } : {}) }
}

/** 清单条目的对外呈现形状（错误信封 `context.items`；不含消息原文，详设 §4.3）。 */
export function describeItem(item: MaterialItem): Record<string, unknown> {
  return {
    kind: item.kind,
    ref: item.ref,
    ...(item.memberRef ? { memberRef: item.memberRef } : {}),
    ...(item.originMsgRef ? { originMsgRef: item.originMsgRef } : {}),
    ...(item.slotId ? { slotId: item.slotId } : {}),
    needsConfirmation: isMemberMaterial(item.kind),
  }
}
