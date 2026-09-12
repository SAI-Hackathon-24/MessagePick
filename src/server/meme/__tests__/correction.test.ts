/**
 * MOD-005 §7「纠正改判」测试面：
 *
 * - `domain/Correction.checkMerge`：目标存在 → 同群 → 非自环 / 非成环 → 链端可见（§4 API-012、§6）；
 * - `app/applyCorrection`：四类改判提交与立即生效（AC-063）、合并折叠到链端根、
 *   「不是梗」后词云 / 统计消失且可恢复（AC-022 / AC-065）、目标不存在保留原状态（AC-064）、
 *   变体关系置失效（AC-061）、幂等与覆盖（§3.5 状态机 B）、存储失败映射（§6）。
 */

import { describe, expect, it } from 'vitest'
import type { Meme } from '@shared'

import { applyCorrection } from '../app/correction'
import { MemeError } from '../app/errors'
import { queryCloud } from '../app/queries'
import { checkMerge } from '../domain/correction'
import { resolveVisibility } from '../domain/visibility'
import {
  ForeignModuleError,
  createStore,
  daysBefore,
  makeDeps,
  makeEdge,
  makeMeme,
  makeMessage,
  makeOccurrence,
  NOW_MS,
  rejectionOf,
} from './harness'

const GROUP = 'g1'

function mixed(overrides: Partial<Meme> & { memeId: string }): Meme {
  return makeMeme({ groupId: GROUP, name: overrides.memeId, ...overrides })
}

describe('MOD-005 Correction：合并校验规则（checkMerge）', () => {
  it('通过：目标可见时返回链端根梗（目标本身可已被合并）', () => {
    const memes = [
      mixed({ memeId: 'A' }),
      mixed({ memeId: 'B', correction: '已合并至', mergedIntoId: 'C' }),
      mixed({ memeId: 'C' }),
    ]
    const index = resolveVisibility(memes)
    expect(checkMerge('A', 'B', index, memes)).toEqual({ ok: true, rootId: 'C' })
    expect(checkMerge('A', 'C', index, memes)).toEqual({ ok: true, rootId: 'C' })
  })

  it('拒绝：源或目标不存在', () => {
    const memes = [mixed({ memeId: 'A' })]
    const index = resolveVisibility(memes)
    expect(checkMerge('ghost', 'A', index, memes)).toMatchObject({ ok: false, reason: 'sourceMissing' })
    expect(checkMerge('A', 'ghost', index, memes)).toMatchObject({ ok: false, reason: 'targetMissing' })
  })

  it('拒绝：跨群合并（不做跨群归并，AC-076）', () => {
    const memes = [mixed({ memeId: 'A' }), makeMeme({ memeId: 'B', groupId: 'g2', name: 'B' })]
    const index = resolveVisibility(memes)
    expect(checkMerge('A', 'B', index, memes)).toMatchObject({ ok: false, reason: 'crossGroup' })
  })

  it('拒绝：自环与成环', () => {
    const memes = [
      mixed({ memeId: 'A', correction: '已合并至', mergedIntoId: 'C' }),
      mixed({ memeId: 'C' }),
    ]
    const index = resolveVisibility(memes)
    // A → A 自环。
    expect(checkMerge('A', 'A', index, memes)).toMatchObject({ ok: false, reason: 'selfLoop' })
    // C → A 会让 A → C 与 C → A 成环。
    expect(checkMerge('C', 'A', index, memes)).toMatchObject({ ok: false, reason: 'cycle' })
  })

  it('拒绝：合并目标链端不是可见梗（不是梗 / 不感兴趣）', () => {
    const memes = [
      mixed({ memeId: 'A' }),
      mixed({ memeId: 'X', correction: '已合并至', mergedIntoId: 'Y' }),
      mixed({ memeId: 'Y', correction: '不是梗' }),
      mixed({ memeId: 'H', correction: '不感兴趣' }),
    ]
    const index = resolveVisibility(memes)
    expect(checkMerge('A', 'X', index, memes)).toMatchObject({ ok: false, reason: 'rootNotVisible' })
    expect(checkMerge('A', 'Y', index, memes)).toMatchObject({ ok: false, reason: 'rootNotVisible' })
    expect(checkMerge('A', 'H', index, memes)).toMatchObject({ ok: false, reason: 'rootNotVisible' })
  })
})

