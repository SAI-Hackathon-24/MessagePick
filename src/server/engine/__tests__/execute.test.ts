/**
 * MOD-003 执行任务（API-007）—— 正常路径与容错（mod-003 §7-1 / §7-2 / §7-3）。
 */

import { describe, expect, it } from 'vitest'

import { TASK_TYPES } from '@shared'

import { buildMessages } from '../prompt/assemble'
import { PROTOCOL_VERSION } from '../prompt/protocol'
import { normalizeInput } from '../executor'
import {
  contextInput,
  createHarness,
  defaultParams,
  drive,
  expectOk,
  item,
  messagesInput,
  request,
  textInput,
  unit,
} from './harness'

describe('MOD-003 执行任务：成功路径', () => {
  it('五类任务各一条成功路径：结果结构合法、每条目 ≥1 来源引用、引用 ⊆ 输入标识、返回新任务引用', async () => {
    for (const taskType of TASK_TYPES) {
      const { engine, service } = createHarness()
      const unitId = `in-${taskType}`
      const input = taskType === '生成' ? contextInput(unitId) : messagesInput(unitId)
      service.replyItems([item(`结果-${taskType}`, [unitId])])

      const outcome = expectOk(await engine.executeTask(request(taskType, input)))

      expect(outcome.result.items).toHaveLength(1)
      expect(outcome.sourceRefs).toEqual([unitId])
      expect(outcome.taskRef).toMatch(/^tk_[0-9a-f]{32}$/)
      // 条目自带来源引用，且引用 ⊆ 输入标识
      const emitted = outcome.result.items[0]
      expect(emitted?.sourceRefs).toEqual([unitId])
    }
  })

  it('同一成功记录被再次重试时直接复用缓存结果、不发新调用、但给出新的任务引用', async () => {
    const { engine, service } = createHarness()
    service.replyItems([item('a', [1])])
    const first = expectOk(await engine.executeTask(request('识别', messagesInput('m1'))))
    const callsAfterFirst = service.calls.length

    const again = expectOk(await engine.retryTask(first.taskRef))

    expect(again.taskRef).not.toBe(first.taskRef)
    expect(again.result.items).toEqual(first.result.items)
    expect(again.sourceRefs).toEqual(first.sourceRefs)
    expect(service.calls.length).toBe(callsAfterFirst)
  })

  it('请求按配置出站：模型名取自配置、凭据走 Bearer、不把消息文本写进事件与日志', async () => {
    const { engine, service, events, logs } = createHarness()
    service.replyItems([item('a', [1])])

    await engine.executeTask(request('识别', messagesInput('m1')))

    expect(service.calls[0]?.url).toBe('https://model.test/v1/chat/completions')
    expect(service.calls[0]?.model).toBe('test-model')
    expect(service.calls[0]?.authorization).toBe('Bearer test-api-key')
    expect(service.calls[0]?.messages[0]?.role).toBe('system')
    expect(service.calls[0]?.messages[0]?.content).toContain('JSON')
    expect(JSON.stringify(events)).not.toContain('test-api-key')
    expect(JSON.stringify(logs)).not.toContain('test-api-key')
  })

  it('items 为空 = 成功的空结果（空态语义属调用方，引擎不产生 NO_DATA / EMPTY_RESULT）', async () => {
    const { engine, service } = createHarness()
    service.replyItems([])

    const outcome = expectOk(await engine.executeTask(request('聚类', messagesInput('m1'))))

    expect(outcome.result.items).toEqual([])
    expect(outcome.sourceRefs).toEqual([])
  })
})

