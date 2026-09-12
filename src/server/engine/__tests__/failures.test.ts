/**
 * MOD-003 失败语义与重试（API-008）—— mod-003 §6、§7-4 / §7-5 / §7-8、AC-036 / AC-037 / AC-038。
 */

import { describe, expect, it } from 'vitest'

import type { Api007Request, Api008Request } from '@shared'

import { taskRefFromEnvelope } from '../task-ref'
import {
  createHarness,
  createSiblingEngine,
  defaultParams,
  drive,
  expectFailed,
  expectOk,
  item,
  messagesInput,
  request,
  tick,
  waitFor,
} from './harness'

const WELL_FORMED_UNKNOWN_REF = `tk_${'0'.repeat(32)}`

describe('MOD-003 失败语义：INVALID_INPUT（不建立记录、不发起任何调用）', () => {
  it('任务类型 / 输入 / 单元 / 任务参数非法 → INVALID_INPUT、无任务引用、假端点请求数为零', async () => {
    const { engine, service, events } = createHarness()
    const params = defaultParams()
    const cases: Array<[string, unknown]> = [
      ['任务类型非法', { taskType: '未知任务', input: messagesInput('m1'), params }],
      ['输入缺失', { taskType: '识别', params }],
      ['输入为空', { taskType: '识别', input: { kind: '消息集合', units: [] }, params }],
      ['输入形状非法', { taskType: '识别', input: { kind: '未知形状', units: [] }, params }],
      ['单元缺标识', { taskType: '识别', input: { kind: '消息集合', units: [{ text: 'x' }] }, params }],
      ['单元缺文本', { taskType: '识别', input: { kind: '消息集合', units: [{ id: 'm1' }] }, params }],
      ['任务参数缺失', { taskType: '识别', input: messagesInput('m1') }],
      ['任务说明为空', { taskType: '识别', input: messagesInput('m1'), params: { ...params, instruction: '  ' } }],
      ['字段约束非法', { taskType: '识别', input: messagesInput('m1'), params: { instruction: 'x', outputSchema: { required: [] } } }],
    ]

    for (const [name, payload] of cases) {
      const outcome = expectFailed(await engine.executeTask(payload as Api007Request))
      expect(outcome.error.code, name).toBe('INVALID_INPUT')
      expect(outcome.error.retryable, name).toBe(false)
      expect(outcome.error.context?.reason, name).toBe('VALIDATION')
      expect(outcome.error.scope, name).toBe('request')
      expect(taskRefFromEnvelope(outcome.error), name).toBeNull()
    }

    expect(service.calls).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('超出规模上限 → INVALID_INPUT / INPUT_TOO_LARGE', async () => {
    const clustered = createHarness({ limits: { singleCallMaxUnits: 2 } })
    const tooManyForSingleCall = expectFailed(await clustered.engine.executeTask(request('聚类', messagesInput('m1', 'm2', 'm3'))))
    expect(tooManyForSingleCall.error.code).toBe('INVALID_INPUT')
    expect(tooManyForSingleCall.error.context?.reason).toBe('INPUT_TOO_LARGE')
    expect(clustered.service.calls).toHaveLength(0)

    const bounded = createHarness({ limits: { maxUnitsPerTask: 2 } })
    const tooManyUnits = expectFailed(await bounded.engine.executeTask(request('识别', messagesInput('m1', 'm2', 'm3'))))
    expect(tooManyUnits.error.context?.reason).toBe('INPUT_TOO_LARGE')
    expect(bounded.service.calls).toHaveLength(0)
  })
})

describe('MOD-003 失败语义：任务级失败（§6.1 映射）', () => {
  it('单次调用超时 → TIMEOUT、retryable；信封携带任务引用，可凭它重试', async () => {
    const { engine, clock, service } = createHarness({ config: { timeouts: { modelCallMs: 5_000 }, retry: { maxAttempts: 0 } } })
    service.reply({ hang: true })

    const outcome = expectFailed(await drive(clock, engine.executeTask(request('识别', messagesInput('m1')))))

    expect(outcome.error.code).toBe('TIMEOUT')
    expect(outcome.error.retryable).toBe(true)
    expect(outcome.error.context?.reason).toBe('CALL_TIMEOUT')
    const ref = taskRefFromEnvelope(outcome.error)
    expect(ref).not.toBeNull()

    service.replyItems([item('ok', ['m1'])])
    const retried = expectOk(await drive(clock, engine.retryTask(ref ?? '')))
    expect(retried.taskRef).not.toBe(ref)
    expect(retried.result.items[0]?.label).toBe('ok')
  })

  it('超时在自动重试预算内重试，预算耗尽后仍失败（详设 §2.3）', async () => {
    const { engine, clock, service } = createHarness({ config: { timeouts: { modelCallMs: 1_000 }, retry: { maxAttempts: 1 } } })
    service.reply({ hang: true })
    service.reply({ hang: true })

    const outcome = expectFailed(await drive(clock, engine.executeTask(request('识别', messagesInput('m1')))))

    expect(service.calls).toHaveLength(2)
    expect(outcome.error.code).toBe('TIMEOUT')
  })

  it('5xx / 网络不可达 / 限流 → ANALYSIS_FAILED（可重试）且原因分类正确', async () => {
    const serverError = createHarness({ config: { retry: { maxAttempts: 0 } } })
    serverError.service.replyStatus(503)
    const fiveXx = expectFailed(await serverError.engine.executeTask(request('识别', messagesInput('m1'))))
    expect(fiveXx.error.code).toBe('ANALYSIS_FAILED')
    expect(fiveXx.error.retryable).toBe(true)
    expect(fiveXx.error.context?.reason).toBe('UPSTREAM_5XX')

    const network = createHarness({ config: { retry: { maxAttempts: 0 } } })
    network.service.reply({ networkError: true })
    const unreachable = expectFailed(await network.engine.executeTask(request('识别', messagesInput('m1'))))
    expect(unreachable.error.context?.reason).toBe('NETWORK')
    expect(unreachable.error.retryable).toBe(true)

    const limited = createHarness({ config: { retry: { maxAttempts: 0 } } })
    limited.service.replyStatus(429, { 'retry-after': '7' })
    const rateLimited = expectFailed(await limited.engine.executeTask(request('识别', messagesInput('m1'))))
    expect(rateLimited.error.context?.reason).toBe('RATE_LIMIT')
    expect(rateLimited.error.retryable).toBe(true)
  })

  it('凭据无效（401）→ 不自动重试、retryable=false、原因 CREDENTIAL', async () => {
    const { engine, service } = createHarness() // maxAttempts = 3，用于证明「没有发生自动重试」
    service.replyStatus(401)

    const outcome = expectFailed(await engine.executeTask(request('识别', messagesInput('m1'))))

    expect(service.calls).toHaveLength(1)
    expect(outcome.error.code).toBe('ANALYSIS_FAILED')
    expect(outcome.error.retryable).toBe(false)
    expect(outcome.error.context?.reason).toBe('CREDENTIAL')
  })

  it('未配置模型地址 / 凭据 / 模型名 → MODEL_NOT_CONFIGURED，不发起调用、不自动重试', async () => {
    const configs = [{ model: { baseUrl: '' } }, { model: { apiKey: '' } }, { model: { name: '' } }]

    for (const config of configs) {
      const { engine, service } = createHarness({ config })
      const outcome = expectFailed(await engine.executeTask(request('识别', messagesInput('m1'))))
      expect(service.calls).toHaveLength(0)
      expect(outcome.error.code).toBe('ANALYSIS_FAILED')
      expect(outcome.error.retryable).toBe(false)
      expect(outcome.error.context?.reason).toBe('MODEL_NOT_CONFIGURED')
    }
  })

  it('模型拒答（refusal / content_filter）→ REFUSAL，不自动重试', async () => {
    const refused = createHarness()
    refused.service.reply({ content: '', refusal: '抱歉，我不能处理这个请求' })
    const refusal = expectFailed(await refused.engine.executeTask(request('识别', messagesInput('m1'))))
    expect(refused.service.calls).toHaveLength(1)
    expect(refusal.error.context?.reason).toBe('REFUSAL')
    expect(refusal.error.retryable).toBe(false)

    const filtered = createHarness()
    filtered.service.reply({ content: '', finishReason: 'content_filter' })
    const contentFiltered = expectFailed(await filtered.engine.executeTask(request('识别', messagesInput('m1'))))
    expect(contentFiltered.error.context?.reason).toBe('REFUSAL')
  })

  it('请求被服务端拒绝（422）→ REQUEST_REJECTED，不自动重试', async () => {
    const { engine, service } = createHarness()
    service.replyStatus(422)

    const outcome = expectFailed(await engine.executeTask(request('识别', messagesInput('m1'))))

    expect(service.calls).toHaveLength(1)
    expect(outcome.error.context?.reason).toBe('REQUEST_REJECTED')
    expect(outcome.error.retryable).toBe(false)
  })

  it('失败信封 scope 携带任务引用（AC-038：错误一律以信封上抛，不吞错）', async () => {
    const { engine, service } = createHarness({ config: { retry: { maxAttempts: 0 } } })
    service.replyStatus(500)

    const outcome = expectFailed(await engine.executeTask(request('识别', messagesInput('m1'))))

    const ref = taskRefFromEnvelope(outcome.error)
    expect(ref).toMatch(/^tk_[0-9a-f]{32}$/)
    expect(outcome.error.scope).toBe(`task:${ref}`)
    expect(outcome.error.message).not.toContain('内容 m1')
  })
})

describe('MOD-003 重试（API-008）', () => {
  it('失败任务重试成功：只重跑失败块（含未跑到的后续块），已成功块不重复调用', async () => {
    const { engine, service } = createHarness({ limits: { chunkMaxUnits: 1 }, config: { retry: { maxAttempts: 0 } } })
    service.replyItems([item('a', ['m1'])]) // 块 1 成功
    service.replyStatus(500) // 块 2 失败 → 任务失败，块 3 不再发起

    const first = expectFailed(await engine.executeTask(request('识别', messagesInput('m1', 'm2', 'm3'))))
    expect(service.calls).toHaveLength(2)
    const ref = taskRefFromEnvelope(first.error)
    expect(ref).not.toBeNull()

    service.replyItems([item('b', ['m2'])]) // 块 2 重跑成功
    service.replyItems([item('c', ['m3'])]) // 块 3 首次执行
    const second = expectOk(await engine.retryTask(ref ?? ''))

    expect(second.taskRef).not.toBe(ref)
    expect(second.result.items.map((entry) => entry.label)).toEqual(['a', 'b', 'c'])
    expect(second.sourceRefs).toEqual(['m1', 'm2', 'm3'])
    expect(service.calls).toHaveLength(4)
    // 块 1（m1）只被调用过一次
    const chunkOneCalls = service.calls.filter((call) => call.messages[1]?.content.includes('内容 m1'))
    expect(chunkOneCalls).toHaveLength(1)
    expect(service.calls[2]?.messages[1]?.content).toContain('内容 m2')
    expect(service.calls[3]?.messages[1]?.content).toContain('内容 m3')
  })

  it('重试结果与首次同构，且可对重试返回的新引用再次重试（成功缓存复用）', async () => {
    const { engine, service } = createHarness({ config: { retry: { maxAttempts: 0 } } })
    service.replyStatus(500)
    const first = expectFailed(await engine.executeTask(request('抽取', messagesInput('m1'))))

    service.replyItems([item('ok', ['m1'])])
    const second = expectOk(await engine.retryTask(taskRefFromEnvelope(first.error) ?? ''))
    const callsAfterRetry = service.calls.length

    const third = expectOk(await engine.retryTask(second.taskRef))

    expect(third.taskRef).not.toBe(second.taskRef)
    expect(third.result).toEqual(second.result)
    expect(third.sourceRefs).toEqual(second.sourceRefs)
    expect(service.calls.length).toBe(callsAfterRetry)
  })

  it('无效 / 未知 / 淘汰 / epoch 失效 / 进程重启后的引用 → INVALID_INPUT，且无执行、无副作用（AC-037）', async () => {
    // 格式非法 + 未登记
    const base = createHarness()
    for (const ref of ['not-a-ref', '', WELL_FORMED_UNKNOWN_REF]) {
      const outcome = expectFailed(await base.engine.retryTask(ref))
      expect(outcome.error.code).toBe('INVALID_INPUT')
      expect(outcome.error.context?.reason).toBe('REF_UNKNOWN')
      expect(outcome.error.retryable).toBe(false)
      expect(outcome.error.scope).toBe('request')
    }
    expect(base.service.calls).toHaveLength(0)
    expect(base.events).toHaveLength(0)

    // 容量淘汰（LRU）
    const evicting = createHarness({ registryCapacity: 1 })
    evicting.service.replyItems([item('a', ['m1'])])
    const first = expectOk(await evicting.engine.executeTask(request('识别', messagesInput('m1'))))
    evicting.service.replyItems([item('b', ['m2'])])
    await evicting.engine.executeTask(request('识别', messagesInput('m2')))
    const evicted = expectFailed(await evicting.engine.retryTask(first.taskRef))
    expect(evicted.error.context?.reason).toBe('REF_UNKNOWN')

    // dataEpoch 递增 → 注册表清空
    const epoch = createHarness()
    epoch.service.replyItems([item('a', ['m1'])])
    const beforeEpoch = expectOk(await epoch.engine.executeTask(request('识别', messagesInput('m1'))))
    epoch.engine.notifyDataEpoch(1)
    const afterEpoch = expectFailed(await epoch.engine.retryTask(beforeEpoch.taskRef))
    expect(afterEpoch.error.context?.reason).toBe('REF_UNKNOWN')

    // 进程重启模拟：新实例
    const restarted = createHarness()
    restarted.service.replyItems([item('a', ['m1'])])
    const beforeRestart = expectOk(await restarted.engine.executeTask(request('识别', messagesInput('m1'))))
    const sibling = createSiblingEngine(restarted)
    const afterRestart = expectFailed(await sibling.retryTask(beforeRestart.taskRef))
    expect(afterRestart.error.context?.reason).toBe('REF_UNKNOWN')
  })

  it('queued / running 记录的重试单飞等待既有执行（不重复调用模型），并返回新引用', async () => {
    const { engine, service, events } = createHarness({ config: { model: { taskConcurrency: 1 } } })
    service.hold = true
    const running = engine.executeTask(request('识别', messagesInput('a1')))
    const queued = engine.executeTask(request('识别', messagesInput('b1')))
    await waitFor(() => service.calls.length === 1)

    const enqueued = events.filter((event) => event.event === 'task.enqueue')
    const runningRef = enqueued[0]?.taskRef ?? ''
    const queuedRef = enqueued[1]?.taskRef ?? ''

    const retryOfQueued = engine.retryTask(queuedRef)
    await tick()
    expect(service.calls).toHaveLength(1) // 排队中的任务没有被重复调用

    service.defaultReply = { content: JSON.stringify({ items: [item('b', ['b1'])] }) }
    service.hold = false
    service.releaseAll()

    const [runningOutcome, queuedOutcome, retryOutcome] = await Promise.all([running, queued, retryOfQueued])
    expect(service.calls).toHaveLength(2)
    expect(expectOk(runningOutcome).taskRef).toBe(runningRef)
    expect(expectOk(queuedOutcome).taskRef).toBe(queuedRef)
    const retried = expectOk(retryOutcome)
    expect(retried.taskRef).not.toBe(queuedRef)
    expect(retried.result.items).toEqual(expectOk(queuedOutcome).result.items)
  })

  it('queued → canceled（进程收尾）：未执行的任务给出 CANCELED 失败，运行中任务不打断', async () => {
    const { engine, service, events } = createHarness({ config: { model: { taskConcurrency: 1 } } })
    service.hold = true
    const running = engine.executeTask(request('识别', messagesInput('a1')))
    const queued = engine.executeTask(request('识别', messagesInput('b1')))
    await waitFor(() => service.calls.length === 1)

    engine.shutdown()

    const canceled = expectFailed(await queued)
    expect(canceled.error.code).toBe('ANALYSIS_FAILED')
    expect(canceled.error.retryable).toBe(false)
    expect(canceled.error.context?.reason).toBe('CANCELED')
    expect(taskRefFromEnvelope(canceled.error)).not.toBeNull()

    service.releaseAll()
    const finished = expectOk(await running)
    expect(finished.taskRef).toMatch(/^tk_/)

    expect(events.some((event) => event.state === 'canceled' && event.event === 'task.failed')).toBe(true)
    expect(service.calls).toHaveLength(1) // 被取消的任务从未执行

    // 收尾后不再受理新任务
    const rejected = expectFailed(await engine.executeTask(request('识别', messagesInput('c1'))))
    expect(rejected.error.context?.reason).toBe('CANCELED')
    expect(service.calls).toHaveLength(1)
  })

  it('重试接口按契约接受 { taskRef } 形状之外的裸引用（示例见 Api008Request）', async () => {
    const { engine, service } = createHarness()
    service.replyItems([item('a', ['m1'])])
    const outcome = expectOk(await engine.executeTask(request('识别', messagesInput('m1'))))
    const retryRequest: Api008Request = { taskRef: outcome.taskRef }

    const again = expectOk(await engine.retryTask(retryRequest.taskRef))

    expect(again.result).toEqual(outcome.result)
  })
})
