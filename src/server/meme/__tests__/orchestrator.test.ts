/**
 * MOD-005 §7「app/AnalysisOrchestrator」测试面（mock `API-007` / `API-008`）：
 *
 * 分项拆分（识别按窗口 / 变体 / 精华）与批次汇总（succeeded / partial / failed）、
 * 失败分项经 `API-008` 自动重试与手动重试后落库、输出越界不落库（§6）、
 * 重复触发按「读库查缺块」判定、我相关并集口径落库、派生重算与退避。
 */

import { describe, expect, it } from 'vitest'
import type { TaskResultItem } from '@shared'

import { MemeError } from '../app/errors'
import {
  AnalysisOrchestrator,
  backoffDelay,
  deriveFromOccurrences,
  type BatchHandle,
  type TaskItem,
} from '../app/orchestrator'
import {
  FakeGateway,
  createStore,
  daysBefore,
  failOutcome,
  makeDeps,
  makeHighlight,
  makeMember,
  makeMessage,
  makeOccurrence,
  makeMeme,
  NOW_MS,
  okOutcome,
  rejectionOf,
  type FakeStore,
} from './harness'

const GROUP = 'g1'

/** 批次句柄 → 内部计划项（手动重试入口需要 `TaskItem`）。 */
function taskItemsOf(handle: BatchHandle): TaskItem[] {
  return (handle as unknown as { taskItems: TaskItem[] }).taskItems
}

function seedTextMessages(port: FakeStore, entries: Array<{ id: string; at: number; sender?: string; text?: string }>): void {
  for (const entry of entries) {
    port.seed('DM-003', [
      makeMessage({
        messageId: entry.id,
        groupId: GROUP,
        senderMemberId: entry.sender ?? 'u_a',
        sentAt: entry.at,
        ...(entry.text === undefined ? {} : { text: entry.text }),
      }),
    ])
  }
}

function recognitionItem(name: string, sourceRefs: string[]): TaskResultItem {
  return { name, kind: '口头禅', interpretation: `${name}：什么意思 / 从哪来 / 现在怎么用`, sourceRefs }
}

describe('MOD-005 Orchestrator：识别分项与落库（§3.5 状态机 A）', () => {
  it('按窗口切分识别分项；成功后一次写入梗 + 出现记录（含我相关并集口径）', async () => {
    const { port, store } = createStore()
    port.seed('DM-004', [makeMember({ memberId: 'u_me', groupId: GROUP, isMe: true })])
    seedTextMessages(port, [
      { id: 'm1', at: daysBefore(3), text: 'yyds 真香' },
      { id: 'm2', at: daysBefore(2), sender: 'u_me', text: '确实' },
    ])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [recognitionItem('yyds', ['m1', 'm2'])]))
    const orchestrator = new AnalysisOrchestrator(makeDeps(store, { gateway }))

    const result = await orchestrator.startBatch('ingestDone', {}).done
    expect(result.status).toBe('succeeded')
    expect(result.items.map((item) => [item.kind, item.status, item.written])).toEqual([['识别', 'succeeded', 3]])
    expect(gateway.executions).toHaveLength(1)
    expect(gateway.executions[0]?.taskType).toBe('识别')
    expect(gateway.executions[0]?.input).toEqual({
      kind: '消息集合',
      units: [
        { id: 'm1', text: 'yyds 真香' },
        { id: 'm2', text: '确实' },
      ],
    })

    const meme = port.all('DM-006')[0]
    expect(meme).toMatchObject({
      name: 'yyds',
      kind: '口头禅',
      correction: '无',
      occurrenceCount: 2,
      firstSeenAt: daysBefore(3),
      lastUsedAt: daysBefore(2),
    })
    expect(meme?.monthlyCounts).toEqual({ '2026-09': 2 })
    expect(meme?.lifecycle.peakMonth).toBe('2026-09')
    expect(meme?.memeKing).toEqual([
      { memberId: 'u_a', count: 1, share: 0.5 },
      { memberId: 'u_me', count: 1, share: 0.5 },
    ])
    expect(port.all('DM-007').map((occurrence) => [occurrence.sourceMessageId, occurrence.mineRelated])).toEqual([
      ['m1', false],
      ['m2', true],
    ])
  })

  it('我相关并集：发送者为「我」或提及成员含「我」→ true，都不是 → false', async () => {
    const { port, store } = createStore()
    port.seed('DM-004', [makeMember({ memberId: 'u_me', groupId: GROUP, isMe: true })])
    port.seed('DM-003', [
      makeMessage({ messageId: 'm1', groupId: GROUP, senderMemberId: 'u_b', sentAt: daysBefore(3), mentionedMemberIds: ['u_me'] }),
      makeMessage({ messageId: 'm2', groupId: GROUP, senderMemberId: 'u_me', sentAt: daysBefore(2) }),
      makeMessage({ messageId: 'm3', groupId: GROUP, senderMemberId: 'u_b', sentAt: daysBefore(1) }),
    ])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [recognitionItem('M', ['m1', 'm2', 'm3'])]))
    await new AnalysisOrchestrator(makeDeps(store, { gateway })).startBatch('ingestDone').done

    expect(port.all('DM-007').map((occurrence) => [occurrence.sourceMessageId, occurrence.mineRelated])).toEqual([
      ['m1', true],
      ['m2', true],
      ['m3', false],
    ])
  })

  it('识别窗口拆分：窗口上限 1 时两条消息 → 两个分项', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [
      { id: 'm1', at: daysBefore(3) },
      { id: 'm2', at: daysBefore(2) },
    ])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [recognitionItem('A', ['m1'])]))
    gateway.executeQueue.push(okOutcome('t2', [recognitionItem('B', ['m2'])]))
    const orchestrator = new AnalysisOrchestrator(makeDeps(store, { gateway, limits: { recognizeWindowMessages: 1 } }))
    const result = await orchestrator.startBatch('ingestDone').done
    expect(result.status).toBe('succeeded')
    expect(result.items).toHaveLength(2)
    expect(gateway.executions.map((request) => request.input)).toEqual([
      { kind: '消息集合', units: [{ id: 'm1', text: '消息 m1' }] },
      { kind: '消息集合', units: [{ id: 'm2', text: '消息 m2' }] },
    ])
    expect(port.all('DM-006')).toHaveLength(2)
  })
})

