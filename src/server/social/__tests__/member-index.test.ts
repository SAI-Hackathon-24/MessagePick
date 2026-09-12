/**
 * 成员索引在「同一 memberId 跨群重复」下的回归护栏（真实数据必然触发）。
 *
 * 缺陷回顾：`memberById` 曾用 `new Map(成员.map(m => [m.memberId, m]))` 构建。
 * 真机上登录账号 `me` 在 **22 个群**里各有一条 DM-004（实测 4035 条成员只有 3100 个
 * 不同 memberId），后写覆盖先写 →
 *   · 映射塌缩（4035 → 3100）；
 *   · `index.me()` 取到的那条 `isMe = false` → `findMe()` 返回 undefined
 *     → `API-023` / `API-025` 永远 `IDENTITY_NOT_READY`，社交模块整体不可用。
 *
 * 修复：`indexMembersById` 优先挑 `isMe = true` 的记录，其次首次出现者。
 */
import { describe, expect, it } from 'vitest'

import type { GroupMember } from '@shared'

import { indexMembersById } from '../build/index-store'

const member = (groupId: string, memberId: string, displayName: string, isMe = false): GroupMember => ({
  memberId,
  groupId,
  displayName,
  isMe,
  personId: `person:${groupId}:${memberId}`,
})

describe('成员索引：同一 memberId 跨群重复', () => {
  const members: GroupMember[] = [
    // 「我」在多个群里各有一条；isMe 只在其中一条为真（与真实数据一致）
    member('g1', 'me', '我', false),
    member('g2', 'me', '我', true),
    member('g3', 'me', '我', false),
    member('g1', 'alice', '爱丽丝'),
    member('g2', 'alice', '爱丽丝'),
    member('g1', 'bob', '鲍勃'),
  ]

  it('代表记录优先取 isMe=true 的那条（否则 API-023/025 永远身份未就绪）', () => {
    const byId = indexMembersById(members)

    expect(byId.get('me')?.isMe).toBe(true)
    expect(byId.get('me')?.groupId).toBe('g2')
  })

  it('非 Me 的重复 memberId 取首次出现者（结果与数据顺序无关地稳定）', () => {
    const byId = indexMembersById(members)

    expect(byId.get('alice')?.groupId).toBe('g1')
    expect(byId.get('bob')?.groupId).toBe('g1')
  })

  it('重复键被合并为一个代表（映射条数 = 不同 memberId 数）', () => {
    const byId = indexMembersById(members)

    expect(byId.size).toBe(3)
    expect([...byId.keys()].sort()).toEqual(['alice', 'bob', 'me'])
  })

  it('先出现 isMe=false、后出现 isMe=true 时也会被替换（顺序不敏感）', () => {
    const reversed = [...members].reverse()
    const byId = indexMembersById(reversed)

    expect(byId.get('me')?.isMe).toBe(true)
  })
})
