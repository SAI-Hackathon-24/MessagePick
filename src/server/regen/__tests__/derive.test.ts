/**
 * MOD-008 入库字段派生（mod-008 §3.1 / §5.1 / §8 决策 5；AC-031 / AC-033 / AC-066 ~ AC-071）。
 *
 * 断言口径：
 * - `DM-020` 三型记录：模板含版本、档位与产出引用齐全、「创作」标注恒为 true；
 * - 产物引用 = `gen/<记录标识>/<变体序号>.<扩展名>`（G1 = 4 张 png、G2 = 5 条 txt、G3 = 候选标识）；
 * - `DM-021` 候选三字段俱全（含义推测 / 出处消息 / 使用示例）、确认前不关联入库梗；
 * - `DM-022` 确认记录的标识 / 成员 / 状态 / 确认时间（重复确认幂等）；
 * - `DM-006` / `DM-007` 按出处消息确定性派生（归属群 / 首末时间 / 梗王 / 出现记录去重）。
 */

import type { RawMessage } from '@shared'

import { describe, expect, it } from 'vitest'

import { DAY_MS, G1_VARIANT_COUNT, G2_VARIANT_COUNT } from '../constants'
import { consentIdOf, occurrenceIdOf } from '../domain/dedupe'
import {
  artifactRefOf,
  candidateRecordOf,
  consentRecordOf,
  consentRefOf,
  consentRefsIn,
  generationRecordForCandidates,
  generationRecordForEmoji,
  generationRecordForTexts,
  heatOf,
  memeRecordOfCandidate,
  monthOf,
  naturalDaySpan,
  occurrenceRecordOf,
  visibleOutputRefs,
} from '../domain/derive'
import { CLOCK, rawMessage } from './harness'

describe('产物引用（§5.1：gen/<记录标识>/<变体序号>.<扩展名>）', () => {
  it('G1 四张变体图引用互异且序号从 1 起；G2 文本引用带 .txt', () => {
    const refs = Array.from({ length: G1_VARIANT_COUNT }, (_, index) => artifactRefOf('gen-1', index + 1, 'png'))
    expect(refs).toEqual(['gen/gen-1/1.png', 'gen/gen-1/2.png', 'gen/gen-1/3.png', 'gen/gen-1/4.png'])
    expect(new Set(refs).size).toBe(G1_VARIANT_COUNT)
    expect(artifactRefOf('gen-2', 1, 'txt')).toBe('gen/gen-2/1.txt')
  })
})

describe('DM-020 生成记录（AC-031 / AC-066 / AC-067 / AC-069）', () => {
  it('G1：模板记录「标识 + 版本」、档位入库、4 张 png + 成员确认引用、标注恒为 true', () => {
    const outputs = Array.from({ length: G1_VARIANT_COUNT }, (_, index) => artifactRefOf('gen-1', index + 1, 'png'))
    const record = generationRecordForEmoji({
      generationId: 'gen-1',
      memeId: 'meme-7',
      tier: '改编热门表情包',
      templateId: 'tpl-basic',
      templateVersion: 2,
      outputRefs: outputs,
      consentIds: ['consent-abc'],
      generatedAt: CLOCK,
    })

    expect(record.generationId).toBe('gen-1')
    expect(record.kind).toBe('G1')
    expect(record.memeId).toBe('meme-7')
    expect(record.materialTier).toBe('改编热门表情包')
    expect(record.template).toBe('tpl-basic@2') // 历史产物锁定模板版本（§8 决策 3）
    expect(record.creationMark).toBe(true)
    expect(record.generatedAt).toBe(CLOCK)
    expect(record.outputRefs).toHaveLength(G1_VARIANT_COUNT + 1)

    expect(visibleOutputRefs(record.outputRefs)).toEqual(outputs)
    expect(consentRefsIn(record.outputRefs)).toEqual(['consent-abc'])
  })

  it('G1 无成员素材（纯模板档）时不带任何确认引用', () => {
    const outputs = Array.from({ length: G1_VARIANT_COUNT }, (_, index) => artifactRefOf('gen-2', index + 1, 'png'))
    const record = generationRecordForEmoji({
      generationId: 'gen-2',
      memeId: 'meme-8',
      tier: '纯模板生成',
      templateId: 'tpl-basic',
      templateVersion: 1,
      outputRefs: outputs,
      consentIds: [],
      generatedAt: CLOCK,
    })
    expect(record.outputRefs).toEqual(outputs)
    expect(consentRefsIn(record.outputRefs)).toEqual([])
  })

  it('G2：5 条文本产物、无模板 / 档位字段、标注恒为 true', () => {
    const outputs = Array.from({ length: G2_VARIANT_COUNT }, (_, index) => artifactRefOf('gen-3', index + 1, 'txt'))
    const record = generationRecordForTexts({
      generationId: 'gen-3',
      memeId: 'meme-7',
      outputRefs: outputs,
      generatedAt: CLOCK,
    })
    expect(record.kind).toBe('G2')
    expect(record.materialTier).toBeNull()
    expect(record.template).toBeNull()
    expect(record.creationMark).toBe(true)
    expect(record.outputRefs).toEqual(outputs)
    expect(record.outputRefs).toHaveLength(G2_VARIANT_COUNT)
  })

  it('G3：产出引用 = 候选标识、梗引用留空待确认回填（AC-070）', () => {
    const record = generationRecordForCandidates({
      generationId: 'gen-4',
      candidateIds: ['cand-gen-4-1', 'cand-gen-4-2'],
      generatedAt: CLOCK,
    })
    expect(record.kind).toBe('G3')
    expect(record.memeId).toBeNull() // 确认入库后才回填（§4.5）
    expect(record.materialTier).toBeNull()
    expect(record.template).toBeNull()
    expect(record.creationMark).toBe(true)
    expect(record.outputRefs).toEqual(['cand-gen-4-1', 'cand-gen-4-2'])
  })

  it('派生的记录不持有入参数组的引用（后续改动不回写）', () => {
    const outputRefs = [artifactRefOf('gen-5', 1, 'png')]
    const consentIds = ['consent-1']
    const record = generationRecordForEmoji({
      generationId: 'gen-5',
      memeId: 'meme-1',
      tier: '纯模板生成',
      templateId: 'tpl-basic',
      templateVersion: 1,
      outputRefs,
      consentIds,
      generatedAt: CLOCK,
    })
    outputRefs.push(artifactRefOf('gen-5', 2, 'png'))
    consentIds.push('consent-2')
    expect(record.outputRefs).toEqual([artifactRefOf('gen-5', 1, 'png'), consentRefOf('consent-1')])
  })
})

