/**
 * MOD-005 §7「worker/aggregate」测试面：
 *
 * 纯聚合（root 归一化、不可见剔除、来源引用去重）、阈值选择执行体、
 * worker 崩溃 → 主线程分批降级、降级仍失败 → `ANALYSIS_FAILED`（§6）、批间让出。
 */

import { describe, expect, it } from 'vitest'

import { MemeError } from '../app/errors'
import {
  aggregateCounts,
  aggregateOccurrences,
  aggregateOnMainThread,
  type AggregateInput,
  type AggregateOutput,
} from '../worker/aggregate'
import { rejectionOf } from './harness'

function makeInput(count: number, rootOf: Record<string, string | null> = { A: 'R1' }): AggregateInput {
  return {
    occurrences: Array.from({ length: count }, (_, index) => ({
      memeId: index % 2 === 0 ? 'A' : 'B',
      sourceMessageId: `msg${index}`,
    })),
    rootOf,
  }
}

describe('MOD-005 aggregate：纯聚合', () => {
  it('按 root 计数、标记不可见（null）与未知映射剔除、来源消息去重保序', () => {
    const output = aggregateCounts({
      occurrences: [
        { memeId: 'A', sourceMessageId: 'm1' },
        { memeId: 'B', sourceMessageId: 'm1' },
        { memeId: 'A', sourceMessageId: 'm2' },
        { memeId: 'C', sourceMessageId: 'm3' },
        { memeId: 'ghost', sourceMessageId: 'm4' },
      ],
      rootOf: { A: 'R1', B: 'R1', C: null },
    })
    expect(output.counts).toEqual({ R1: 3 })
    expect(output.messageIds).toEqual(['m1', 'm2'])
  })
})

describe('MOD-005 aggregate：worker 阈值与降级（§3.6 / §6）', () => {
  it('不超过阈值：主线程完成，不派 worker', async () => {
    let runnerCalls = 0
    const output = await aggregateOccurrences(makeInput(5), {
      threshold: 10,
      runner: async () => {
        runnerCalls += 1
        return { counts: {}, messageIds: [] }
      },
    })
    expect(runnerCalls).toBe(0)
    expect(output.counts).toEqual({ R1: 5 })
  })

  it('超过阈值：worker 结果直接返回；禁用 worker（null）时回退主线程', async () => {
    let runnerCalls = 0
    const delegated = await aggregateOccurrences(makeInput(20), {
      threshold: 10,
      runner: async () => {
        runnerCalls += 1
        return { counts: { R1: 99 }, messageIds: ['from-worker'] }
      },
    })
    expect(runnerCalls).toBe(1)
    expect(delegated).toEqual({ counts: { R1: 99 }, messageIds: ['from-worker'] })

    const fallback = await aggregateOccurrences(makeInput(20), { threshold: 10, runner: null })
    expect(fallback.counts).toEqual({ R1: 20 })
  })

  it('worker 崩溃：降级主线程重试一次并记 warn', async () => {
    const warnings: string[] = []
    const output = await aggregateOccurrences(makeInput(20), {
      threshold: 10,
      runner: async () => {
        throw new Error('worker 异常退出')
      },
      onWarn: (event) => warnings.push(event),
    })
    expect(output.counts).toEqual({ R1: 20 })
    expect(warnings).toContain('meme.aggregate.worker-failed')
  })

  it('worker 崩溃且主线程重试仍失败：抛 ANALYSIS_FAILED（不静默）', async () => {
    const reason = await rejectionOf(
      aggregateOccurrences(makeInput(20), {
        threshold: 10,
        runner: async () => {
          throw new Error('worker 异常退出')
        },
        mainAggregate: () => {
          throw new Error('主线程聚合失败')
        },
      }),
    )
    expect(reason).toBeInstanceOf(MemeError)
    expect((reason as MemeError).envelope).toMatchObject({ code: 'ANALYSIS_FAILED', retryable: true })
  })

  it('主线程分批：按 batchSize 切片、批间让出事件循环、结果合并', async () => {
    const chunks: number[] = []
    let yields = 0
    const output = await aggregateOnMainThread(makeInput(5), {
      batchSize: 2,
      yieldBetweenBatches: async () => {
        yields += 1
      },
      mainAggregate: (input): AggregateOutput => {
        chunks.push(input.occurrences.length)
        return aggregateCounts(input)
      },
    })
    expect(chunks).toEqual([2, 2, 1])
    expect(yields).toBe(2)
    expect(output.counts).toEqual({ R1: 5 })
    expect(output.messageIds).toHaveLength(5)
  })
})
