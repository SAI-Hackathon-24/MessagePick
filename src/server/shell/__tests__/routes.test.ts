/**
 * 外壳路由集成测试（mod-004 §4.1 路由表：`API-009` ~ `API-029` 的直通 / 写）。
 *
 * 口径：模块端口全部注入替身（不真调模型 / 引擎 / 采集）；存储用临时目录的真实门面
 * （`epoch` / 成员目录 / 数据量经它）；服务监听回环，用 `fetch` 直连。
 * 覆盖：读直通与筛选 / 分页参数解析、写令牌守卫、入参校验、统一信封与 404。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ExtractModule } from '@server/extract'
import type { IngestModule } from '@server/ingest'
import type { MemeModule } from '@server/meme'
import type { SocialProfileApi } from '@server/social'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createShellApp, type ShellApp } from '../app'

// ---------------------------------------------------------------------------
// 替身端口（只实现被测路由触达的方法；入参见 `seen`，供断言）
// ---------------------------------------------------------------------------

/** 请求观察口：断言「路由把入参正确传给了端口」。 */
const seen: Record<string, unknown> = {}

/** 采集结果（用例可改；缺省「无来源成功」→ 不触发预热）。 */
let ingestOutcome: unknown = { ok: true, data: { sources: [] }, report: { sources: [] } }

const fakeIngest = {
  status: () => ({ hasData: false, updatedUntilX: null, sourceStatuses: [], meMemberId: null }),
  isRunning: () => false,
  progress: { subscribe: () => () => undefined },
  trigger: (request: unknown) => {
    seen['update'] = request
    return Promise.resolve(ingestOutcome)
  },
} as unknown as IngestModule

const fakeExtract = {
  queryEntries: async (input: unknown) => {
    seen['entries'] = input
    return { items: [], pageInfo: { page: 1, pageSize: 50, total: 0 }, truncated: false }
  },
  queryNotifications: async (input: unknown) => {
    seen['notifications'] = input
    return { groups: [], pageInfo: { page: 1, pageSize: 50, total: 0 }, truncated: false }
  },
  queryDueTodos: async (input: unknown) => {
    seen['due'] = input
    return { todos: [], total: 0, truncated: false }
  },
  queryMessageDetail: async (input: unknown) => {
    seen['detail'] = input
    return { heading: { headline: '一句话总结', groupId: 'g1', time: null }, body: { aiSummary: '总结', sourceMessages: [] } }
  },
  updateEntryAttr: async (input: unknown) => {
    seen['edit'] = input
    return { item: { entryId: 'e1' } }
  },
  setTodoState: async (input: unknown) => {
    seen['todo'] = input
    return { todoStatus: '完成' }
  },
  run: async () => {
    seen['extractRun'] = true
    return {
      status: 'succeeded',
      counts: { groups: 1, messages: 10, recognized: 10, extracted: 8, written: 8, failedTasks: 0 },
      failures: [],
      window: null,
    }
  },
  retry: async (scope: unknown) => {
    seen['extractRetry'] = scope
    seen['extractRetryCalls'] = ((seen['extractRetryCalls'] as number) ?? 0) + 1
    return {
      status: 'succeeded',
      counts: { groups: 1, messages: 5, recognized: 5, extracted: 2, written: 2, failedTasks: 0 },
      failures: [],
      window: { from: 0, to: 1 },
    }
  },
} as unknown as ExtractModule

const fakeMeme = {
  queryCloud: async (input: unknown) => {
    seen['cloud'] = input
    return { terms: [], legend: [], sourceMessageIds: [], truncated: false, total: 0 }
  },
  queryLifecycle: async (input: unknown) => {
    seen['lifecycle'] = input
    return { rows: [], leadingMemes: [], truncated: false, total: 0 }
  },
  queryMine: async (input: unknown) => {
    seen['mine'] = input
    return { terms: [], sourceMessageIds: [], truncated: false, total: 0 }
  },
  queryCell: async (input: unknown) => {
    seen['cell'] = input
    return { memeId: 'm1' }
  },
  applyCorrection: async (input: unknown) => {
    seen['correction'] = input
    return { memeId: 'm1' }
  },
  startBatch: (cause: string, scope?: unknown) => {
    seen['memeBatch'] = cause
    seen['memeBatchScope'] = scope
    return {
      batchId: 'batch-1',
      cause,
      status: () => 'succeeded',
      items: () => [],
      done: Promise.resolve({ status: 'succeeded', items: [] }),
    }
  },
} as unknown as MemeModule