describe('MOD-005 Orchestrator：失败、partial 与重试（§3.5 / §6）', () => {
  it('部分分项失败 → partial；失败分项保留 taskRef 与错误信封', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [
      { id: 'm1', at: daysBefore(3) },
      { id: 'm2', at: daysBefore(2) },
    ])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [recognitionItem('A', ['m1'])]))
    gateway.executeQueue.push(failOutcome('ANALYSIS_FAILED', 'r2'))
    gateway.retryQueue.push(failOutcome('ANALYSIS_FAILED', 'r2'))
    const orchestrator = new AnalysisOrchestrator(
      makeDeps(store, { gateway, limits: { recognizeWindowMessages: 1 }, retry: { maxAttempts: 1 } }),
    )
    const result = await orchestrator.startBatch('ingestDone').done

    expect(result.status).toBe('partial')
    expect(result.items[0]?.status).toBe('succeeded')
    expect(result.items[1]?.status).toBe('failed')
    expect(result.items[1]?.taskRef).toBe('r2')
    expect(result.items[1]?.error).toMatchObject({ code: 'ANALYSIS_FAILED', retryable: true })
    expect(gateway.retries).toEqual(['r2'])
    expect(port.all('DM-006')).toHaveLength(1)
  })

  it('失败分项经 API-008 重试后落库（退避 1s → 2s，最多 maxAttempts 次）', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [
      { id: 'm1', at: daysBefore(3) },
      { id: 'm2', at: daysBefore(2) },
    ])
    const sleeps: number[] = []
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [recognitionItem('A', ['m1'])]))
    gateway.executeQueue.push(failOutcome('ANALYSIS_FAILED', 'r2'))
    gateway.retryQueue.push(failOutcome('ANALYSIS_FAILED', 'r2'))
    gateway.retryQueue.push(okOutcome('r2', [recognitionItem('B', ['m2'])]))
    const orchestrator = new AnalysisOrchestrator(
      makeDeps(store, {
        gateway,
        limits: { recognizeWindowMessages: 1 },
        retry: {
          maxAttempts: 3,
          random: () => 0.5,
          sleep: async (ms) => {
            sleeps.push(ms)
          },
        },
      }),
    )
    const result = await orchestrator.startBatch('ingestDone').done

    expect(result.status).toBe('succeeded')
    expect(gateway.retries).toEqual(['r2', 'r2'])
    expect(sleeps).toEqual([1_000, 2_000])
    expect(result.items[1]?.written).toBe(2)
    expect(port.all('DM-006').map((meme) => meme.name)).toEqual(['A', 'B'])
  })

  it('自动重试耗尽 → failed，TIMEOUT 映射保留 taskRef', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [{ id: 'm1', at: daysBefore(3) }])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(failOutcome('TIMEOUT', 'r1'))
    for (let index = 0; index < 3; index += 1) gateway.retryQueue.push(failOutcome('TIMEOUT', 'r1'))
    const orchestrator = new AnalysisOrchestrator(makeDeps(store, { gateway }))
    const result = await orchestrator.startBatch('ingestDone').done

    expect(result.status).toBe('failed')
    expect(result.items[0]?.error).toMatchObject({ code: 'TIMEOUT', retryable: true })
    expect(result.items[0]?.taskRef).toBe('r1')
    expect(gateway.retries).toHaveLength(3)
    expect(port.all('DM-006')).toHaveLength(0)
  })

  it('执行直接抛错：归入 ANALYSIS_FAILED（不新造标识）', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [{ id: 'm1', at: daysBefore(3) }])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(new Error('网络不可达'))
    const result = await new AnalysisOrchestrator(makeDeps(store, { gateway })).startBatch('ingestDone').done
    expect(result.items[0]?.error).toMatchObject({ code: 'ANALYSIS_FAILED', retryable: true })
  })

  it('手动重试入口：成功后落库；失败抛模块错误信封', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [{ id: 'm1', at: daysBefore(3) }])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(failOutcome('ANALYSIS_FAILED', 'r1'))
    for (let index = 0; index < 3; index += 1) gateway.retryQueue.push(failOutcome('ANALYSIS_FAILED', 'r1'))
    const orchestrator = new AnalysisOrchestrator(makeDeps(store, { gateway }))
    const handle = orchestrator.startBatch('manualRetry')
    await handle.done
    const item = taskItemsOf(handle)[0]

    gateway.retryQueue.push(okOutcome('r9', [recognitionItem('yyds', ['m1'])]))
    await orchestrator.retryItem(item, 'r1')
    expect(item.status).toBe('succeeded')
    expect(port.all('DM-006')).toHaveLength(1)

    gateway.retryQueue.push(failOutcome('TIMEOUT', 'r10'))
    const reason = await rejectionOf(orchestrator.retryItem(item, 'r10'))
    expect(reason).toBeInstanceOf(MemeError)
    expect((reason as MemeError).envelope.code).toBe('TIMEOUT')
    expect(item.status).toBe('failed')
  })
})

