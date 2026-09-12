/**
 * 模块装配（mod-006 §3.1「index.ts —— 装配：向外壳注册 6 条 API 的服务端实现」、§3.3、§4；
 * mod-004 §3.3 的 `ExtractPort` 口径）：
 *
 * - 出口 = 6 条 API（`API-014` ~ `API-019`）+ 管线 `run` / `retry`；依赖全部注入，不真调模型、不真开库；
 * - 查询直通：时间轴 / 通知总览 / 到期待办 / 消息详情（同一存储替身 + 注入时钟）；
 * - 写入直通：改主题 / 标记完成经 `API-003` 立即生效；
 * - `run` 触发批次（采集成功后由外壳接线，§4.5）；失败分项经 `retry` 重试（`API-008`）。
 */

import { describe, expect, it } from 'vitest'

import { createExtractModule } from '../index'
import { buildEntryId } from '../pipeline/recognition'
import { NOW, FakeStore, ScriptedGateway, entry, failureOutcome, fixedClock, message, okOutcome } from './harness'

describe('出口与装配（§3.1、§3.3）', () => {
  it('6 条 API + run / retry 全部就位（依赖可注入）', () => {
    const extract = createExtractModule({ store: new FakeStore() })
    expect(Object.keys(extract).sort()).toEqual([
      'queryDueTodos',
      'queryEntries',
      'queryMessageDetail',
      'queryNotifications',
      'retry',
      'run',
      'setTodoState',
      'updateEntryAttr',
    ])
  })

  it('查询链路直通：时间轴 / 通知总览 / 到期待办 / 消息详情', async () => {
    const store = new FakeStore({
      messages: [message('m1', 'g1', NOW)],
      entries: [
        entry({
          entryId: 'e1',
          groupId: 'g1',
          sourceMessageIds: ['m1'],
          headline: '开评审会',
          deadline: NOW + 60 * 60 * 1000,
        }),
      ],
    })
    const extract = createExtractModule({ store, clock: fixedClock() })

    expect((await extract.queryEntries()).items.map((item) => item.entryId)).toEqual(['e1'])
    expect((await extract.queryNotifications({ dimension: '优先级' })).groups.map((group) => group.key)).toEqual([
      '高',
      '中',
      '低',
    ])
    expect((await extract.queryDueTodos({ now: NOW })).todos.map((todo) => todo.entryId)).toEqual(['e1'])
    expect((await extract.queryMessageDetail({ entryId: 'e1' })).body.sourceMessages.map((item) => item.messageId)).toEqual([
      'm1',
    ])
  })

  it('写入链路直通：改主题 / 标记完成立即生效（同一存储）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', topic: '旧主题' })] })
    const extract = createExtractModule({ store, clock: fixedClock() })

    const updated = await extract.updateEntryAttr({ entryId: 'e1', topic: '新主题' })
    expect(updated.item.topic).toBe('新主题')
    expect(store.entries[0]?.topic).toBe('新主题')

    await extract.setTodoState({ entryId: 'e1', todoStatus: '完成' })
    expect(store.entries[0]?.todoStatus).toBe('完成')
  })

  it('run / retry：批次触发与分项重试（任务引用交 API-008）', async () => {
    const store = new FakeStore({ messages: [message('m1', 'g1', 1000)] })
    let failed = false
    const gateway = new ScriptedGateway({
      识别: () => {
        if (!failed) {
          failed = true
          return failureOutcome('ref-recognize')
        }
        return okOutcome([{ recognitionType: '会议', sourceRefs: ['1'] }])
      },
      抽取: () => okOutcome([{ headline: '明天开评审会', aiSummary: '讨论发布计划', priority: '高' }]),
      聚类: () => okOutcome([{ topic: '会议安排', sourceRefs: ['1'] }]),
      retry: () => okOutcome([{ recognitionType: '会议', sourceRefs: ['1'] }]),
    })
    const extract = createExtractModule({ store, gateway, clock: fixedClock() })

    const first = await extract.run({ from: 0, to: NOW })
    expect(first.status).toBe('failed')
    expect(first.failures[0]?.taskRef).toBe('ref-recognize')
    expect(store.entries).toHaveLength(0)

    const retried = await extract.retry('ref-recognize')
    expect(retried.status).toBe('succeeded')
    expect(gateway.retryCalls).toEqual(['ref-recognize'])
    expect(store.entries[0]?.entryId).toBe(buildEntryId('g1', '会议', ['m1']))
  })
})
