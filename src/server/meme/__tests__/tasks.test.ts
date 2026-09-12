/**
 * MOD-005 §7「任务结果校验」测试面（`domain/tasks.ts` 纯函数）：
 *
 * - 识别：梗名 / 解读 / 类型闭集 / 来源引用四项缺一即失败（§6：该分项不落库；
 *   来源引用显式为空 = 未实际使用 → 跳过该条，不算失败）；
 * - 变体：跨群成员被丢弃、不做跨群归并（AC-076）；
 * - 精华：可回指来源、空结果失败、展开上限 `ESSENCE_MAX`。
 */

import { describe, expect, it } from 'vitest'
import type { RawMessage, TaskResult } from '@shared'

import { ESSENCE_MAX } from '../constants'
import { parseEssencePicks, parseRecognition, parseVariantClusters, type UnitRef } from '../domain/tasks'
import { makeMeme, makeMessage } from './harness'

const GROUP = 'g1'

const units: UnitRef[] = [
  { marker: 1, id: 'm1' },
  { marker: 2, id: 'm2' },
]

function messages(): Map<string, RawMessage> {
  return new Map([
    ['m1', makeMessage({ messageId: 'm1', groupId: GROUP, senderMemberId: 'u_a', sentAt: 1 })],
    ['m2', makeMessage({ messageId: 'm2', groupId: GROUP, senderMemberId: 'u_b', sentAt: 2 })],
  ])
}

describe('MOD-005 tasks：识别结果校验', () => {
  it('合法条目：类型闭集内、来源可回指（编号或标识均可）；同名条目合并来源', () => {
    const result: TaskResult = {
      items: [
        { name: 'yyds', kind: '口头禅', interpretation: '解读一', sourceRefs: ['m1'] },
        { name: 'yyds', kind: '口头禅', interpretation: '解读一', sourceRefs: [2] },
      ],
    }
    const parsed = parseRecognition(result, units, messages())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.messageIds).toEqual(['m1', 'm2'])
    expect(parsed.sourceRefs).toEqual(['m1', 'm2'])
  })

  it('缺梗名 / 缺解读 / 类型不在闭集：按失败处理（不落库）', () => {
    const base = { name: 'yyds', kind: '口头禅', interpretation: '解读', sourceRefs: ['m1'] }
    expect(parseRecognition({ items: [{ ...base, name: '  ' }] }, units, messages())).toMatchObject({
      ok: false,
      reason: '识别结果缺少梗名',
    })
    expect(parseRecognition({ items: [{ ...base, interpretation: '' }] }, units, messages())).toMatchObject({
      ok: false,
    })
    expect(parseRecognition({ items: [{ ...base, kind: '禁忌梗' }] }, units, messages())).toMatchObject({
      ok: false,
      reason: '识别结果类型不在闭集内（梗名：yyds）',
    })
  })

  it('来源引用不可回指：按失败处理（来源引用缺失）', () => {
    const parsed = parseRecognition(
      { items: [{ name: 'yyds', kind: '口头禅', interpretation: '解读', sourceRefs: ['ghost'] }] },
      units,
      messages(),
    )
    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) expect(parsed.reason).toContain('来源消息')
  })

  it('空结果：合法返回空条目（由批次层决定不落库）', () => {
    expect(parseRecognition({ items: [] }, units, messages())).toEqual({ ok: true, items: [], sourceRefs: [] })
  })

  it('来源引用显式为空数组：跳过该条（仅被讨论/起名、未实际使用），不视为失败', () => {
    const parsed = parseRecognition(
      {
        items: [
          { name: 'yyds', kind: '口头禅', interpretation: '解读', sourceRefs: [1] },
          { name: '只被传唤', kind: '内部梗', interpretation: '解读', sourceRefs: [] },
        ],
      },
      units,
      messages(),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.name).toBe('yyds')
    expect(parsed.sourceRefs).toEqual(['m1'])
  })
})

describe('MOD-005 tasks：变体聚类校验（不做跨群归并，AC-076）', () => {
  const memesById = new Map([
    ['mA', makeMeme({ memeId: 'mA', groupId: GROUP, name: 'A' })],
    ['mB', makeMeme({ memeId: 'mB', groupId: GROUP, name: 'B' })],
    ['mC', makeMeme({ memeId: 'mC', groupId: 'g2', name: 'C' })],
  ])

  it('同群簇通过：代表取簇内首个成员，来源引用去重', () => {
    const parsed = parseVariantClusters({ items: [{ representative: 'A', members: ['mA', 'mB'] }] }, units, memesById)
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) return
    expect(parsed.items).toEqual([{ representativeName: 'A', memberIds: ['mA', 'mB'] }])
    expect(parsed.sourceRefs.sort()).toEqual(['mA', 'mB'])
  })

  it('跨群成员被丢弃；只剩 1 个同群成员时整簇不算（拒绝跨群归并）', () => {
    const parsed = parseVariantClusters({ items: [{ representative: 'A', members: ['mA', 'mC'] }] }, units, memesById)
    expect(parsed).toMatchObject({ ok: false })
  })

  it('空结果合法；成员不足 2 个的簇跳过', () => {
    expect(parseVariantClusters({ items: [] }, units, memesById)).toEqual({ ok: true, items: [], sourceRefs: [] })
    expect(parseVariantClusters({ items: [{ representative: 'A', members: ['mA'] }] }, units, memesById)).toMatchObject({
      ok: false,
    })
  })
})

describe('MOD-005 tasks：精华选取（上限 ESSENCE_MAX）', () => {
  const allowed = new Set(['m1', 'm2'])
  const wide = new Set(Array.from({ length: 10 }, (_, index) => `m${index + 1}`))

  it('按返回顺序保留可回指来源；不可回指的引用被丢弃', () => {
    const parsed = parseEssencePicks(
      { items: [{ sourceRefs: ['m1', 'ghost'] }, { sourceRefs: ['m2'] }] },
      units,
      allowed,
    )
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) return
    expect(parsed.items).toEqual([{ messageIds: ['m1'] }, { messageIds: ['m2'] }])
  })

  it('全部引用不可回指 / 空结果：按失败处理（该分项不落库）', () => {
    expect(parseEssencePicks({ items: [{ sourceRefs: ['ghost'] }] }, units, allowed)).toMatchObject({ ok: false })
    expect(parseEssencePicks({ items: [] }, units, allowed)).toMatchObject({ ok: false })
  })

  it(`摊平后总条数不超过 ${ESSENCE_MAX} 条`, () => {
    const refs = [...wide]
    const parsed = parseEssencePicks(
      { items: [{ sourceRefs: refs }, { sourceRefs: refs }, { sourceRefs: refs }] },
      units,
      wide,
    )
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) return
    expect(parsed.items.flatMap((pick) => pick.messageIds)).toHaveLength(ESSENCE_MAX)
  })
})
