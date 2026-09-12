/**
 * MOD-003 重试策略与并发（mod-003 §7-6 / §7-7；详设 §1.2 / §2.3 / §6.1 / §7）。
 */

import { describe, expect, it } from 'vitest'

import { createEngineConfig } from '../config'
import { computeBackoffMs } from '../policy/retry'
import { taskRefFromEnvelope } from '../task-ref'
import { createHarness, drive, expectFailed, expectOk, item, messagesInput, request, tick, waitFor } from './harness'

const BACKOFF = { baseDelayMs: 1_000, maxDelayMs: 30_000, jitterRatio: 0.2 }

describe('MOD-003 退避计算', () => {
  it('指数序列 1s → 2s → 4s，上限 30s，抖动 ±20%', () => {
    expect(computeBackoffMs(0, () => 0.5, BACKOFF)).toBe(1_000)
    expect(computeBackoffMs(1, () => 0.5, BACKOFF)).toBe(2_000)
    expect(computeBackoffMs(2, () => 0.5, BACKOFF)).toBe(4_000)
    expect(computeBackoffMs(10, () => 0.5, BACKOFF)).toBe(30_000)
    expect(computeBackoffMs(0, () => 0, BACKOFF)).toBe(800)
    expect(computeBackoffMs(0, () => 1, BACKOFF)).toBe(1_200)
  })
})

describe('MOD-003 自动重试', () => {
  it('退避序列 1s → 2s → 4s（假时钟）；预算耗尽后任务失败（AC-036）', async () => {
    const { engine, clock, service, events } = createHarness({ config: { retry: { maxAttempts: 3 } }, random: () => 0.5 })
    for (let index = 0; index < 4; index += 1) service.replyStatus(500)

    const outcome = expectFailed(await drive(clock, engine.executeTask(request('识别', messagesInput('m1')))))

    expect(service.calls).toHaveLength(4)
    const delays = events.filter((event) => event.event === 'task.retry' && event.retryKind === 'auto').map((event) => event.delayMs)
    expect(delays).toEqual([1_000, 2_000, 4_000])
    expect(outcome.error.code).toBe('ANALYSIS_FAILED')
    expect(outcome.error.context?.reason).toBe('UPSTREAM_5XX')
    expect(outcome.error.retryable).toBe(true)
  })

  it('Retry-After 优先，且不叠加抖动（详设 §2.3）', async () => {
    const { engine, clock, service, events } = createHarness({ random: () => 1 })
    service.replyStatus(429, { 'retry-after': '7' })
    service.replyItems([item('ok', ['m1'])])

    const outcome = expectOk(await drive(clock, engine.executeTask(request('识别', messagesInput('m1')))))

    expect(outcome.result.items[0]?.label).toBe('ok')
    expect(service.calls).toHaveLength(2)
    const delays = events.filter((event) => event.event === 'task.retry' && event.retryKind === 'auto').map((event) => event.delayMs)
    expect(delays).toEqual([7_000])
  })

  it('同目标连续 5 次可重试失败 → 熔断暂停自动重试；手动重试仍可用（详设 §2.3）', async () => {
    const { engine, service, config } = createHarness({ config: { retry: { maxAttempts: 0 } } })

    for (let index = 0; index < 5; index += 1) {
      service.replyStatus(500)
      expectFailed(await engine.executeTask(request('识别', messagesInput(`m${index}`))))
    }
    expect(service.calls).toHaveLength(5)

    // 打开自动重试预算后，熔断生效：不自动重试、直接以 BREAKER_OPEN 失败
    config.patch({ retry: { maxAttempts: 3 } })
    service.replyStatus(500)
    const sixth = expectFailed(await engine.executeTask(request('识别', messagesInput('m6'))))
    expect(service.calls).toHaveLength(6)
    expect(sixth.error.context?.reason).toBe('BREAKER_OPEN')
    expect(sixth.error.retryable).toBe(true)

    // 手动重试不受限（照常发起调用），成功后退避 / 熔断状态恢复
    service.replyItems([item('ok', ['m6'])])
    const retried = expectOk(await engine.retryTask(taskRefFromEnvelope(sixth.error) ?? ''))
    expect(retried.taskRef).toMatch(/^tk_/)
    expect(service.calls).toHaveLength(7)
  })

  it('配置非法值被拒绝（不静默接受）', () => {
    const config = createEngineConfig()
    /* 2026-09-13 校准后合法区间为 1–64：越界（65）与 0 仍拒绝 */
    expect(() => config.patch({ model: { taskConcurrency: 65 } })).toThrow(RangeError)
    expect(() => config.patch({ model: { taskConcurrency: 0 } })).toThrow(RangeError)
    expect(() => config.patch({ retry: { maxAttempts: -1 } })).toThrow(RangeError)
    expect(() => config.patch({ timeouts: { modelCallMs: 0 } })).toThrow(RangeError)
  })
})