describe('MOD-005 Orchestrator：输出校验与不落库（§6）', () => {
  it('类型不在闭集：该分项失败且不写 DM-006', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [{ id: 'm1', at: daysBefore(3) }])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(
      okOutcome('t1', [{ name: 'x', kind: '禁忌梗', interpretation: '解读', sourceRefs: ['m1'] }]),
    )
    const result = await new AnalysisOrchestrator(makeDeps(store, { gateway })).startBatch('ingestDone').done

    expect(result.status).toBe('failed')
    expect(result.items[0]?.error).toMatchObject({ code: 'ANALYSIS_FAILED' })
    expect(result.items[0]?.error?.message).toContain('闭集')
    expect(port.writes.filter((call) => call.type === 'DM-006')).toEqual([])
    expect(port.all('DM-006')).toHaveLength(0)
  })

  it('来源引用不可回指：该分项失败且不落库', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [{ id: 'm1', at: daysBefore(3) }])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [{ name: 'x', kind: '口头禅', interpretation: '解读', sourceRefs: ['ghost'] }]))
    const result = await new AnalysisOrchestrator(makeDeps(store, { gateway })).startBatch('ingestDone').done
    expect(result.items[0]?.status).toBe('failed')
    expect(port.all('DM-006')).toHaveLength(0)
  })
})

