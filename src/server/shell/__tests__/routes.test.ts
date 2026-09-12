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

const fakeIngest = {
  status: () => ({ hasData: false, updatedUntilX: null, sourceStatuses: [], meMemberId: null }),
  isRunning: () => false,
  progress: { subscribe: () => () => undefined },
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
})
