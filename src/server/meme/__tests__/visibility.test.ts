/**
 * MOD-005 §7「domain/Visibility」测试面（纯函数单测）：
 *
 * 五类纠正标记 × 可见性矩阵（§5.3）、合并折叠一跳 / 多跳 / 链端不可见、
 * 跳跃上限防御（32）、链断裂与成环的防御性排除 + warn、`normalize` 语义。
 */

import { describe, expect, it } from 'vitest'
import type { Meme } from '@shared'

import { VISIBILITY_JUMP_LIMIT } from '../constants'
import { normalize, resolveVisibility, type VisibilityWarn } from '../domain/visibility'
import { makeMeme } from './harness'

const GROUP = 'g1'

function makeMemeOf(memeId: string, correction: Meme['correction'], mergedIntoId: string | null = null): Meme {
  return makeMeme({ memeId, groupId: GROUP, name: memeId, correction, mergedIntoId })
}

function warnSpy(): { events: string[]; warn: VisibilityWarn } {
  const events: string[] = []
  return { events, warn: (event) => events.push(event) }
}

describe('MOD-005 Visibility：五类标记矩阵（§5.3）', () => {
  it('「无」→ 可见、根为自身；「梗王标注有误」→ 仍可见（仅降级为提示）', () => {
    const index = resolveVisibility([makeMemeOf('m1', '无'), makeMemeOf('m2', '梗王标注有误')])
    for (const memeId of ['m1', 'm2']) {
      const entry = index.entryOf(memeId)
      expect(entry?.state).toBe('visible')
      expect(entry?.rootId).toBe(memeId)
      expect(entry?.mergedAway).toBe(false)
      expect(normalize(memeId, index)).toBe(memeId)
    }
  })

  it('「不是梗」→ excluded、rootId 为空（不进任何视图，直访 NOT_FOUND）', () => {
    const index = resolveVisibility([makeMemeOf('m1', '不是梗')])
    expect(index.entryOf('m1')?.state).toBe('excluded')
    expect(index.entryOf('m1')?.rootId).toBeNull()
    expect(index.rootOf('m1')).toBeNull()
  })

  it('「不感兴趣」→ hidden、rootId 保留（不进视图但允许直访）', () => {
    const index = resolveVisibility([makeMemeOf('m1', '不感兴趣')])
    const entry = index.entryOf('m1')
    expect(entry?.state).toBe('hidden')
    expect(entry?.rootId).toBe('m1')
    expect(entry?.mergedAway).toBe(false)
  })

  it('「已合并至」→ 标记 mergedAway、rootId 指向目标（聚合单位为 root）', () => {
    const index = resolveVisibility([makeMemeOf('m1', '已合并至', 'm2'), makeMemeOf('m2', '无')])
    const entry = index.entryOf('m1')
    expect(entry?.mergedAway).toBe(true)
    expect(entry?.rootId).toBe('m2')
    expect(normalize('m1', index)).toBe('m2')
    expect(index.entryOf('m2')?.mergedAway).toBe(false)
  })
})

describe('MOD-005 Visibility：合并折叠与链端排除', () => {
  it('多跳折叠：A → B → C 均解析到链端 C', () => {
    const index = resolveVisibility([
      makeMemeOf('A', '已合并至', 'B'),
      makeMemeOf('B', '已合并至', 'C'),
      makeMemeOf('C', '无'),
    ])
    expect(index.rootOf('A')).toBe('C')
    expect(index.rootOf('B')).toBe('C')
    expect(index.rootOf('C')).toBe('C')
    expect(index.entryOf('A')?.mergedAway).toBe(true)
    expect(index.entryOf('B')?.mergedAway).toBe(true)
  })

  it('链端为「不是梗」：整条链 excluded（来源不可直访）', () => {
    const index = resolveVisibility([makeMemeOf('A', '已合并至', 'B'), makeMemeOf('B', '不是梗')])
    expect(index.entryOf('A')?.state).toBe('excluded')
    expect(index.entryOf('A')?.rootId).toBeNull()
    expect(index.entryOf('B')?.state).toBe('excluded')
    expect(normalize('A', index)).toBeNull()
  })

  it('链端为「不感兴趣」：整条链 hidden（不进视图，但仍可归一化到根）', () => {
    const index = resolveVisibility([makeMemeOf('A', '已合并至', 'B'), makeMemeOf('B', '不感兴趣')])
    expect(index.entryOf('A')?.state).toBe('hidden')
    expect(index.entryOf('A')?.rootId).toBe('B')
    expect(normalize('A', index)).toBe('B')
  })

  it('链断裂（目标不在范围内）：excluded 且记 warn', () => {
    const { events, warn } = warnSpy()
    const index = resolveVisibility([makeMemeOf('A', '已合并至', 'ghost')], warn)
    expect(index.entryOf('A')?.state).toBe('excluded')
    expect(index.rootOf('A')).toBeNull()
    expect(events).toContain('meme.visibility.chain-broken')
  })

  it('成环：环上成员 excluded 且记 warn（防御性截断）', () => {
    const { events, warn } = warnSpy()
    const index = resolveVisibility([makeMemeOf('A', '已合并至', 'B'), makeMemeOf('B', '已合并至', 'A')], warn)
    expect(index.entryOf('A')?.state).toBe('excluded')
    expect(index.entryOf('B')?.state).toBe('excluded')
    expect(events).toContain('meme.visibility.chain-cycle')
  })

  it(`跳跃上限防御：链长超过 ${VISIBILITY_JUMP_LIMIT} 跳的起点 excluded 并记 warn`, () => {
    const { events, warn } = warnSpy()
    const chain: Meme[] = Array.from({ length: 40 }, (_, index) => {
      const position = index + 1
      const next = position < 40 ? `m${position + 1}` : null
      return makeMemeOf(`m${position}`, next === null ? '无' : '已合并至', next)
    })
    const index = resolveVisibility(chain, warn)
    expect(index.entryOf('m7')?.state).toBe('excluded')
    expect(index.entryOf('m8')?.state).toBe('visible')
    expect(index.rootOf('m8')).toBe('m40')
    expect(events.filter((event) => event === 'meme.visibility.jump-limit')).toHaveLength(7)
  })
})

describe('MOD-005 Visibility：索引访问语义', () => {
  it('未知标识：entryOf 未定义、rootOf / normalize 为 null', () => {
    const index = resolveVisibility([makeMemeOf('m1', '无')])
    expect(index.entryOf('ghost')).toBeUndefined()
    expect(index.rootOf('ghost')).toBeNull()
    expect(normalize('ghost', index)).toBeNull()
  })

  it('entries 含全部标记且按标识稳定排序；visibleEntries 只含可进入视图的行', () => {
    const index = resolveVisibility([
      makeMemeOf('m3', '不是梗'),
      makeMemeOf('m1', '无'),
      makeMemeOf('m2', '不感兴趣'),
      makeMemeOf('m4', '已合并至', 'm1'),
    ])
    expect(index.entries().map((entry) => entry.memeId)).toEqual(['m1', 'm2', 'm3', 'm4'])
    // visible 条目：m1（根）与 m4（折叠来源，聚合单位为 m1）；hidden / excluded 不在其中。
    const visible = index.visibleEntries().map((entry) => entry.memeId)
    expect(visible).toContain('m1')
    expect(visible).not.toContain('m2')
    expect(visible).not.toContain('m3')
  })
})
