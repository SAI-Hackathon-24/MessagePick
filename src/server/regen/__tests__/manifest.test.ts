/**
 * MOD-008 素材清单（mod-008 §3.3 / §5.3；§8 决策 2 判定表）。
 *
 * 断言口径：
 * - 三档位与契约 `MATERIAL_TIERS` 一一对应（三档单选其一：单值 → 唯一档位键；多值/闭集外不映射）；
 * - 成员素材判定表：头像 / 照片 / 原话需 `DM-022` 确认，内置素材与群内表情包免确认（从严优先）；
 * - 素材条目构造：成员素材必带涉及成员与来源消息；原话不占模板槽位；
 * - `describeItem` 只暴露白名单字段（不含消息原文，详设 §4.3）。
 */

import { MATERIAL_TIERS } from '@shared'

import { describe, expect, it } from 'vitest'

import {
  MEMBER_MATERIAL_KINDS,
  TIER_BY_KEY,
  avatarRefOf,
  builtinItem,
  describeItem,
  groupImageItem,
  isMemberMaterial,
  memberAvatarItem,
  memberPhotoItem,
  memberQuoteItem,
  quoteRefOf,
  tierKeyOf,
} from '../materials/manifest'

describe('三档位映射（AC-067：三档单选其一，不可多选）', () => {
  it('内部档位键 ↔ 契约档位值与 MATERIAL_TIERS 完全一致（含顺序）', () => {
    expect(Object.keys(TIER_BY_KEY)).toEqual(['groupImage', 'hotMeme', 'builtin'])
    expect(Object.values(TIER_BY_KEY)).toEqual([...MATERIAL_TIERS])
  })

  it('每个合法档位值唯一映射一个内部键', () => {
    expect(tierKeyOf('参考群内图片')).toBe('groupImage')
    expect(tierKeyOf('改编热门表情包')).toBe('hotMeme')
    expect(tierKeyOf('纯模板生成')).toBe('builtin')
  })

  it('非单值 / 闭集外的取值不映射（调用方落 INVALID_INPUT，不触库）', () => {
    expect(tierKeyOf(undefined)).toBeNull()
    expect(tierKeyOf(null)).toBeNull()
    expect(tierKeyOf('')).toBeNull()
    expect(tierKeyOf('热门表情')).toBeNull()
    expect(tierKeyOf(['参考群内图片', '改编热门表情包'])).toBeNull() // 多选不收敛为任何档位
    expect(tierKeyOf({ tier: '纯模板生成' })).toBeNull()
  })
})

describe('成员素材判定表（§5.3 / §8 决策 2：从严优先）', () => {
  it('成员素材 = 头像 / 照片 / 原话，逐类可判', () => {
    expect([...MEMBER_MATERIAL_KINDS]).toEqual(['memberAvatar', 'memberPhoto', 'memberQuote'])
    expect(isMemberMaterial('memberAvatar')).toBe(true)
    expect(isMemberMaterial('memberPhoto')).toBe(true)
    expect(isMemberMaterial('memberQuote')).toBe(true)
  })

  it('内置素材与群内表情包免确认', () => {
    expect(isMemberMaterial('builtinAsset')).toBe(false)
    expect(isMemberMaterial('groupImage')).toBe(false)
  })
})

describe('素材句柄与条目构造（§3.3）', () => {
  it('头像 / 原话句柄由标识确定性派生，不指向具体文件', () => {
    expect(avatarRefOf('member-1')).toBe('member-avatar/member-1')
    expect(quoteRefOf('msg-1')).toBe('member-quote/msg-1')
    expect(avatarRefOf('member-1')).not.toBe(avatarRefOf('member-2'))
    expect(quoteRefOf('msg-1')).not.toBe(quoteRefOf('msg-2'))
  })

  it('群内图片（来源消息类型 = 表情包）：非成员素材；槽位可选', () => {
    expect(groupImageItem('media/sticker.png', 'msg-1', 'media')).toEqual({
      kind: 'groupImage',
      ref: 'media/sticker.png',
      originMsgRef: 'msg-1',
      slotId: 'media',
    })
    const withoutSlot = groupImageItem('media/sticker.png', 'msg-1')
    expect(withoutSlot).toEqual({ kind: 'groupImage', ref: 'media/sticker.png', originMsgRef: 'msg-1' })
    expect('slotId' in withoutSlot).toBe(false)
  })

  it('成员照片（来源消息类型 = 图片）：必带涉及成员（从严判定）', () => {
    expect(memberPhotoItem('media/photo.jpg', 'member-3', 'msg-2', 'photo')).toEqual({
      kind: 'memberPhoto',
      ref: 'media/photo.jpg',
      memberRef: 'member-3',
      originMsgRef: 'msg-2',
      slotId: 'photo',
    })
  })

  it('成员头像：装入 memberBound 槽位，涉及成员 = 来源消息发送者', () => {
    expect(memberAvatarItem('member-3', 'msg-2', 'avatar')).toEqual({
      kind: 'memberAvatar',
      ref: 'member-avatar/member-3',
      memberRef: 'member-3',
      originMsgRef: 'msg-2',
      slotId: 'avatar',
    })
  })

  it('成员原话：不占模板槽位，句柄由出处消息派生', () => {
    const quote = memberQuoteItem('msg-3', 'member-4')
    expect(quote).toEqual({
      kind: 'memberQuote',
      ref: 'member-quote/msg-3',
      memberRef: 'member-4',
      originMsgRef: 'msg-3',
    })
    expect('slotId' in quote).toBe(false)
  })

  it('内置素材：无成员 / 来源消息，槽位可选', () => {
    expect(builtinItem('assets/base.png', 'background')).toEqual({
      kind: 'builtinAsset',
      ref: 'assets/base.png',
      slotId: 'background',
    })
    expect('memberRef' in builtinItem('assets/base.png')).toBe(false)
    expect('originMsgRef' in builtinItem('assets/base.png')).toBe(false)
  })
})

describe('待确认清单的对外呈现（describeItem；详设 §4.3 不含消息原文）', () => {
  it('成员素材标 needsConfirmation = true，且只暴露白名单字段', () => {
    const described = describeItem(memberPhotoItem('media/photo.jpg', 'member-3', 'msg-2', 'photo'))
    expect(described).toEqual({
      kind: 'memberPhoto',
      ref: 'media/photo.jpg',
      memberRef: 'member-3',
      originMsgRef: 'msg-2',
      slotId: 'photo',
      needsConfirmation: true,
    })
    expect(Object.keys(described).sort()).toEqual(['kind', 'memberRef', 'needsConfirmation', 'originMsgRef', 'ref', 'slotId'])
  })

  it('非成员素材标 needsConfirmation = false，且不带成员字段', () => {
    const builtin = describeItem(builtinItem('assets/base.png'))
    expect(builtin).toEqual({ kind: 'builtinAsset', ref: 'assets/base.png', needsConfirmation: false })
    expect(Object.keys(builtin).sort()).toEqual(['kind', 'needsConfirmation', 'ref'])

    const groupImage = describeItem(groupImageItem('media/sticker.png', 'msg-1'))
    expect(groupImage.needsConfirmation).toBe(false)
  })
})