describe('MOD-003 执行任务：分块', () => {
  it('输入超单块上限 → 多块串行；块边界确定可复现；引用不跨块串错', async () => {
    const { engine, service } = createHarness({ limits: { chunkMaxUnits: 2 } })
    service.replyItems([item('a', [1]), item('b', [2])])
    service.replyItems([item('c', [3]), item('d', [4])])
    service.replyItems([item('e', [5])])

    const outcome = expectOk(await engine.executeTask(request('识别', messagesInput('m1', 'm2', 'm3', 'm4', 'm5'))))

    expect(service.calls).toHaveLength(3)
    // 每块只带自己的单元（块边界 = 前 2 / 中 2 / 后 1）
    expect(service.calls[0]?.messages[1]?.content).toContain('标识: m1')
    expect(service.calls[0]?.messages[1]?.content).not.toContain('标识: m3')
    expect(service.calls[1]?.messages[1]?.content).toContain('标识: m3')
    expect(service.calls[1]?.messages[1]?.content).not.toContain('标识: m5')
    expect(service.calls[2]?.messages[1]?.content).toContain('标识: m5')
    // 编号全任务唯一：第三块的编号是 5，引用照此回填
    expect(service.calls[2]?.messages[1]?.content).toContain('【输入单元 5】')

    expect(outcome.result.items.map((entry) => entry.label)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(outcome.sourceRefs).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
  })

  it('不可分块类型（聚类 / 生成）整入单次调用', async () => {
    const { engine, service } = createHarness({ limits: { chunkMaxUnits: 1 } })
    service.replyItems([item('簇', [1, 2, 3])])

    const outcome = expectOk(await engine.executeTask(request('聚类', messagesInput('m1', 'm2', 'm3'))))

    expect(service.calls).toHaveLength(1)
    expect(outcome.sourceRefs).toEqual(['m1', 'm2', 'm3'])
  })
})

describe('MOD-003 执行任务：输出容错', () => {
  it('多余字段忽略、Markdown 代码块包裹可解析', async () => {
    const { engine, service } = createHarness()
    service.reply({
      content: ['```json', JSON.stringify({ items: [item('a', [1], { 多余字段: 'x' })] }), '```'].join('\n'),
    })

    const outcome = expectOk(await engine.executeTask(request('识别', messagesInput('m1'))))

    expect(outcome.result.items[0]?.label).toBe('a')
    expect(outcome.result.items[0]?.多余字段).toBe('x')
  })

  it('条目带行内标记（[[编号]] / 【消息 标识】）也能回填来源引用', async () => {
    const { engine, service } = createHarness()
    service.replyItems([{ label: 'a', 备注: '见 [[1]] 与 【消息 m2】' }])

    const outcome = expectOk(await engine.executeTask(request('识别', messagesInput('m1', 'm2'))))

    expect(outcome.sourceRefs).toEqual(['m1', 'm2'])
  })

  it('非法 JSON → 自动重试后成功', async () => {
    const { engine, clock, service } = createHarness()
    service.reply({ content: '这不是 JSON' })
    service.replyItems([item('ok', [1])])

    const outcome = expectOk(await drive(clock, engine.executeTask(request('识别', messagesInput('m1')))))

    expect(service.calls).toHaveLength(2)
    expect(outcome.result.items[0]?.label).toBe('ok')
  })

  it('缺必填字段 → 自动重试后成功', async () => {
    const { engine, clock, service } = createHarness()
    service.replyItems([{ sourceRefs: [1] }]) // 缺 label
    service.replyItems([item('ok', [1])])

    const outcome = expectOk(await drive(clock, engine.executeTask(request('识别', messagesInput('m1')))))

    expect(service.calls).toHaveLength(2)
    expect(outcome.result.items[0]?.label).toBe('ok')
  })

  it('枚举越界 → 自动重试后成功（枚举闭集由调用方 outputSchema 给出）', async () => {
    const { engine, clock, service } = createHarness()
    const params = defaultParams({
      outputSchema: { type: 'object', required: ['tone'], properties: { tone: { type: 'string', enum: ['正式', '随意'] } } },
    })
    service.replyItems([{ tone: '未知', sourceRefs: [1] }])
    service.replyItems([{ tone: '随意', sourceRefs: [1] }])

    const outcome = expectOk(await drive(clock, engine.executeTask(request('识别', messagesInput('m1'), params))))

    expect(service.calls).toHaveLength(2)
    expect(outcome.result.items[0]?.tone).toBe('随意')
  })

  it('来源引用解析失败的条目被丢弃并计入计数（决策 3）', async () => {
    const { engine, service, events } = createHarness()
    service.replyItems([item('保留', [1]), item('丢弃', ['不存在的标识'])])

    const outcome = expectOk(await engine.executeTask(request('识别', messagesInput('m1'))))

    expect(outcome.result.items.map((entry) => entry.label)).toEqual(['保留'])
    expect(outcome.sourceRefs).toEqual(['m1'])
    const done = events.find((event) => event.event === 'task.done')
    expect(done?.counts).toMatchObject({ items: 1, dropped: 1, unknownRefs: 1 })
  })

  it('模型输出多个条目时按输入标识回填，引用不串到输入之外', async () => {
    const { engine, service } = createHarness()
    service.replyItems([item('a', [1, '未知']), item('b', ['m2'])])

    const outcome = expectOk(await engine.executeTask(request('抽取', messagesInput('m1', 'm2'))))

    expect(outcome.result.items.map((entry) => entry.label)).toEqual(['a', 'b'])
    expect(outcome.sourceRefs).toEqual(['m1', 'm2'])
  })
})

describe('MOD-003 执行任务：提示词装配', () => {
  it('系统消息是协议样板（带版本号常量），业务语义只出现在用户消息里', () => {
    const messages = buildMessages({
      taskType: '抽取',
      params: defaultParams({ instruction: '业务口径：只抽取待办事项。' }),
      units: normalizeInput({ kind: '文本', unit: unit('m1', '明天交周报') }).units,
    })

    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).not.toContain('只抽取待办事项')
    expect(messages[1]?.content).toContain('业务口径：只抽取待办事项')
    expect(messages[1]?.content).toContain('【输入单元 1】')
    expect(messages[1]?.content).toContain('标识: m1')
    expect(PROTOCOL_VERSION).toMatch(/^mp-protocol-v\d+$/)
  })

  it('文本输入 = 单条单元，仍带调用方标识', async () => {
    const { engine, service } = createHarness()
    service.replyItems([item('a', ['t1'])])

    const outcome = expectOk(await engine.executeTask(request('抽取', textInput('t1', '一句话'))))

    expect(outcome.sourceRefs).toEqual(['t1'])
    expect(service.calls[0]?.messages[1]?.content).toContain('【输入单元 1】')
  })
})