describe('MOD-003 并发与排队', () => {
  it('并发上限 4 时提交 10 个任务：同时在飞 ≤ 4、FIFO 出发、计数只读可见', async () => {
    const { engine, service } = createHarness()
    service.hold = true
    const ids = Array.from({ length: 10 }, (_, index) => `u${index}`)
    const promises = ids.map((id) => engine.executeTask(request('识别', messagesInput(id))))

    await waitFor(() => service.calls.length === 4)
    expect(service.maxConcurrent).toBe(4)
    expect(startedUnitIds(service)).toEqual(['u0', 'u1', 'u2', 'u3'])
    expect(engine.getCounters()).toEqual({ queued: 6, running: 4 })

    service.hold = false
    service.releaseAll()
    const outcomes = await Promise.all(promises)

    for (const outcome of outcomes) expectOk(outcome)
    expect(service.calls).toHaveLength(10)
    expect(service.maxConcurrent).toBeLessThanOrEqual(4)
    expect(startedUnitIds(service)).toEqual(ids)
    expect(engine.getCounters()).toEqual({ queued: 0, running: 0 })
  })

  it('并发上限改为 2 后：运行中任务不打断，新任务按新上限排队（详设 §7）', async () => {
    const { engine, service, config } = createHarness()
    service.hold = true
    const promises = Array.from({ length: 6 }, (_, index) => engine.executeTask(request('识别', messagesInput(`u${index}`))))
    await waitFor(() => service.calls.length === 4)

    config.patch({ model: { taskConcurrency: 2 } })

    service.releaseOne()
    await tick()
    expect(service.calls).toHaveLength(4)
    service.releaseOne()
    await tick()
    expect(service.calls).toHaveLength(4)
    service.releaseOne()
    await tick()
    expect(service.calls).toHaveLength(5)
    service.releaseOne()
    await tick()
    expect(service.calls).toHaveLength(6)

    service.hold = false
    service.releaseAll()
    const outcomes = await Promise.all(promises)
    for (const outcome of outcomes) expectOk(outcome)
    expect(service.calls).toHaveLength(6)
  })

  it('排队的任务不阻塞事件与计数读取（排队不阻塞读，决策 5 后果）', async () => {
    const { engine, service, events } = createHarness({ config: { model: { taskConcurrency: 1 } } })
    service.hold = true
    const first = engine.executeTask(request('识别', messagesInput('a1')))
    const second = engine.executeTask(request('识别', messagesInput('b1')))
    await waitFor(() => service.calls.length === 1)

    // 事件已经发布（外壳可据此展示进度），计数可读
    expect(events.filter((event) => event.event === 'task.enqueue')).toHaveLength(2)
    expect(engine.getCounters()).toEqual({ queued: 1, running: 1 })

    service.hold = false
    service.releaseAll()
    await Promise.all([first, second])
  })
})

function startedUnitIds(service: { calls: Array<{ messages: Array<{ content: string }> }> }): string[] {
  return service.calls.map((call) => /内容 (\S+)/.exec(call.messages[1]?.content ?? '')?.[1] ?? '?')
}
