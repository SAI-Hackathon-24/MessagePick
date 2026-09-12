/**
 * 批次管线（mod-006 §7「并发与存储」「失败路径」等行；§3.4、§5.2、§5.3、§8 决策 1 / 2；TASK-018）：
 *
 * - 窗口 → 识别 → 抽取 → 聚类 → 落库的完整链路（模型与存储全部替身，不真调、不真开库）；
 * - 失败落在分项（含任务引用），已产出照常可用；`retry` 分项重试后更新（`API-008` 口径）；
 * - 聚类失败 = 本批不落库（决策 2）；重放同一窗口不产生重复条目（内容哈希幂等）；
 * - 批锁：运行中的新触发顺延到下一批，只保留最新一次（§3.4、§5.3）。
 */

import { describe, expect, it } from 'vitest'

import type { TaskResultItem } from '@shared'

import {
  ExtractPipeline,
  chunkUnits,
  groupMessages,
  sortBySentAt,
  statusOf,
  toItem,
} from '../pipeline/extract-pipeline'
import { buildEntryId } from '../pipeline/recognition'
import type { ExtractWindow } from '../pipeline/watermark'
import { EntryRepository } from '../store/entry-repository'
import {
  DAY_MS,
  NOW,
  FakeStore,
  ScriptedGateway,
  deferred,
  entry,
  extractedDraft,
  failureOutcome,
  fixedClock,
  member,
  message,
  okOutcome,
  unitIdsOf,
} from './harness'

const WINDOW: ExtractWindow = { from: 0, to: NOW }
const RECOGNIZED: TaskResultItem = { recognitionType: '会议', sourceRefs: ['1'] }
const EXTRACTED: TaskResultItem = {
  headline: '明天开评审会',
  aiSummary: '讨论发布计划',
  priority: '高',
  deadline: NOW + DAY_MS / 2,
}
const CLUSTERED: TaskResultItem = { topic: '会议安排', sourceRefs: ['1', '2'] }

function pipelineOf(store: FakeStore, gateway: ScriptedGateway): ExtractPipeline {
  return new ExtractPipeline({ repository: new EntryRepository(store), gateway, clock: fixedClock() })
}

describe('批次执行（§5.3）', () => {
  it('窗口 → 识别 → 抽取 → 聚类 → 落库：按群分片，计数与终态正确', async () => {
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000), message('m2', 'g2', 2000)] })
    const gateway = new ScriptedGateway({
      识别: () => okOutcome([RECOGNIZED]),
      抽取: () => okOutcome([EXTRACTED]),
      聚类: () => okOutcome([CLUSTERED]),
    })
    const pipeline = pipelineOf(store, gateway)

    const result = await pipeline.run(WINDOW)

    expect(result.status).toBe('succeeded')
    expect(result.failures).toEqual([])
    expect(result.counts).toEqual({ groups: 2, messages: 2, recognized: 2, extracted: 2, written: 2, failedTasks: 0 })
    expect(pipeline.lastWindow()).toEqual(WINDOW)
    expect(store.writeCalls).toEqual([{ type: 'DM-010', count: 2 }])
    expect(gateway.requestsOf('识别').map(unitIdsOf)).toEqual([['m1'], ['m2']])

    const byId = new Map(store.entries.map((item) => [item.entryId, item]))
    expect([...byId.keys()].sort()).toEqual(
      [buildEntryId('g1', '会议', ['m1']), buildEntryId('g2', '会议', ['m2'])].sort(),
    )
    expect(byId.get(buildEntryId('g1', '会议', ['m1']))?.sourceMessageIds).toEqual(['m1'])
    expect(byId.get(buildEntryId('g2', '会议', ['m2']))?.sourceMessageIds).toEqual(['m2'])
    for (const item of store.entries) {
      expect(item.topic).toBe('会议安排')
      expect(item.priority).toBe('高')
      expect(item.todoStatus).toBe('未处理')
      expect(item.remindState).toBe('待提醒') // DDL = NOW + 12h ≤ 1 天（§5.1）
    }
  })

  it('重放同一窗口：条目标识幂等，不产生重复条目（§5.1；决策 1）', async () => {
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000), message('m2', 'g2', 2000)] })
    const gateway = new ScriptedGateway({
      识别: () => okOutcome([RECOGNIZED]),
      抽取: () => okOutcome([EXTRACTED]),
      聚类: () => okOutcome([CLUSTERED]),
    })
    const pipeline = pipelineOf(store, gateway)

    await pipeline.run(WINDOW)
    const replay = await pipeline.run(WINDOW)

    expect(replay.status).toBe('succeeded')
    expect(store.entries).toHaveLength(2) // 重叠窗口的重复由记录身份吸收
    expect(replay.counts.written).toBe(0) // 二次写入全部按身份去重
  })

  it('窗口内无消息：succeeded 且不触发任何模型任务', async () => {
    const store = new FakeStore()
    const gateway = new ScriptedGateway({})
    const result = await pipelineOf(store, gateway).run(WINDOW)
    expect(result).toMatchObject({ status: 'succeeded', failures: [] })
    expect(result.counts).toMatchObject({ messages: 0, recognized: 0, written: 0 })
    expect(gateway.executeCalls).toHaveLength(0)
  })

  it('人物要素映射到成员引用：能映射的落 id，映射不上的不落（§5.1）', async () => {
    const store = new FakeStore({
      messages: [message('m1', 'g1', 1000)],
      members: [member('mem-1', 'g1', '张三')],
    })
    const gateway = new ScriptedGateway({
      识别: () => okOutcome([RECOGNIZED]),
      抽取: () => okOutcome([{ ...EXTRACTED, personElement: ['张三', '无名氏'] }]),
      聚类: () => okOutcome([{ topic: '会议安排', sourceRefs: ['1'] }]),
    })
    await pipelineOf(store, gateway).run(WINDOW)
    expect(store.entries[0]?.personElementMemberIds).toEqual(['mem-1'])
  })
})

