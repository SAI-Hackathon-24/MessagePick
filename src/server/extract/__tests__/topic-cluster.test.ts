/**
 * 主题聚类与命名（mod-006 §7「归档与主题」行；§4、§8 决策 2；TASK-019）：
 *
 * - 聚类参数注入「既有主题名清单」（跨批复用、命名趋同）与粒度（3~12 主题 / 2~6 字主题名）；
 * - 主题名非法即丢弃（由兜底主题保「主题非空」）；未覆盖条目给兜底主题；
 * - 单次调用超限分片（对齐 MOD-003 聚类不可分块上限）；
 * - 聚类只作用于本批新条目：既有条目的改写唯一途径是 `API-016`（管线侧测试见 `pipeline.test.ts`）。
 */

import { describe, expect, it } from 'vitest'

import {
  CLUSTER_CALL_MAX_CHARS,
  CLUSTER_CALL_MAX_UNITS,
  FALLBACK_TOPIC,
  TOPIC_MAX_CHARS,
  TOPIC_MIN_CHARS,
} from '../constants'
import {
  assignTopics,
  buildClusterRequest,
  clusterInstruction,
  clusterUnits,
  distinctTopics,
  parseClusterAssignments,
  sliceClusterCalls,
} from '../pipeline/topic-cluster'
import { extractedDraft } from './harness'

describe('聚类参数（§8 决策 2）', () => {
  it('既有主题名清单注入任务说明（优先复用，不另造近义词）', () => {
    const instruction = clusterInstruction(['会议', '缴费'])
    expect(instruction).toContain('会议、缴费')
    expect(instruction).toContain('优先复用')
    expect(clusterInstruction([])).toContain('当前没有既有主题。')
  })

  it('粒度参数：同批 3~12 个主题、主题名 2~6 字（闭集来自 constants）', () => {
    const instruction = clusterInstruction([])
    expect(instruction).toContain('3~12')
    expect(instruction).toContain(`${TOPIC_MIN_CHARS}~${TOPIC_MAX_CHARS} 个汉字`)
    const request = buildClusterRequest([{ entryId: 'e1', text: 't' }], [])
    expect(request.taskType).toBe('聚类')
    expect(request.params.options).toMatchObject({
      minTopics: 3,
      maxTopics: 12,
      topicNameLength: [TOPIC_MIN_CHARS, TOPIC_MAX_CHARS],
      reuseExisting: true,
    })
  })

  it('聚类单元 = 一句话总结 + 事项要素；无事项时只给总结', () => {
    expect(clusterUnits([extractedDraft('e1', { headline: '开会', subjectElement: '讨论排期' })])).toEqual([
      { entryId: 'e1', text: '开会\n讨论排期' },
    ])
    expect(clusterUnits([extractedDraft('e2', { headline: '缴费' })])).toEqual([{ entryId: 'e2', text: '缴费' }])
  })
})

describe('结果校验与兜底（§4；主题非空）', () => {
  it('结果按来源引用还原条目 → 主题；非法主题名（超长 / 过短）丢弃', () => {
    const slice = [
      { entryId: 'e1', text: 'a' },
      { entryId: 'e2', text: 'b' },
      { entryId: 'e3', text: 'c' },
    ]
    const assignment = parseClusterAssignments(
      [
        { topic: '会议', sourceRefs: ['1'] },
        { topic: '这是一个超长的主题名', sourceRefs: ['2'] },
        { topic: '忙', sourceRefs: ['3'] },
      ],
      slice,
    )
    expect([...assignment.entries()]).toEqual([['e1', '会议']])
  })

  it('分片结果合并：先到先得；未覆盖条目给兜底主题（保证非空）', () => {
    const topics = assignTopics(
      ['e1', 'e2', 'e3'],
      [new Map([['e1', '会议']]), new Map([['e2', '缴费']])],
    )
    expect(topics.get('e1')).toBe('会议')
    expect(topics.get('e2')).toBe('缴费')
    expect(topics.get('e3')).toBe(FALLBACK_TOPIC)
  })

  it('既有主题名清单：去重 + 稳定排序 + 过滤空白', () => {
    expect(distinctTopics(['缴费', '会议', '缴费', '  '])).toEqual(['会议', '缴费'])
  })
})

describe('调用分片（§3.3 上限；聚类不可分块）', () => {
  it('按单元数分片（200 单元/次）', () => {
    const units = Array.from({ length: CLUSTER_CALL_MAX_UNITS + 1 }, (_, index) => ({
      entryId: `e${index}`,
      text: 't',
    }))
    expect(sliceClusterCalls(units).map((slice) => slice.length)).toEqual([CLUSTER_CALL_MAX_UNITS, 1])
  })

  it('按字符数分片（120 K 字/次）；单个超限单元独占一片', () => {
    const long = [
      { entryId: 'a', text: 'x'.repeat(CLUSTER_CALL_MAX_CHARS) },
      { entryId: 'b', text: 'y'.repeat(10) },
    ]
    expect(sliceClusterCalls(long).map((slice) => slice.length)).toEqual([1, 1])
    expect(sliceClusterCalls([{ entryId: 'c', text: 'z'.repeat(CLUSTER_CALL_MAX_CHARS + 1) }])).toHaveLength(1)
  })
})