const fakeSocial = {
  getInterestHints: async (input: unknown) => {
    seen['hints'] = input
    return { hints: [] }
  },
  searchPeople: async (input: unknown) => {
    seen['search'] = input
    return { people: [] }
  },
  getProfile: async (input: unknown) => {
    seen['profile'] = input
    return {}
  },
  getPair: async (input: unknown) => {
    seen['pair'] = input
    return {}
  },
  getMyAffinity: async () => {
    seen['fit'] = true
    return { pairs: [], overallFit: null }
  },
  suggestGroupActivity: async (input: unknown) => {
    seen['playdate'] = input
    return { text: '可以约着一起玩' }
  },
  listIdentityCandidates: async () => {
    seen['candidates'] = true
    return { candidates: [] }
  },
  submitIdentityDecision: async (input: unknown) => {
    seen['identity'] = input
    return { status: '已确认' }
  },
  editPersonalityTag: async (input: unknown) => {
    seen['persona'] = input
    return { tags: [] }
  },
  editInterestTag: async (input: unknown) => {
    seen['interests'] = input
    return { profile: {} }
  },
} as unknown as SocialProfileApi

// ---------------------------------------------------------------------------
// 启动（真实存储 + 替身模块端口）
// ---------------------------------------------------------------------------

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
const dataDir = mkdtempSync(join(tmpdir(), 'messagepick-shell-routes-'))

let shell: ShellApp
let server: Server
let base: string