describe('MOD-005 Orchestrator：变体分项（同群优先，不做跨群归并 AC-076）', () => {
  /** 两个已识别梗（同群）+ 出现水位 + 精华已覆盖，驱动变体分项。 */
  function seedTwoMemes(groupB: string): { port: FakeStore; store: ReturnType<typeof createStore>['store'] } {
    const { port, store } = createStore()
    port.seed('DM-006', [
      makeMeme({ memeId: 'mA', groupId: GROUP, name: 'A', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
      makeMeme({ memeId: 'mB', groupId: groupB, name: 'B', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
    ])
    port.seed('DM-003', [
      makeMessage({ messageId: 'msgA', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
      makeMessage({ messageId: 'msgB', groupId: groupB, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
    ])
    port.seed('DM-007', [
      makeOccurrence({ memeId: 'mA', sourceMessageId: 'msgA', occurredAt: daysBefore(2) }),
      makeOccurrence({ memeId: 'mB', sourceMessageId: 'msgB', occurredAt: daysBefore(2) }),
    ])
    port.seed('DM-009', [makeHighlight('mA', 'msgA', 1), makeHighlight('mB', 'msgB', 1)])
    return { port, store }
  }

  it('同群两梗 → 一个变体分项；聚类结果写 DM-008（代表 → 衍生）', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [
      makeMeme({ memeId: 'mA', groupId: GROUP, name: 'A', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
      makeMeme({ memeId: 'mB', groupId: GROUP, name: 'B', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
    ])
    port.seed('DM-003', [
      makeMessage({ messageId: 'msgA', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
      makeMessage({ messageId: 'msgB', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
    ])
    port.seed('DM-007', [
      makeOccurrence({ memeId: 'mA', sourceMessageId: 'msgA', occurredAt: daysBefore(2) }),
      makeOccurrence({ memeId: 'mB', sourceMessageId: 'msgB', occurredAt: daysBefore(2) }),
    ])
    port.seed('DM-009', [makeHighlight('mA', 'msgA', 1), makeHighlight('mB', 'msgB', 1)])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [{ representative: 'A', members: [1, 2] }]))
    const result = await new AnalysisOrchestrator(makeDeps(store, { gateway })).startBatch('ingestDone').done

    expect(result.items.map((item) => item.kind)).toEqual(['变体'])
    expect(gateway.executions[0]?.taskType).toBe('聚类')
    expect(port.all('DM-008')).toEqual([{ sourceMemeId: 'mA', derivedMemeId: 'mB', status: '生效' }])
  })

  it('两梗不同群：不产生跨群变体分项（无跨群自动合并路径）', async () => {
    const { port, store } = seedTwoMemes('g2')
    const gateway = new FakeGateway()
    const result = await new AnalysisOrchestrator(makeDeps(store, { gateway })).startBatch('ingestDone').done

    expect(result.status).toBe('succeeded')
    expect(result.items).toEqual([])
    expect(gateway.executions).toEqual([])
    expect(port.all('DM-008')).toEqual([])
  })
})

describe('MOD-005 Orchestrator：精华分项与重复触发缺块判定（§3.6）', () => {
  it('先识别 → 再精华 → 无缺块空批次；新增消息后重新出现识别分项', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [{ id: 'm1', at: daysBefore(3), text: 'yyds 真香' }])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [recognitionItem('yyds', ['m1'])]))
    const orchestrator = new AnalysisOrchestrator(makeDeps(store, { gateway }))

    const first = await orchestrator.startBatch('ingestDone').done
    expect(first.status).toBe('succeeded')
    expect(first.items.map((item) => item.kind)).toEqual(['识别'])

    // 第二触发：识别已过水位、变体不足两梗 → 只补精华缺块。
    gateway.executeQueue.push(okOutcome('t2', [{ sourceRefs: ['m1'] }]))
    const second = await orchestrator.startBatch('ingestDone').done
    expect(second.items.map((item) => item.kind)).toEqual(['精华'])
    expect(gateway.executions[1]?.taskType).toBe('抽取')
    const memeId = port.all('DM-006')[0]?.memeId
    expect(port.all('DM-009')).toEqual([{ memeId, sourceMessageId: 'm1', displayOrder: 1 }])

    // 第三触发：无缺块 → 空批次，不发起模型调用。
    const third = await orchestrator.startBatch('ingestDone').done
    expect(third.status).toBe('succeeded')
    expect(third.items).toEqual([])
    expect(gateway.executions).toHaveLength(2)

    // 新消息到达（晚于出现水位）→ 识别分项重新产生且只带新消息。
    seedTextMessages(port, [{ id: 'm2', at: daysBefore(1), text: '新消息' }])
    gateway.executeQueue.push(okOutcome('t3', [recognitionItem('yyds', ['m2'])]))
    const fourth = await orchestrator.startBatch('ingestDone').done
    expect(fourth.items.map((item) => item.kind)).toEqual(['识别'])
    expect(gateway.executions[2]?.input).toEqual({
      kind: '消息集合',
      units: [{ id: 'm2', text: '新消息' }],
    })
    expect(port.all('DM-007')).toHaveLength(2)
  })

  it('精华单批上限：essenceItemsPerBatchMax = 1 时只策划一个精华分项', async () => {
    const { port, store } = createStore()
    port.seed(
      'DM-006',
      Array.from({ length: 3 }, (_, index) =>
        makeMeme({ memeId: `m${index + 1}`, groupId: GROUP, name: `梗${index + 1}`, occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
      ),
    )
    port.seed('DM-003', [
      makeMessage({ messageId: 'msg1', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
      makeMessage({ messageId: 'msg2', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
      makeMessage({ messageId: 'msg3', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(2) }),
    ])
    port.seed('DM-007', [
      makeOccurrence({ memeId: 'm1', sourceMessageId: 'msg1', occurredAt: daysBefore(2) }),
      makeOccurrence({ memeId: 'm2', sourceMessageId: 'msg2', occurredAt: daysBefore(2) }),
      makeOccurrence({ memeId: 'm3', sourceMessageId: 'msg3', occurredAt: daysBefore(2) }),
    ])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [{ sourceRefs: ['msg1'] }]))
    const result = await new AnalysisOrchestrator(
      makeDeps(store, { gateway, limits: { essenceItemsPerBatchMax: 1 } }),
    ).startBatch('ingestDone').done
    expect(result.items.map((item) => item.kind)).toEqual(['精华'])
    expect(gateway.executions).toHaveLength(1)
    expect(port.all('DM-009')).toHaveLength(1)
  })

  it('在途批次防重复触发：重复调用返回同一句柄', async () => {
    const { port, store } = createStore()
    seedTextMessages(port, [{ id: 'm1', at: daysBefore(3) }])
    const gateway = new FakeGateway()
    gateway.executeQueue.push(okOutcome('t1', [recognitionItem('A', ['m1'])]))
    const orchestrator = new AnalysisOrchestrator(makeDeps(store, { gateway }))
    const first = orchestrator.startBatch('ingestDone')
    const second = orchestrator.startBatch('ingestDone')
    expect(second).toBe(first)
    await first.done
    expect(gateway.executions).toHaveLength(1)
  })
})

describe('MOD-005 Orchestrator：派生重算与退避（§5.2 / 详设 §2.3）', () => {
  it('deriveFromOccurrences：首现 / 最近 / 月度分布补 0 / 峰值 / 梗王 / 周环比', () => {
    const occurrences = [
      makeOccurrence({ memeId: 'm1', sourceMessageId: 'o1', occurredAt: daysBefore(40), speakerMemberId: 'u_a' }),
      makeOccurrence({ memeId: 'm1', sourceMessageId: 'o2', occurredAt: daysBefore(3), speakerMemberId: 'u_b' }),
      makeOccurrence({ memeId: 'm1', sourceMessageId: 'o3', occurredAt: daysBefore(2), speakerMemberId: 'u_b' }),
    ]
    const derived = deriveFromOccurrences(occurrences, GROUP, NOW_MS)
    expect(derived.firstSeenAt).toBe(daysBefore(40))
    expect(derived.lastUsedAt).toBe(daysBefore(2))
    expect(derived.occurrenceCount).toBe(3)
    expect(derived.monthlyCounts).toEqual({ '2026-08': 1, '2026-09': 2 })
    expect(derived.lifecycle.peakMonth).toBe('2026-09')
    expect(derived.memeKing).toEqual([
      { memberId: 'u_b', count: 2, share: 2 / 3 },
      { memberId: 'u_a', count: 1, share: 1 / 3 },
    ])
    // 上期 0、本期 2 → 零基「新增」哨兵。
    expect(derived.weekOverWeek).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('deriveFromOccurrences：空出现记录 → ANALYSIS_FAILED（不产生半成品）', () => {
    let caught: unknown = null
    try {
      deriveFromOccurrences([], GROUP, NOW_MS)
    } catch (reason) {
      caught = reason
    }
    expect(caught).toBeInstanceOf(MemeError)
    expect((caught as MemeError).envelope.code).toBe('ANALYSIS_FAILED')
  })

  it('backoffDelay：指数 1s → 2s → 4s、±20% 抖动、上限 30s', () => {
    const policy = { baseDelayMs: 1_000, maxDelayMs: 30_000, jitterRatio: 0.2 }
    expect(backoffDelay(1, { ...policy, random: () => 0.5 })).toBe(1_000)
    expect(backoffDelay(2, { ...policy, random: () => 0.5 })).toBe(2_000)
    expect(backoffDelay(3, { ...policy, random: () => 0.5 })).toBe(4_000)
    expect(backoffDelay(1, { ...policy, random: () => 0 })).toBe(800)
    expect(backoffDelay(1, { ...policy, random: () => 1 })).toBe(1_200)
    expect(backoffDelay(10, { ...policy, random: () => 0.5 })).toBe(30_000)
  })
})