describe('MOD-005 applyCorrection：四类改判与幂等（AC-063）', () => {
  it('四类改判均可提交，响应为落库后的最新梗数据', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [mixed({ memeId: 'A' }), mixed({ memeId: 'T' })])
    const deps = makeDeps(store)

    const notMeme = await applyCorrection(deps, { memeId: 'A', correction: '不是梗' })
    expect(notMeme).toMatchObject({ memeId: 'A', correction: '不是梗', mergedIntoId: null })

    const uninterested = await applyCorrection(deps, { memeId: 'A', correction: '不感兴趣' })
    expect(uninterested.correction).toBe('不感兴趣')

    const kingFix = await applyCorrection(deps, { memeId: 'A', correction: '梗王标注有误' })
    expect(kingFix.correction).toBe('梗王标注有误')

    const merged = await applyCorrection(deps, { memeId: 'A', correction: '合并到其他梗', mergeTargetId: 'T' })
    expect(merged.correction).toBe('已合并至')
    expect(merged.mergedIntoId).toBe('T')
    // 落库值 = 返回值（重读一致）。
    const stored = port.all('DM-006').find((row) => row.memeId === 'A')
    expect(stored).toEqual(merged)
  })

  it('重复提交同一改判结果一致且不产生重复行；后写覆盖先写', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [mixed({ memeId: 'A' })])
    const deps = makeDeps(store)

    await applyCorrection(deps, { memeId: 'A', correction: '不感兴趣' })
    await applyCorrection(deps, { memeId: 'A', correction: '不感兴趣' })
    expect(port.all('DM-006')).toHaveLength(1)
    expect(port.all('DM-006')[0]?.correction).toBe('不感兴趣')

    await applyCorrection(deps, { memeId: 'A', correction: '梗王标注有误' })
    expect(port.all('DM-006')).toHaveLength(1)
    expect(port.all('DM-006')[0]?.correction).toBe('梗王标注有误')
  })

  it('合并目标解析到链端根梗（多跳）', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [
      mixed({ memeId: 'A' }),
      mixed({ memeId: 'T', correction: '已合并至', mergedIntoId: 'R' }),
      mixed({ memeId: 'R' }),
    ])
    const deps = makeDeps(store)
    const merged = await applyCorrection(deps, { memeId: 'A', correction: '合并到其他梗', mergeTargetId: 'T' })
    expect(merged.mergedIntoId).toBe('R')
  })
})

describe('MOD-005 applyCorrection：拒绝与失败语义（AC-064 / §6）', () => {
  it('目标不存在：NOT_FOUND，原标记与统计不变', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [mixed({ memeId: 'A' })])
    const deps = makeDeps(store)

    const reason = await rejectionOf(
      applyCorrection(deps, { memeId: 'A', correction: '合并到其他梗', mergeTargetId: 'ghost' }),
    )
    expect(reason).toBeInstanceOf(MemeError)
    const error = reason as MemeError
    expect(error.envelope).toMatchObject({ code: 'NOT_FOUND', retryable: false, context: { reason: 'targetMissing' } })
    expect(port.all('DM-006')[0]?.correction).toBe('无')
    expect(port.all('DM-006')[0]?.mergedIntoId).toBeNull()
  })

  it('跨群目标被拒：NOT_FOUND 且不写入（不做跨群合并，AC-076）', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [mixed({ memeId: 'A' }), makeMeme({ memeId: 'B', groupId: 'g2', name: 'B' })])
    const deps = makeDeps(store)

    const reason = await rejectionOf(
      applyCorrection(deps, { memeId: 'A', correction: '合并到其他梗', mergeTargetId: 'B' }),
    )
    expect((reason as MemeError).envelope).toMatchObject({ code: 'NOT_FOUND', context: { reason: 'crossGroup' } })
    expect(port.all('DM-006').find((row) => row.memeId === 'A')?.correction).toBe('无')
  })

  it('缺合并目标：INVALID_INPUT（schema 层拒绝）；源梗不存在：NOT_FOUND', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [mixed({ memeId: 'A' })])
    const deps = makeDeps(store)

    const missingTarget = (await rejectionOf(
      applyCorrection(deps, { memeId: 'A', correction: '合并到其他梗' }),
    )) as MemeError
    expect(missingTarget.envelope.code).toBe('INVALID_INPUT')

    const missingSource = (await rejectionOf(
      applyCorrection(deps, { memeId: 'ghost', correction: '不是梗' }),
    )) as MemeError
    expect(missingSource.envelope).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('写入被存储拒绝：ANALYSIS_FAILED；存储抛错：原样透传 STORAGE_UNAVAILABLE', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [mixed({ memeId: 'A' })])
    const deps = makeDeps(store)

    port.writeFailures = (type) => (type === 'DM-006' ? [{ identity: ['A'], reason: '测试注入：拒绝写入' }] : null)
    const rejected = await rejectionOf(applyCorrection(deps, { memeId: 'A', correction: '不是梗' }))
    expect(rejected).toBeInstanceOf(MemeError)
    expect((rejected as MemeError).envelope).toMatchObject({ code: 'ANALYSIS_FAILED', retryable: true })

    port.writeFailures = null
    port.failWriteWith = { code: 'STORAGE_UNAVAILABLE', message: '存储不可用', retryable: true, scope: 'store' }
    const passthrough = await rejectionOf(applyCorrection(deps, { memeId: 'A', correction: '不是梗' }))
    expect(passthrough).toBeInstanceOf(ForeignModuleError)
    expect((passthrough as ForeignModuleError).envelope.code).toBe('STORAGE_UNAVAILABLE')
  })
})