beforeAll(async () => {
  shell = createShellApp({
    dataDir,
    token: TOKEN,
    logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
    ports: { ingest: fakeIngest, extract: fakeExtract, meme: fakeMeme, social: fakeSocial },
  })
  // 成员目录 / 数据量用例的种子数据（真实存储写入）
  shell.ports.store.write('DM-002', [{ groupId: 'g1', groupName: '测试群' }])
  shell.ports.store.write('DM-004', [
    { memberId: 'm1', groupId: 'g1', displayName: '张三', isMe: false, personId: 'p1' },
    { memberId: 'm2', groupId: 'g1', displayName: '李四', isMe: true, personId: 'p2' },
  ])
  await new Promise<void>((resolve) => {
    server = shell.app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  shell.dispose()
  rmSync(dataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 请求小工具
// ---------------------------------------------------------------------------

const query = (params: Record<string, string | string[]>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) search.append(key, item)
    else search.set(key, value)
  }
  return search.toString()
}

const get = (path: string, params?: Record<string, string | string[]>) =>
  fetch(`${base}${path}${params === undefined ? '' : `?${query(params)}`}`)

type WriteMethod = 'POST' | 'PATCH' | 'PUT'

const write = (method: WriteMethod, path: string, body?: unknown, options: { token?: string | null } = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token !== null) headers['x-messagepick-token'] = options.token ?? TOKEN
  return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

const jsonOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

/** 轮询等待（预热等 fire-and-forget 流程用；超时即失败）。 */
const waitFor = async (probe: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await probe()) return
    if (Date.now() > deadline) throw new Error('waitFor 超时')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('读路由（直通与筛选 / 分页解析）', () => {
  it('GET /api/update-status：统一信封 { data, epoch, requestId }', async () => {
    const response = await get('/api/update-status')
    const payload = await jsonOf(response)
    expect(response.status).toBe(200)
    expect(payload['data']).toEqual({ hasData: false, updatedUntilX: null, sourceStatuses: [], meMemberId: null })
    expect(typeof payload['epoch']).toBe('number')
    expect(typeof payload['requestId']).toBe('string')
    expect(payload['ok']).toBeUndefined()
  })

  it('GET /api/memes/cloud：layout / sizeBasis / 全局筛选全部落到模块入参', async () => {
    const response = await get('/api/memes/cloud', {
      layout: '按热度',
      sizeBasis: '累计出现次数',
      groupIds: ['g1', 'g2'],
      from: '100',
      to: '200',
      keyword: '梗',
    })
    expect(response.status).toBe(200)
    expect(seen['cloud']).toEqual({
      filter: { groupIds: ['g1', 'g2'], timeRange: { from: 100, to: 200 }, keyword: '梗' },
      layout: '按热度',
      sizeBasis: '累计出现次数',
    })
  })

  it('GET /api/memes/cloud：缺 layout / 越界取值 → INVALID_INPUT 信封', async () => {
    const missing = await jsonOf(await get('/api/memes/cloud'))
    expect((missing['error'] as Record<string, unknown>)['code']).toBe('INVALID_INPUT')

    const invalid = await jsonOf(await get('/api/memes/cloud', { layout: '乱写' }))
    expect((invalid['error'] as Record<string, unknown>)['code']).toBe('INVALID_INPUT')
  })

  it('GET /api/memes/lifecycle：months 列表归并为范围（取最小 / 最大）', async () => {
    await get('/api/memes/lifecycle', { months: '2026-03,2026-01' })
    expect(seen['lifecycle']).toEqual({ filter: null, months: { from: '2026-01', to: '2026-03' } })
  })

  it('GET /api/extracts：筛选与分页（page / pageSize）直通', async () => {
    await get('/api/extracts', { groupIds: 'g1', page: '2', pageSize: '10' })
    expect(seen['entries']).toEqual({ filter: { groupIds: ['g1'] }, page: { page: 2, pageSize: 10 } })
  })

  it('GET /api/people：entry / value / filter 直通', async () => {
    await get('/api/people', { entry: '按一级维度', value: '运动' })
    expect(seen['search']).toEqual({ entry: '按一级维度', value: '运动', filter: null })
  })

  it('GET /api/people/interest-hints：ids 逗号列表', async () => {
    await get('/api/people/interest-hints', { ids: 'm1,m2' })
    expect(seen['hints']).toEqual({ memberIds: ['m1', 'm2'] })
  })

  it('展示组装路由：名单取昵称排序、评分卡连接逐人置信度、事件流透传强度', async () => {
    const zeroDims = { 娱乐: 0, 游戏: 0, 社交: 0, 艺术: 0, 运动: 0 }
    const zeroPersonality = { 领导式: 0, 活泼: 0, 幽默: 0, 冷静: 0, 理性: 0, 判断: 0 }
    shell.ports.store.write('DM-011', [
      { personId: 'p1', memberIds: ['m1'], isMe: false, unknown: false, activity: 2, replyMedianMs: null, dimensionScores: zeroDims, personalityScores: zeroPersonality },
      { personId: 'p2', memberIds: ['m2'], isMe: true, unknown: false, activity: 5, replyMedianMs: null, dimensionScores: zeroDims, personalityScores: zeroPersonality },
    ])
    shell.ports.store.write('DM-013', [
      { tagId: 't1', name: '羽毛球', dimension: '运动', mergeGroupId: null, firstSeenAt: 1, eventStream: [{ at: 1, strength: 2 }], heatScore: 5 },
    ])
    shell.ports.store.write('DM-014', [{ personId: 'p1', tagId: 't1', confidence: 0.8, origin: '模型抽取', evidenceMessageIds: [] }])

    const roster = (await jsonOf(await get('/api/people/roster')))['data'] as { people: { personId: string; name: string; isMe: boolean }[] }
    expect(roster.people.map((person) => ({ id: person.personId, name: person.name, me: person.isMe }))).toEqual([
      { id: 'p2', name: '李四', me: true },
      { id: 'p1', name: '张三', me: false },
    ])

    const cards = (await jsonOf(await get('/api/interests/score-cards')))['data'] as {
      cards: { tagId: string; peopleCount: number; perPerson: { personId: string; name: string; confidence: number }[] }[]
    }
    expect(cards.cards[0]?.tagId).toBe('t1')
    expect(cards.cards[0]?.peopleCount).toBe(1)
    expect(cards.cards[0]?.perPerson[0]).toEqual({ personId: 'p1', name: '张三', confidence: 0.8 })

    const streams = (await jsonOf(await get('/api/interests/event-streams')))['data'] as {
      streams: { tagId: string; events: { at: number; intensity: number }[] }[]
    }
    expect(streams.streams[0]).toEqual({ tagId: 't1', name: '羽毛球', dimension: '运动', firstSeenAt: 1, events: [{ at: 1, intensity: 2 }] })
  })

  it('GET /api/pairs：memberAId / memberBId 直通', async () => {
    await get('/api/pairs', { memberAId: 'p1', memberBId: 'p2' })
    expect(seen['pair']).toEqual({ memberAId: 'p1', memberBId: 'p2' })
  })

  it('GET /api/me/fit 与 /api/identity/candidates：无入参直通', async () => {
    const fit = await jsonOf(await get('/api/me/fit'))
    expect(fit['data']).toEqual({ pairs: [], overallFit: null })
    const candidates = await jsonOf(await get('/api/identity/candidates'))
    expect(candidates['data']).toEqual({ candidates: [] })
  })

  it('GET /api/members：只回命中标识的成员目录（真实存储过滤）', async () => {
    const payload = await jsonOf(await get('/api/members', { ids: 'm1,不存在' }))
    expect(payload['data']).toEqual({
      members: [{ memberId: 'm1', groupId: 'g1', displayName: '张三', isMe: false, personId: 'p1' }],
    })
  })

  it('GET /api/status/volume：按实体类型给出计数（真实存储）', async () => {
    const payload = await jsonOf(await get('/api/status/volume'))
    // 写入 DM-004 时存储按口径自动补 `DM-011` 人物行（每人一行）→ people = 2
    expect(payload['data']).toEqual({ messages: 0, groups: 1, people: 2, memes: 0, extracts: 0 })
  })

  it('未知路径 → 404 + NOT_FOUND 信封', async () => {
    const response = await get('/api/nope')
    const payload = await jsonOf(response)
    expect(response.status).toBe(404)
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('NOT_FOUND')
  })
})

describe('写路由（令牌守卫与入参校验）', () => {
  it('POST /api/extracts/:id/todo：缺令牌 → 403（GUARD_STATUS），不触达端口', async () => {
    seen['todo'] = undefined
    const response = await write('POST', '/api/extracts/e1/todo', { todoStatus: '完成' }, { token: null })
    const payload = await jsonOf(response)
    expect(response.status).toBe(403)
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('INVALID_INPUT')
    expect(seen['todo']).toBeUndefined()
  })

  it('POST /api/extracts/:id/todo：带令牌 → 直通模块入参', async () => {
    const response = await write('POST', '/api/extracts/e1/todo', { todoStatus: '完成' })
    expect(response.status).toBe(200)
    expect(seen['todo']).toEqual({ entryId: 'e1', todoStatus: '完成' })
  })

  it('POST /api/extracts/:id/todo：todoStatus 越界 → INVALID_INPUT', async () => {
    const payload = await jsonOf(await write('POST', '/api/extracts/e1/todo', { todoStatus: '乱写' }))
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('INVALID_INPUT')
  })

  it('PATCH /api/extracts/:id：主题 / 优先级（未给的一项为 null）', async () => {
    await write('PATCH', '/api/extracts/e1', { priority: '高' })
    expect(seen['edit']).toEqual({ entryId: 'e1', topic: null, priority: '高' })
  })

  it('POST /api/memes/:id/correction：改判三件套直通', async () => {
    await write('POST', '/api/memes/m1/correction', { correction: '合并到其他梗', mergeTargetId: 'm2' })
    expect(seen['correction']).toEqual({ memeId: 'm1', correction: '合并到其他梗', mergeTargetId: 'm2' })
  })

  it('POST /api/people/:id/persona：action / dimension 直通', async () => {
    await write('POST', '/api/people/p1/persona', { action: '确认', dimension: '幽默' })
    expect(seen['persona']).toEqual({ memberId: 'p1', action: '确认', dimension: '幽默' })
  })

  it('PATCH /api/people/:id/interests：tag 结构校验与直通', async () => {
    await write('PATCH', '/api/people/p1/interests', { action: '增', tag: { name: '羽毛球', dimension: '运动' } })
    expect(seen['interests']).toEqual({ memberId: 'p1', action: '增', tag: { name: '羽毛球', dimension: '运动' } })

    const invalid = await jsonOf(await write('PATCH', '/api/people/p1/interests', { action: '增', tag: { name: '羽毛球', dimension: '乱写' } }))
    expect((invalid['error'] as Record<string, unknown>)['code']).toBe('INVALID_INPUT')
  })

  it('POST /api/playdate：interest / candidateMemberIds 直通', async () => {
    await write('POST', '/api/playdate', { interest: '打羽毛球', candidateMemberIds: ['m1', 'm2'] })
    expect(seen['playdate']).toEqual({ interest: '打羽毛球', candidateMemberIds: ['m1', 'm2'] })
  })

  it('POST /api/identity/candidates/:id：conclusion 直通', async () => {
    await write('POST', '/api/identity/candidates/c1', { conclusion: '确认' })
    expect(seen['identity']).toEqual({ candidateId: 'c1', conclusion: '确认' })
  })

  it('GET/PUT /api/settings：模型名可读回；凭据只回「已配置」不回值', async () => {
    const saved = (await jsonOf(await write('PUT', '/api/settings', { model: { baseUrl: 'http://127.0.0.1:9999/v1', name: 'test-model', apiKey: 'sk-test-secret', taskConcurrency: 2 } })))['data'] as { model: Record<string, unknown> }
    expect(saved.model).toMatchObject({ baseUrl: 'http://127.0.0.1:9999/v1', name: 'test-model', apiKeyConfigured: true, taskConcurrency: 2 })
    expect(JSON.stringify(saved)).not.toContain('sk-test-secret')

    const view = (await jsonOf(await get('/api/settings')))['data'] as { model: Record<string, unknown> }
    expect(view.model['name']).toBe('test-model')
  })

  it('POST /api/update：开启自动分析时群消息采集成功 → 后台触发分析（登记两条操作）', async () => {
    // 自动分析默认关：先显式开启（旧行为开关）
    await write('PUT', '/api/settings', { ingest: { autoTriggerAfterIngest: true } })
    seen['memeBatch'] = undefined
    seen['extractRun'] = undefined
    ingestOutcome = {
      ok: true,
      data: { sources: [{ source: '群消息', status: 'succeeded' }] },
      report: { sources: [{ source: '群消息', status: 'succeeded' }] },
    }
    const response = await write('POST', '/api/update', {})
    expect(response.status).toBe(200)
    await waitFor(async () => {
      const payload = await jsonOf(await get('/api/operations'))
      const operations = (payload['data'] as { operations: { kind: string; state: string }[] }).operations
      const warmups = operations.filter((operation) => operation.kind === 'warmup')
      return warmups.length === 2 && warmups.every((operation) => operation.state === 'succeeded')
    })
    expect(seen['memeBatch']).toBe('ingestDone')
    expect(seen['extractRun']).toBe(true)
  })

  it('POST /api/update：仅通讯录成功（群消息未成功）→ 不触发分析', async () => {
    seen['memeBatch'] = undefined
    seen['extractRun'] = undefined
    ingestOutcome = {
      ok: true,
      data: { sources: [{ source: '通讯录与好友列表', status: 'succeeded' }] },
      report: { sources: [{ source: '通讯录与好友列表', status: 'succeeded' }] },
    }
    const response = await write('POST', '/api/update', {})
    expect(response.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen['memeBatch']).toBeUndefined()
    expect(seen['extractRun']).toBeUndefined()
  })

  it('POST /api/analyze：指定群 → 梗批次限定该群、提取逐群重跑（全历史窗口）', async () => {
    seen['memeBatch'] = undefined
    seen['memeBatchScope'] = undefined
    seen['extractRetryCalls'] = 0
    const payload = await jsonOf(await write('POST', '/api/analyze', { groupIds: ['g1', 'g2'] }))
    expect((payload['data'] as { started: boolean }).started).toBe(true)
    await waitFor(async () => (seen['extractRetryCalls'] as number) === 2)
    expect(seen['memeBatch']).toBe('manual')
    expect(seen['memeBatchScope']).toEqual({ groupIds: ['g1', 'g2'] })
    expect(seen['extractRetry']).toEqual({ groupId: 'g2', window: { from: 0, to: expect.any(Number) } })
  })

  it('POST /api/analyze：不传 groupIds → 全部范围（梗不限、提取按水位窗口）', async () => {
    seen['memeBatch'] = undefined
    seen['memeBatchScope'] = undefined
    seen['extractRun'] = undefined
    const response = await write('POST', '/api/analyze', {})
    expect(response.status).toBe(200)
    await waitFor(async () => seen['extractRun'] === true)
    expect(seen['memeBatch']).toBe('manual')
    expect(seen['memeBatchScope']).toEqual({})
  })

  it('POST /api/analyze：缺令牌 → 403（GUARD_STATUS），不触达端口', async () => {
    seen['memeBatch'] = undefined
    const response = await write('POST', '/api/analyze', { groupIds: ['g1'] }, { token: null })
    expect(response.status).toBe(403)
    expect(seen['memeBatch']).toBeUndefined()
  })

  it('POST /api/analyze：groupIds 为空数组 / 非法类型 → INVALID_INPUT', async () => {
    const empty = await jsonOf(await write('POST', '/api/analyze', { groupIds: [] }))
    expect((empty['error'] as Record<string, unknown>)['code']).toBe('INVALID_INPUT')
    const bad = await jsonOf(await write('POST', '/api/analyze', { groupIds: 'g1' }))
    expect((bad['error'] as Record<string, unknown>)['code']).toBe('INVALID_INPUT')
  })
})
