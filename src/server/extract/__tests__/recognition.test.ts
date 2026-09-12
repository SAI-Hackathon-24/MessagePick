/**
 * 识别与要素提取（mod-006 §7「识别与要素」行；§4、§5.1、§8 决策 7；TASK-018）：
 *
 * - 九类基线注入识别任务参数；九类样例逐类可解析为条目（真实模型行为不在单测范围，全部 mock）；
 * - 闭集外新类型透传（「可扩展」的落点）；空类型 / 无来源引用 / 重复条目丢弃；
 * - 来源引用容错（编号 / 包裹写法 / 直接标识），条目标识 = 内容哈希（写入幂等键）；
 * - 要素：齐全映射、缺项留空不猜、人物要素映射到成员引用、优先级严格三档且默认「中」。
 */

import { describe, expect, it } from 'vitest'

import { KNOWN_RECOGNITION_TYPES, type RawMessage } from '@shared'

import { RECOGNITION_TYPES } from '../constants'
import {
  buildEntryId,
  buildRecognitionRequest,
  MemberNameIndex,
  messageUnitText,
  normalizePriority,
  parseExtractedDraft,
  parseRecognizedItems,
  parseTimestamp,
  resolveItemSourceIds,
  taskRefOf,
  toUnits,
} from '../pipeline/recognition'
import { member, message } from './harness'

describe('识别（§4 API-007「识别」）', () => {
  it('识别任务参数注入基线九类（可加项扩展的唯一取值来源 = constants）', () => {
    const request = buildRecognitionRequest([message('m1', 'g1', 1)])
    expect(request.taskType).toBe('识别')
    expect(RECOGNITION_TYPES).toEqual([...KNOWN_RECOGNITION_TYPES])
    expect(request.params.options?.recognitionTypes).toEqual([...KNOWN_RECOGNITION_TYPES])
  })

  it('九类样例各命中：逐类解析为条目并携带来源引用', () => {
    const messages = Array.from({ length: 9 }, (_, index) => message(`m${index + 1}`, 'g1', index + 1))
    const items = KNOWN_RECOGNITION_TYPES.map((type, index) => ({
      recognitionType: type,
      sourceRefs: [String(index + 1)],
    }))
    const parsed = parseRecognizedItems(items, messages)
    expect(parsed.map((item) => item.recognitionType)).toEqual([...KNOWN_RECOGNITION_TYPES])
    expect(parsed[0]?.sourceMessageIds).toEqual(['m1'])
    expect(parsed.every((item) => item.sourceMessageIds.length === 1)).toBe(true)
  })

  it('闭集外的新类型透传（宽松校验；新增识别类型不改数据结构）', () => {
    const parsed = parseRecognizedItems([{ recognitionType: '生日提醒', sourceRefs: ['m1'] }], [message('m1', 'g1', 1)])
    expect(parsed).toEqual([{ recognitionType: '生日提醒', sourceMessageIds: ['m1'] }])
  })

  it('空类型 / 无来源引用 / 重复条目不落半成品', () => {
    const messages = [message('m1', 'g1', 1)]
    const parsed = parseRecognizedItems(
      [
        { recognitionType: '', sourceRefs: ['m1'] },
        { recognitionType: '会议', sourceRefs: [] },
        { recognitionType: '会议', sourceRefs: ['10'] },
        { recognitionType: '会议', sourceRefs: ['m1'] },
        { recognitionType: '会议', sourceRefs: ['m1'] },
      ],
      messages,
    )
    expect(parsed).toEqual([{ recognitionType: '会议', sourceMessageIds: ['m1'] }])
  })

  it('来源引用容错：编号 / 包裹写法 / 直接标识均可还原为来源消息', () => {
    const messages = [message('m1', 'g1', 1), message('m2', 'g1', 2)]
    expect(resolveItemSourceIds({ sourceRefs: ['1'] }, messages)).toEqual(['m1'])
    expect(resolveItemSourceIds({ sourceRefs: ['【消息 2】'] }, messages)).toEqual(['m2'])
    expect(resolveItemSourceIds({ sourceRefs: ['m2'] }, messages)).toEqual(['m2'])
    expect(resolveItemSourceIds({ source_refs: ['1', '2'] }, messages)).toEqual(['m1', 'm2'])
  })

  it('条目标识 = 内容哈希：重放一致、来源顺序无关、群 / 类型敏感（写入幂等键）', () => {
    const base = buildEntryId('g1', '会议', ['m2', 'm1'])
    expect(buildEntryId('g1', '会议', ['m1', 'm2'])).toBe(base)
    expect(buildEntryId('g2', '会议', ['m1', 'm2'])).not.toBe(base)
    expect(buildEntryId('g1', '缴费', ['m1', 'm2'])).not.toBe(base)
  })

  it('任务引用取自失败信封的 scope（task:<ref>；未知来源返回 null）', () => {
    expect(taskRefOf({ code: 'ANALYSIS_FAILED', message: 'x', retryable: true, scope: 'task:ref-9' })).toBe('ref-9')
    expect(taskRefOf({ code: 'TIMEOUT', message: 'x', retryable: true, scope: 'other:1' })).toBeNull()
  })
})