describe('失败路径与分项重试（§4、§6；AC-091）', () => {
  it('识别任务失败：分项含任务引用、批次 failed；经 API-008 重试后更新', async () => {
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000)] })
    let failed = false
    const gateway = new ScriptedGateway({
      识别: () => {
        if (!failed) {
          failed = true
          return failureOutcome('ref-recognize')
        }
        return okOutcome([RECOGNIZED])
      },
      抽取: () => okOutcome([EXTRACTED]),
      聚类: () => okOutcome([{ topic: '会议安排', sourceRefs: ['1'] }]),
      retry: () => okOutcome([RECOGNIZED]),
    })
    const pipeline = pipelineOf(store, gateway)

    const first = await pipeline.run(WINDOW)
    expect(first.status).toBe('failed')
    expect(first.failures).toEqual([
      { group: 'g1', code: 'ANALYSIS_FAILED', taskRef: 'ref-recognize', reason: '任务失败（ref-recognize）' },
    ])
    expect(store.entries).toHaveLength(0)

    const retried = await pipeline.retry('ref-recognize')
    expect(gateway.retryCalls).toEqual(['ref-recognize'])
    expect(retried.status).toBe('succeeded')
    expect(retried.counts).toMatchObject({ recognized: 1, extracted: 1, written: 1, failedTasks: 0 })
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0]).toMatchObject({
      entryId: buildEntryId('g1', '会议', ['m1']),
      topic: '会议安排',
      headline: '明天开评审会',
      sourceMessageIds: ['m1'],
    })
  })

  it('抽取单条失败不影响同组其余条目：分项失败 + 其余照常落库（partial）', async () => {
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000), message('m2', 'g1', 2000)] })
    const gateway = new ScriptedGateway({
      识别: () =>
        okOutcome([
          { recognitionType: '会议', sourceRefs: ['1'] },
          { recognitionType: '缴费', sourceRefs: ['2'] },
        ]),
      抽取: (request) => (unitIdsOf(request)[0] === 'm1' ? failureOutcome('ref-extract') : okOutcome([EXTRACTED])),
      聚类: () => okOutcome([{ topic: '会议安排', sourceRefs: ['1'] }]),
    })

    const result = await pipelineOf(store, gateway).run(WINDOW)

    expect(result.status).toBe('partial')
    expect(result.counts).toMatchObject({ recognized: 2, extracted: 1, written: 1, failedTasks: 1 })
    expect(result.failures[0]).toMatchObject({ group: 'g1', code: 'ANALYSIS_FAILED', taskRef: 'ref-extract' })
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0]?.sourceMessageIds).toEqual(['m2'])
  })

  it('抽取结果缺必填字段：记 ANALYSIS_FAILED、不落半成品（批次按「有产出」口径记 partial）', async () => {
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000)] })
    const gateway = new ScriptedGateway({
      识别: () => okOutcome([RECOGNIZED]),
      抽取: () => okOutcome([{ headline: '只有标题' }]), // 缺 aiSummary
      聚类: () => okOutcome([{ topic: '会议安排', sourceRefs: ['1'] }]),
    })

    const result = await pipelineOf(store, gateway).run(WINDOW)
    expect(result.status).toBe('partial') // 识别已产出（recognized > 0）→ 不是「全失败」
    expect(result.failures[0]).toMatchObject({
      group: 'g1',
      code: 'ANALYSIS_FAILED',
      reason: '抽取结果缺少必填字段（headline / aiSummary）',
    })
    expect(store.entries).toHaveLength(0)
  })

  it('聚类失败 = 本批不落库（决策 2）：产出保留在分项里，主题非空约束不可绕', async () => {
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000)] })
    const gateway = new ScriptedGateway({
      识别: () => okOutcome([RECOGNIZED]),
      抽取: () => okOutcome([EXTRACTED]),
      聚类: () => failureOutcome('ref-cluster'),
    })

    const result = await pipelineOf(store, gateway).run(WINDOW)

    expect(result.status).toBe('partial')
    expect(result.counts).toMatchObject({ extracted: 1, written: 0, failedTasks: 1 })
    expect(result.failures[0]).toMatchObject({ group: '', code: 'ANALYSIS_FAILED', taskRef: 'ref-cluster' })
    expect(store.entries).toHaveLength(0)
  })

  it('聚类请求注入既有主题名清单；批次重跑不改写既有条目的主题（决策 2）', async () => {
    const existing = entry({ entryId: 'entry-old', groupId: 'g1', topic: '人工改过的主题', sourceMessageIds: ['m0'] })
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000)], entries: [existing] })
    const gateway = new ScriptedGateway({
      识别: () => okOutcome([RECOGNIZED]),
      抽取: () => okOutcome([EXTRACTED]),
      聚类: () => okOutcome([{ topic: '新主题名', sourceRefs: ['1'] }]),
    })

    await pipelineOf(store, gateway).run(WINDOW)

    const instruction = gateway.requestsOf('聚类')[0]?.params.instruction
    expect(instruction).toContain('人工改过的主题')
    expect(instruction).toContain('优先复用')
    expect(store.entries).toHaveLength(2)
    expect(store.entries.find((item) => item.entryId === 'entry-old')?.topic).toBe('人工改过的主题')
    expect(store.entries.find((item) => item.entryId !== 'entry-old')?.topic).toBe('新主题名')
  })
})

