/**
 * 消息详情组装（mod-006 §7「消息详情」「失败路径」行；§4 API-019、§5.2、§3.4；AC-090）：
 *
 * - heading = 一句话总结 + 来源群 + 排序时间（全部来源消息中最早的发送时间）；
 * - 正文 = AI 总结 + 全部来源消息（发送时间升序，图片 / 表情包引用原样回带）；
 * - 来源消息部分缺失（被删除）时按剩余组装、不补占位；剩余全缺（竞态窗口）→ 空正文、时间 null；
 * - 条目不存在（含级联删除后）→ NOT_FOUND；空标识 → INVALID_INPUT；
 * - 超过阈值（默认 200 条）交 worker 组装；worker 异常 → 降级主线程组装（纯计算、结果不变）。
 */

import { describe, expect, it } from 'vitest'

import { assembleDetail, queryMessageDetail, type DetailAssemblyInput, type DetailRunner } from '../detail/message-detail'
import { EntryRepository } from '../store/entry-repository'
import { FakeStore, entry, message } from './harness'

/** 种子：多来源 / 部分缺失 / 剩余全缺 三类条目 + 一条图片消息。 */
function seed(): FakeStore {
  return new FakeStore({
    entries: [
      entry({
        entryId: 'e1',
        groupId: 'g1',
        headline: '明天开评审会',
        aiSummary: '讨论发布计划',
        sourceMessageIds: ['m1', 'm2', 'm3', 'm4'],
      }),
      entry({ entryId: 'e2', groupId: 'g1', headline: '缴费截止', aiSummary: '本周五前缴费', sourceMessageIds: ['m2', 'm-gone'] }),
      entry({ entryId: 'e3', groupId: 'g1', sourceMessageIds: ['m-x', 'm-y'] }),
    ],
    messages: [
      message('m1', 'g1', 3000, '评审会材料'),
      message('m3', 'g1', 2000, '收到'),
      message('m2', 'g1', 1000, '周五前缴费'),
      { ...message('m4', 'g1', 4000), kind: '图片', text: null, mediaRef: 'media-1' },
    ],
  })
}

describe('heading 与正文（§4 API-019；AC-090）', () => {
  it('heading = 一句话总结 + 来源群 + 排序时间；正文按发送时间升序、含图片引用', async () => {
    const detail = await queryMessageDetail(new EntryRepository(seed()), { entryId: 'e1' })

    expect(detail.heading).toEqual({ headline: '明天开评审会', groupId: 'g1', time: 1000 })
    expect(detail.body.aiSummary).toBe('讨论发布计划')
    expect(detail.body.sourceMessages.map((item) => item.messageId)).toEqual(['m2', 'm3', 'm1', 'm4'])
    expect(detail.body.sourceMessages[3]).toMatchObject({ kind: '图片', text: null, mediaRef: 'media-1' })
  })

  it('来源消息部分缺失（被删除）：按剩余组装、不报错、不补占位；时间取剩余最早', async () => {
    const detail = await queryMessageDetail(new EntryRepository(seed()), { entryId: 'e2' })

    expect(detail.body.sourceMessages.map((item) => item.messageId)).toEqual(['m2'])
    expect(detail.heading.time).toBe(1000)
  })

  it('剩余全缺（竞态窗口）：正文空数组、时间 null；正常路径该条目已在级联删除中消失', async () => {
    const detail = await queryMessageDetail(new EntryRepository(seed()), { entryId: 'e3' })

    expect(detail.body.sourceMessages).toEqual([])
    expect(detail.heading.time).toBeNull()
  })

  it('条目不存在 → NOT_FOUND；空标识 → INVALID_INPUT', async () => {
    const repository = new EntryRepository(seed())
    await expect(queryMessageDetail(repository, { entryId: 'nope' })).rejects.toMatchObject({
      envelope: { code: 'NOT_FOUND' },
    })
    await expect(queryMessageDetail(repository, { entryId: '' })).rejects.toMatchObject({
      envelope: { code: 'INVALID_INPUT' },
    })
  })
})

describe('主线程 / worker 分界（§3.4；详设 §1.1）', () => {
  const count = 201
  const bigEntry = entry({
    entryId: 'e-big',
    groupId: 'g1',
    sourceMessageIds: Array.from({ length: count }, (_, index) => `m${String(index).padStart(3, '0')}`),
  })
  const bigStore = () =>
    new FakeStore({
      entries: [bigEntry],
      messages: Array.from({ length: count }, (_, index) => message(`m${String(index).padStart(3, '0')}`, 'g1', index)),
    })

  it('超过阈值（默认 200 条）交 worker：入参为纯数据、结果原样返回', async () => {
    const inputs: DetailAssemblyInput[] = []
    const runner: DetailRunner = async (input) => {
      inputs.push(input)
      return assembleDetail(input)
    }

    const detail = await queryMessageDetail(new EntryRepository(bigStore()), { entryId: 'e-big' }, { runner })

    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.messages).toHaveLength(count)
    expect(inputs[0]?.headline).toBe('一句话总结')
    expect(detail.body.sourceMessages).toHaveLength(count)
    expect(detail.body.sourceMessages[0]?.messageId).toBe('m000')
  })

  it('≤ 阈值主线程组装（不派 worker）；阈值可注入', async () => {
    const inputs: DetailAssemblyInput[] = []
    const runner: DetailRunner = async (input) => {
      inputs.push(input)
      return assembleDetail(input)
    }
    const small = new FakeStore({
      entries: [entry({ entryId: 'e-small', groupId: 'g1', sourceMessageIds: ['m1', 'm2'] })],
      messages: [message('m1', 'g1', 1), message('m2', 'g1', 2)],
    })
    const repository = new EntryRepository(small)

    const detail = await queryMessageDetail(repository, { entryId: 'e-small' }, { runner })
    expect(inputs).toHaveLength(0)
    expect(detail.body.sourceMessages.map((item) => item.messageId)).toEqual(['m1', 'm2'])

    await queryMessageDetail(repository, { entryId: 'e-small' }, { runner, threshold: 1 })
    expect(inputs).toHaveLength(1)
  })

  it('worker 异常 → 降级主线程组装（结果不变）并记 warn', async () => {
    const warns: string[] = []
    const runner: DetailRunner = async () => {
      throw new Error('worker 崩溃（测试注入）')
    }

    const detail = await queryMessageDetail(
      new EntryRepository(bigStore()),
      { entryId: 'e-big' },
      { runner, logger: { warn: (event) => warns.push(event) } },
    )

    expect(detail.body.sourceMessages).toHaveLength(count)
    expect(warns).toEqual(['extract.detail.worker-failed'])
  })
})