describe('输入单元（§4；图片 / 表情包不参与关键词匹配）', () => {
  it('文字消息原样；图片 / 表情包用类型标记占位；无文本兜底', () => {
    const image: RawMessage = { ...message('m2', 'g1', 2, null), kind: '图片' }
    const sticker: RawMessage = { ...message('m3', 'g1', 3, null), kind: '表情包' }
    expect(messageUnitText(message('m1', 'g1', 1, '缴费通知'))).toBe('缴费通知')
    expect(messageUnitText(image)).toBe('[图片]')
    expect(messageUnitText(sticker)).toBe('[表情包]')
    expect(messageUnitText(message('m4', 'g1', 4, null))).toBe('[无文本]')
    expect(toUnits([message('m1', 'g1', 1, '缴费通知')])).toEqual([{ id: 'm1', text: '缴费通知' }])
  })
})

describe('要素提取（§5.1；缺项留空、不填猜测值）', () => {
  const context = {
    groupId: 'g1',
    recognitionType: '会议',
    sourceMessageIds: ['m1'],
    members: new MemberNameIndex([member('mem-1', 'g1', '张三'), member('mem-2', 'g1', '李四')]),
  } satisfies Parameters<typeof parseExtractedDraft>[1]

  it('齐全映射：时间 / 地点 / 人物 / 事项 / DDL 与两个总结字段', () => {
    const draft = parseExtractedDraft(
      {
        timeElement: '2026-09-12T10:00:00Z',
        locationElement: '三号会议室',
        personElement: ['张三', '无名氏'],
        subjectElement: '讨论发布计划',
        deadline: 1_800_000_000_000,
        headline: '明天开评审会',
        aiSummary: '会议讨论发布计划与分工。',
        priority: '高',
      },
      context,
    )
    expect(draft).not.toBeNull()
    expect(draft?.entryId).toBe(buildEntryId('g1', '会议', ['m1']))
    expect(draft).toMatchObject({
      timeElement: Date.parse('2026-09-12T10:00:00Z'),
      locationElement: '三号会议室',
      personElementMemberIds: ['mem-1'], // 无名氏映射不上 → 不塞 id（人名留在事项文本）
      subjectElement: '讨论发布计划',
      deadline: 1_800_000_000_000,
      headline: '明天开评审会',
      aiSummary: '会议讨论发布计划与分工。',
      priority: '高',
    })
  })

  it('缺项留空、不填猜测值；优先级不可判定取「中」', () => {
    const draft = parseExtractedDraft({ headline: 'h', aiSummary: 's' }, context)
    expect(draft).toMatchObject({
      timeElement: null,
      locationElement: null,
      personElementMemberIds: [],
      subjectElement: null,
      deadline: null,
      priority: '中',
    })
  })

  it('必填缺失（headline / aiSummary）→ null，不产出半成品', () => {
    expect(parseExtractedDraft({ aiSummary: 's' }, context)).toBeNull()
    expect(parseExtractedDraft({ headline: 'h' }, context)).toBeNull()
    expect(parseExtractedDraft({}, context)).toBeNull()
  })

  it('人物要素：唯一命中映射成员引用；同名多候选 / 无候选不落 id', () => {
    const members = new MemberNameIndex([
      member('mem-1', 'g1', '张三'),
      member('mem-2', 'g1', '张三'),
      member('mem-3', 'g1', '王五'),
    ])
    expect(members.resolve('张三')).toBeNull()
    expect(members.resolve('王五')).toBe('mem-3')
    expect(members.resolve('查无此人')).toBeNull()
    expect(members.resolveAll(['王五', '王五', '张三'])).toEqual(['mem-3'])
  })

  it('优先级严格三档闭集：闭集内原样，越界 / 非字符串取「中」（§8 决策 7）', () => {
    expect(normalizePriority('高')).toBe('高')
    expect(normalizePriority('中')).toBe('中')
    expect(normalizePriority('低')).toBe('低')
    expect(normalizePriority('紧急')).toBe('中')
    expect(normalizePriority('')).toBe('中')
    expect(normalizePriority(undefined)).toBe('中')
    expect(normalizePriority(4)).toBe('中')
  })

  it('时间解析：epoch 毫秒 / 数字串 / ISO 文本；不可解析留空', () => {
    expect(parseTimestamp(1_726_000_000_000)).toBe(1_726_000_000_000)
    expect(parseTimestamp('1726000000000')).toBe(1_726_000_000_000)
    expect(parseTimestamp('2026-09-12T10:00:00Z')).toBe(Date.parse('2026-09-12T10:00:00Z'))
    // 区间外的数字不是有效时间（如年份「2026」、旧版测试里的 123）：不猜 → null
    expect(parseTimestamp(123.7)).toBeNull()
    expect(parseTimestamp('2026')).toBeNull()
    expect(parseTimestamp(2026)).toBeNull()
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('不是时间')).toBeNull()
    expect(parseTimestamp(null)).toBeNull()
  })

  it('无年份日期按来源消息时间就近补年（修复 Date.parse 的 2001 回退）', () => {
    const context = new Date(2026, 8, 6, 12, 0).getTime()
    expect(parseTimestamp('09-24', context)).toBe(new Date(2026, 8, 24).getTime())
    expect(parseTimestamp('10.15', context)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseTimestamp('9月24日 18:30', context)).toBe(new Date(2026, 8, 24, 18, 30).getTime())
    // 跨年方向：1 月消息提到的「12-25」应补到上一年
    expect(parseTimestamp('12-25', new Date(2026, 0, 5, 12, 0).getTime())).toBe(new Date(2025, 11, 25).getTime())
    // 非法日期（2 月 30 日）与无上下文时不解析（不猜）
    expect(parseTimestamp('02-30', context)).toBeNull()
    expect(parseTimestamp('09-24')).toBeNull()
  })
})