describe('批锁与顺延（§3.4、§5.3）', () => {
  it('运行中的新触发顺延到下一批（只保留最新一次）；两批串行各自完整执行', async () => {
    const gate = deferred<void>()
    let first = true
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000), message('m2', 'g2', 2000)] })
    const gateway = new ScriptedGateway({
      识别: async () => {
        if (first) {
          first = false
          await gate.promise
        }
        return okOutcome([RECOGNIZED])
      },
      抽取: () => okOutcome([EXTRACTED]),
      聚类: () => okOutcome([CLUSTERED]),
    })
    const pipeline = pipelineOf(store, gateway)

    const running = pipeline.run({ from: 0, to: 1500 })
    const deferredRun = pipeline.run({ from: 1500, to: 3000 })
    gate.resolve()
    const [firstResult, secondResult] = await Promise.all([running, deferredRun])

    expect(firstResult.window).toEqual({ from: 0, to: 1500 })
    expect(secondResult.window).toEqual({ from: 1500, to: 3000 })
    expect(firstResult.status).toBe('succeeded')
    expect(secondResult.status).toBe('succeeded')
    // 第一批完全结束（识别 → 抽取 → 聚类）后才开始第二批 → 无交错
    expect(gateway.executeCalls.map((call) => call.taskType)).toEqual([
      '识别',
      '抽取',
      '聚类',
      '识别',
      '抽取',
      '聚类',
    ])
    expect(gateway.requestsOf('识别').map(unitIdsOf)).toEqual([['m1'], ['m2']])
    expect(store.entries).toHaveLength(2)
  })
})

describe('管线纯函数（导出供单测与复用）', () => {
  it('groupMessages：按来源群分组、保持原顺序', () => {
    const grouped = groupMessages([message('m1', 'g1', 1), message('m2', 'g2', 2), message('m3', 'g1', 3)])
    expect([...grouped.keys()]).toEqual(['g1', 'g2'])
    expect(grouped.get('g1')?.map((item) => item.messageId)).toEqual(['m1', 'm3'])
  })

  it('sortBySentAt：按发送时间升序，同值按消息标识稳定', () => {
    const sorted = sortBySentAt([message('m3', 'g1', 2), message('m1', 'g1', 1), message('m2', 'g2', 1)])
    expect(sorted.map((item) => item.messageId)).toEqual(['m1', 'm2', 'm3'])
  })

  it('chunkUnits：按上限切片、保持顺序', () => {
    expect(chunkUnits(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  it('toItem：草稿 + 主题 → DM-010；提醒状态随写入重算（§5.1）', () => {
    const near = toItem(extractedDraft('entry_e1', { deadline: NOW + DAY_MS / 2 }), '会议安排', NOW)
    expect(near).toMatchObject({
      entryId: 'entry_e1',
      topic: '会议安排',
      todoStatus: '未处理',
      remindState: '待提醒',
      personElementMemberIds: null, // 空数组 → null（未提取到为空）
    })
    expect(toItem(extractedDraft('entry_e2', { deadline: NOW + 3 * DAY_MS }), '会议安排', NOW).remindState).toBe('不提醒')
    expect(toItem(extractedDraft('entry_e3'), '会议安排', NOW).remindState).toBe('不提醒')
  })

  it('statusOf：无失败 = succeeded；有产出 = partial；全失败 = failed', () => {
    expect(
      statusOf({ groups: 1, messages: 2, recognized: 2, extracted: 2, written: 2, failedTasks: 0 }, []),
    ).toBe('succeeded')
    expect(
      statusOf(
        { groups: 1, messages: 2, recognized: 1, extracted: 0, written: 0, failedTasks: 1 },
        [{ group: 'g1', code: 'ANALYSIS_FAILED', taskRef: null }],
      ),
    ).toBe('partial')
    expect(
      statusOf(
        { groups: 1, messages: 1, recognized: 0, extracted: 0, written: 0, failedTasks: 1 },
        [{ group: 'g1', code: 'ANALYSIS_FAILED', taskRef: null }],
      ),
    ).toBe('failed')
  })
})