describe('MOD-005 改判与查询联动：立即生效与变体失效（AC-022 / AC-061 / AC-065）', () => {
  /** 两个可见梗（A 出现 2 次 / C 出现 1 次）+ 必要消息与出现记录。 */
  function seedCloud() {
    const { port, store } = createStore()
    port.seed('DM-006', [
      mixed({ memeId: 'A', occurrenceCount: 2, monthlyCounts: { '2026-09': 2 } }),
      mixed({ memeId: 'C', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
    ])
    port.seed('DM-003', [
      makeMessage({ messageId: 'a1', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
      makeMessage({ messageId: 'c1', groupId: GROUP, senderMemberId: 'u_b', sentAt: daysBefore(1) }),
    ])
    port.seed('DM-007', [
      makeOccurrence({ memeId: 'A', sourceMessageId: 'a1', occurredAt: daysBefore(2) }),
      makeOccurrence({ memeId: 'C', sourceMessageId: 'c1', occurredAt: daysBefore(1) }),
    ])
    return { port, store, deps: makeDeps(store) }
  }

  it('「不是梗」后词云与统计不再包含该梗；改回可见类后恢复（AC-022 / AC-065）', async () => {
    const { deps } = seedCloud()
    const before = await queryCloud(deps, { layout: '按热度' })
    expect(before.terms.map((term) => term.memeId)).toEqual(['A', 'C'])

    await applyCorrection(deps, { memeId: 'C', correction: '不是梗' })
    const after = await queryCloud(deps, { layout: '按热度' })
    expect(after.terms.map((term) => term.memeId)).toEqual(['A'])
    expect(after.terms.every((term) => term.memeId !== 'C')).toBe(true)
    // 改判记录保留（行仍在库内，可在改判记录中查到）。
    expect((await applyCorrection(deps, { memeId: 'C', correction: '梗王标注有误' })).correction).toBe('梗王标注有误')
    const restored = await queryCloud(deps, { layout: '按热度' })
    expect(restored.terms.map((term) => term.memeId)).toEqual(['A', 'C'])
  })

  it('合并后统计折叠到目标：出现次数相加、来源不再单独出现', async () => {
    const { deps } = seedCloud()
    await applyCorrection(deps, { memeId: 'C', correction: '合并到其他梗', mergeTargetId: 'A' })
    const cloud = await queryCloud(deps, { layout: '按热度' })
    expect(cloud.terms.map((term) => term.memeId)).toEqual(['A'])
    expect(cloud.terms[0]?.occurrenceCount).toBe(3)
  })

  it('「不是梗」与合并把相关变体边置「已失效」（AC-061）', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [
      mixed({ memeId: 'S' }),
      mixed({ memeId: 'X' }),
      mixed({ memeId: 'Y' }),
      mixed({ memeId: 'T' }),
    ])
    port.seed('DM-008', [makeEdge('S', 'X'), makeEdge('Y', 'S')])
    const deps = makeDeps(store)

    await applyCorrection(deps, { memeId: 'S', correction: '不是梗' })
    expect(port.all('DM-008').map((edge) => edge.status)).toEqual(['已失效', '已失效'])

    // 改回可见类：不恢复已失效的边（无自动恢复路径）。
    await applyCorrection(deps, { memeId: 'S', correction: '梗王标注有误' })
    expect(port.all('DM-008').every((edge) => edge.status === '已失效')).toBe(true)

    // 合并同样触发失效。
    port.seed('DM-008', [makeEdge('S', 'T')])
    await applyCorrection(deps, { memeId: 'S', correction: '合并到其他梗', mergeTargetId: 'T' })
    expect(port.all('DM-008').at(-1)?.status).toBe('已失效')
  })
})
