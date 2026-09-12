/**
 * MOD-008 幂等键（mod-008 §5.1 / §5.2 / §7.2「幂等」）。
 *
 * 断言口径：
 * - 幂等键跨进程稳定（不随重启变化），确定性散列、无依赖；
 * - 同一素材重复使用不产生第二条 `DM-022`（同一确认标识）；
 * - 同名素材不同成员不共享确认（确认标识含涉及成员）；
 * - 重复候选确认返回同一入库梗标识（AC-071）；
 * - 出现记录按「梗 + 来源消息」去重（§8 决策 5）。
 */

import { describe, expect, it } from 'vitest'

import {
  candidateIdOf,
  consentIdOf,
  consentIdentityKey,
  memeIdOfCandidate,
  occurrenceIdOf,
  stableHash,
} from '../domain/dedupe'

describe('stableHash（FNV-1a 64 位：确定性、跨进程稳定）', () => {
  it('同一输入永远同一结果，输出 16 位十六进制', () => {
    expect(stableHash('hello')).toBe(stableHash('hello'))
    expect(stableHash('hello')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('钉住算法向量：空串 = FNV 偏移基数（cbf29ce484222325）', () => {
    expect(stableHash('')).toBe('cbf29ce484222325')
  })

  it('不同输入给出不同散列（含换序、长度变化）', () => {
    expect(stableHash('a')).not.toBe(stableHash('b'))
    expect(stableHash('ab')).not.toBe(stableHash('ba'))
  })
})

describe('素材确认标识（DM-022）', () => {
  it('身份键 = 素材类别 + 素材引用 + 涉及成员（三者任一变化即不同）', () => {
    const key = consentIdentityKey('memberAvatar', 'member-avatar/m1', 'm1')
    expect(key).toBe(consentIdentityKey('memberAvatar', 'member-avatar/m1', 'm1'))
    expect(key).not.toBe(consentIdentityKey('memberAvatar', 'member-avatar/m1', 'm2'))
    expect(key).not.toBe(consentIdentityKey('memberPhoto', 'member-avatar/m1', 'm1'))
    expect(key).not.toBe(consentIdentityKey('memberAvatar', 'member-avatar/m2', 'm1'))
  })

  it('确认标识确定性：同一素材重复确认不产生第二条（§5.1）', () => {
    const first = consentIdOf('memberQuote', 'member-quote/msg-1', 'm1')
    const second = consentIdOf('memberQuote', 'member-quote/msg-1', 'm1')
    expect(first).toBe(second)
    expect(first).toMatch(/^consent-[0-9a-f]{16}$/)
  })

  it('同名素材不同成员不共享确认（§7.2）', () => {
    expect(consentIdOf('memberPhoto', 'media/photo.png', 'm1')).not.toBe(
      consentIdOf('memberPhoto', 'media/photo.png', 'm2'),
    )
  })

  it('非成员素材（memberId = null）与成员素材不共享标识，且自身确定', () => {
    expect(consentIdOf('groupImage', 'media/sticker.png', null)).toBe(consentIdOf('groupImage', 'media/sticker.png', null))
    expect(consentIdOf('groupImage', 'media/sticker.png', null)).not.toBe(consentIdOf('groupImage', 'media/sticker.png', 'm1'))
  })
})

describe('候选 / 入库梗 / 出现记录标识', () => {
  it('候选标识 = 生成请求 ID + 1 起序号（确定性可复现）', () => {
    expect(candidateIdOf('gen-3', 0)).toBe('cand-gen-3-1')
    expect(candidateIdOf('gen-3', 1)).toBe('cand-gen-3-2')
    expect(candidateIdOf('gen-3', 0)).not.toBe(candidateIdOf('gen-4', 0))
  })

  it('重复候选确认返回同一入库梗标识（AC-071：不重复入库、不重跑任务）', () => {
    expect(memeIdOfCandidate('cand-gen-3-1')).toBe(memeIdOfCandidate('cand-gen-3-1'))
    expect(memeIdOfCandidate('cand-gen-3-1')).toMatch(/^meme-[0-9a-f]{16}$/)
    expect(memeIdOfCandidate('cand-gen-3-1')).not.toBe(memeIdOfCandidate('cand-gen-3-2'))
  })

  it('出现记录标识 = （梗 + 来源消息）的去重键（§8 决策 5）', () => {
    expect(occurrenceIdOf('meme-a', 'msg-1')).toBe(occurrenceIdOf('meme-a', 'msg-1'))
    expect(occurrenceIdOf('meme-a', 'msg-1')).toMatch(/^occ-[0-9a-f]{16}$/)
    expect(occurrenceIdOf('meme-a', 'msg-1')).not.toBe(occurrenceIdOf('meme-a', 'msg-2'))
    expect(occurrenceIdOf('meme-a', 'msg-1')).not.toBe(occurrenceIdOf('meme-b', 'msg-1'))
  })
})