describe('DM-021 候选梗单元（AC-070 / AC-072）', () => {
  it('含义推测 / 出处消息 / 使用示例三条俱全；状态 = 候选、未关联入库梗', () => {
    const candidate = candidateRecordOf({
      candidateId: 'cand-gen-4-1',
      meaningGuess: '同事故意用反话夸人',
      usageExample: 'A：你可真是个小天才 B：？',
      sourceMessageIds: ['msg-1', 'msg-2'],
    })
    expect(candidate.candidateId).toBe('cand-gen-4-1')
    expect(candidate.meaningGuess).toBeTruthy()
    expect(candidate.sourceMessageIds).toEqual(['msg-1', 'msg-2'])
    expect(candidate.usageExample).toBeTruthy()
    expect(candidate.status).toBe('候选') // 确认前不进词云等视图
    expect(candidate.memeId).toBeNull()
  })

  it('候选记录对出处消息取副本（后续输入变动不影响已派生记录）', () => {
    const sourceMessageIds = ['msg-1']
    const candidate = candidateRecordOf({
      candidateId: 'cand-x',
      meaningGuess: '含义',
      usageExample: '示例',
      sourceMessageIds,
    })
    sourceMessageIds.push('msg-2')
    expect(candidate.sourceMessageIds).toEqual(['msg-1'])
  })
})

describe('DM-022 素材确认记录（AC-032 / AC-033）', () => {
  it('标识与（类别 + 引用 + 成员）一致；未确认 / 已确认两态', () => {
    const pending = consentRecordOf({
      kind: 'memberAvatar',
      ref: 'member-avatar/m1',
      memberId: 'm1',
      status: '未确认',
      confirmedAt: null,
    })
    expect(pending.consentId).toBe(consentIdOf('memberAvatar', 'member-avatar/m1', 'm1'))
    expect(pending.materialRef).toBe('member-avatar/m1')
    expect(pending.memberIds).toEqual(['m1'])
    expect(pending.status).toBe('未确认')
    expect(pending.confirmedAt).toBeNull()

    const confirmed = consentRecordOf({
      kind: 'memberAvatar',
      ref: 'member-avatar/m1',
      memberId: 'm1',
      status: '已确认',
      confirmedAt: CLOCK,
    })
    expect(confirmed.consentId).toBe(pending.consentId) // 重复确认不产生第二条（幂等）
    expect(confirmed.status).toBe('已确认')
    expect(confirmed.confirmedAt).toBe(CLOCK)
  })

  it('非成员素材的确认记录成员列表为空（涉及成员只在成员素材上出现）', () => {
    const record = consentRecordOf({
      kind: 'groupImage',
      ref: 'media/sticker.png',
      memberId: null,
      status: '未确认',
      confirmedAt: null,
    })
    expect(record.memberIds).toEqual([])
  })
})

describe('时间与热度派生（DM-006 口径）', () => {
  it('monthOf 输出 YYYY-MM（UTC，个位月补零）', () => {
    expect(monthOf(Date.UTC(2026, 8, 12, 23, 59, 59))).toBe('2026-09')
    expect(monthOf(Date.UTC(2026, 0, 5))).toBe('2026-01')
  })

  it('heatOf 边界：≤7 天活跃 / ≤30 天衰减中 / >30 天已沉寂', () => {
    expect(heatOf(0)).toBe('活跃')
    expect(heatOf(7 * DAY_MS)).toBe('活跃')
    expect(heatOf(7 * DAY_MS + 1)).toBe('衰减中')
    expect(heatOf(30 * DAY_MS)).toBe('衰减中')
    expect(heatOf(30 * DAY_MS + 1)).toBe('已沉寂')
  })

  it('naturalDaySpan：自然日跨度且至少 1 天（含倒序输入兜底）', () => {
    expect(naturalDaySpan(CLOCK, CLOCK)).toBe(1)
    expect(naturalDaySpan(CLOCK, CLOCK + 12 * 60 * 60 * 1_000)).toBe(1)
    expect(naturalDaySpan(CLOCK, CLOCK + 25 * 60 * 60 * 1_000)).toBe(2)
    expect(naturalDaySpan(CLOCK, CLOCK - DAY_MS)).toBe(1)
  })
})

describe('DM-006 / DM-007 确认入库派生（§8 决策 5）', () => {
  const messages: RawMessage[] = [
    rawMessage({ messageId: 'msg-b', senderMemberId: 'member-2', sentAt: CLOCK + DAY_MS, kind: '表情包', mediaRef: 'media/sticker.png' }),
    rawMessage({ messageId: 'msg-a', senderMemberId: 'member-1', sentAt: CLOCK }),
    rawMessage({ messageId: 'msg-c', senderMemberId: 'member-2', sentAt: CLOCK + 2 * DAY_MS }),
  ]

  it('归属群 / 首现 / 最近使用 / 累计次数 / 梗王按出处消息确定性派生', () => {
    const meme = memeRecordOfCandidate({
      memeId: 'meme-x',
      candidateId: 'cand-gen-4-1',
      name: '小天才',
      kind: '内部梗',
      interpretation: '反话夸人',
      messages,
      now: CLOCK + 2 * DAY_MS,
    })

    expect(meme.memeId).toBe('meme-x')
    expect(meme.groupId).toBe('group-1') // 归属群 = 出处消息所属群
    expect(meme.firstSeenGroupId).toBe('group-1')
    expect(meme.sourceCandidateId).toBe('cand-gen-4-1')
    expect(meme.firstSeenAt).toBe(CLOCK) // 乱序输入按发送时间取首末
    expect(meme.lastUsedAt).toBe(CLOCK + 2 * DAY_MS)
    expect(meme.elapsed).toBe(0)
    expect(meme.occurrenceCount).toBe(3)
    expect(meme.correction).toBe('无')
    expect(meme.mergedIntoId).toBeNull()
    expect(meme.heat).toBe('活跃')
  })

  it('月度分布 / 生命周期随 now 推进；梗王按次数降序、并列按成员标识升序', () => {
    const meme = memeRecordOfCandidate({
      memeId: 'meme-x',
      candidateId: 'cand-gen-4-1',
      name: '小天才',
      kind: '内部梗',
      interpretation: '反话夸人',
      messages,
      now: CLOCK + 12 * DAY_MS,
    })

    expect(meme.elapsed).toBe(10 * DAY_MS)
    expect(meme.heat).toBe('衰减中')
    expect(meme.weekOverWeek).toBe(1)
    expect(meme.monthlyCounts).toEqual({ [monthOf(CLOCK)]: 3 })
    expect(meme.lifecycle).toEqual({
      firstSeenAt: CLOCK,
      peakMonth: monthOf(CLOCK),
      silentAt: CLOCK + 2 * DAY_MS,
      activeDays: 2,
    })
    expect(meme.memeKing).toEqual([
      { memberId: 'member-2', count: 2, share: 2 / 3 },
      { memberId: 'member-1', count: 1, share: 1 / 3 },
    ])

    const tied = memeRecordOfCandidate({
      memeId: 'meme-y',
      candidateId: 'cand-y',
      name: '口头禅',
      kind: '口头禅',
      interpretation: '开场白',
      messages: [
        rawMessage({ messageId: 'm1', senderMemberId: 'member-3' }),
        rawMessage({ messageId: 'm2', senderMemberId: 'member-2' }),
      ],
      now: CLOCK,
    })
    expect(tied.memeKing.map((entry) => entry.memberId)).toEqual(['member-2', 'member-3'])
  })

  it('出现记录：时间 = 发送时间、发言成员 = 发送者、mineRelated 透传、按「梗 + 消息」幂等', () => {
    const message = rawMessage({ messageId: 'msg-a', senderMemberId: 'member-7', sentAt: CLOCK + 5 })
    const occurrence = occurrenceRecordOf({ memeId: 'meme-x', message, mineRelated: false })

    expect(occurrence.occurrenceId).toBe(occurrenceIdOf('meme-x', 'msg-a'))
    expect(occurrence.memeId).toBe('meme-x')
    expect(occurrence.sourceMessageId).toBe('msg-a')
    expect(occurrence.occurredAt).toBe(CLOCK + 5)
    expect(occurrence.speakerMemberId).toBe('member-7')
    expect(occurrence.mineRelated).toBe(false)

    const replay = occurrenceRecordOf({ memeId: 'meme-x', message, mineRelated: true })
    expect(replay.occurrenceId).toBe(occurrence.occurrenceId)
  })
})
