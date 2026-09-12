/**
 * 采集完成后的预热（HLD 决策 9；`docs/design/impl/mod-004-app-shell.md` §4.5）。
 *
 * 回归背景：实现里此前**完全没有预热** —— `runIngest` 只做 `ingest.trigger()` 与
 * `notifyDataEpoch()`，没有任何地方调用 `meme.startBatch('ingestDone')` 或
 * `extract.run(window)`，`ingest.autoTriggerAfterIngest` 与 `kind:'warmup'`
 * 都没有消费者。后果是「更新数据」成功后 DM-006 / DM-010 永不生成，
 * 梗词云 / 梗生命周期 / 提取条目 / 通知总览 / 待办长期 NO_DATA。
 *
 * 本文件用替身端口把「预热是否真的被发起」钉死：断言调用发生、调用参数正确、
 * 操作被登记为 `kind='warmup'`、开关关闭时不触发、预热失败不影响 update 响应。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ExtractModule } from '@server/extract'
import type { IngestModule } from '@server/ingest'
import type { MemeModule } from '@server/meme'
import type { SocialProfileApi } from '@server/social'

import { createShellApp, type ShellApp } from '../app'

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef'

/** 预热调用记录：每次调用 append 一条。 */
const calls: { startBatch: unknown[]; extractRun: unknown[]; fit: number; candidates: number } = {
  startBatch: [],
  extractRun: [],
  fit: 0,
  candidates: 0,
}

/** 让预热失败用的开关（验证「预热失败不阻塞 update」）。 */
let failWarmup = false

const fakeIngest = {
  status: () => ({ hasData: true, updatedUntilX: null, sourceStatuses: [], meMemberId: 'm2' }),
  isRunning: () => false,
  progress: { subscribe: () => () => undefined },
  trigger: async () => ({
    ok: true,
    data: {
      sources: [
        { source: '群消息', status: 'succeeded', written: 2, failures: [], completedAt: 1 },
        { source: '通讯录与好友列表', status: 'succeeded', written: 1, failures: [], completedAt: 1 },
      ],
    },
    report: {
      sources: [
        { source: '群消息', status: 'succeeded', written: 2, failures: [], completedAt: 1 },
        { source: '通讯录与好友列表', status: 'succeeded', written: 1, failures: [], completedAt: 1 },
      ],
    },
  }),
} as unknown as IngestModule

const fakeExtract = {
  run: async (window: unknown) => {
    calls.extractRun.push(window)
    if (failWarmup) throw new Error('抽取预热失败（替身）')
    return { batchId: 'b1', status: 'succeeded', failures: [] }
  },
  queryEntries: async () => ({ items: [], pageInfo: { page: 1, pageSize: 50, total: 0 }, truncated: false }),
  queryNotifications: async () => ({ groups: [], pageInfo: { page: 1, pageSize: 50, total: 0 }, truncated: false }),
  queryDueTodos: async () => ({ todos: [], total: 0, truncated: false }),
  queryMessageDetail: async () => ({ detail: {}, hints: [], hintStatus: 'ok' }),
} as unknown as ExtractModule

const fakeMeme = {
  startBatch: (cause: unknown, scope: unknown) => {
    calls.startBatch.push({ cause, scope })
    if (failWarmup) throw new Error('梗批次预热失败（替身）')
    return { batchId: 'mb1' }
  },
  queryCloud: async () => ({ terms: [], legend: [], sourceMessageIds: [], truncated: false, total: 0 }),
  queryLifecycle: async () => ({ rows: [], leadingMemes: [], truncated: false, total: 0 }),
  queryMine: async () => ({ terms: [], sourceMessageIds: [], truncated: false, total: 0 }),
  queryCell: async () => ({ cell: {} }),
  applyCorrection: async () => ({ cell: {} }),
} as unknown as MemeModule

const fakeSocial = {
  getMyAffinity: async () => {
    calls.fit += 1
    return { pairs: [], overallFit: null }
  },
  listIdentityCandidates: async () => {
    calls.candidates += 1
    return { candidates: [] }
  },
  getInterestHints: async () => ({ hints: [] }),
} as unknown as SocialProfileApi

const dataDir = mkdtempSync(join(tmpdir(), 'messagepick-warmup-'))
let shell: ShellApp
let server: Server
let base: string

/** 带令牌的写请求。 */
const post = (path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mp-token': TOKEN },
    body: JSON.stringify(body),
  })

/** 预热是后台跑的：轮询等待登记出现，避免固定 sleep 造成抖动。 */
const waitForWarmup = async (count = 3, tries = 40): Promise<Record<string, unknown>[]> => {
  for (let i = 0; i < tries; i += 1) {
    const res = await fetch(`${base}/api/operations`)
    const payload = (await res.json()) as { data?: { operations?: Record<string, unknown>[] } }
    const warmups = (payload.data?.operations ?? []).filter((op) => op['kind'] === 'warmup')
    // 预热很快结束（替身同步返回），操作会被收敛为 succeeded 仍在快照里
    if (warmups.length >= count) return warmups
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return []
}

/**
 * 写入配置：本文件验证「选了待分析群时预热按群发起」。
 * 产品口径要求 `ingest.analysisGroupIds` 非空才会分析（见下一条用例）。
 */
function writeConfig(dataDir: string, analysisGroupIds: string[]): void {
  writeFileSync(
    join(dataDir, 'config.json'),
    JSON.stringify({
      model: { baseUrl: '', apiKey: '', name: '', taskConcurrency: 4 },
      cli: { executable: '', stateDir: '' },
      server: { port: 0 },
      timeouts: { cliCommandMs: 120_000, modelCallMs: 90_000, renderMs: 30_000 },
      retry: { maxAttempts: 3 },
      log: { level: 'info', retentionDays: 7 },
      ingest: { pageSize: 1000, autoTriggerAfterIngest: true, analysisGroupIds },
    }),
    { mode: 0o600 },
  )
}

beforeAll(async () => {
  writeConfig(dataDir, ['g1@chatroom', 'g2@chatroom'])
  shell = createShellApp({
    dataDir,
    token: TOKEN,
    logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
    ports: {
      ingest: fakeIngest,
      extract: fakeExtract,
      meme: fakeMeme,
      social: fakeSocial,
    },
  })
  await new Promise<void>((resolve) => {
    server = shell.app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('采集完成后的预热（§4.5）', () => {
  it('更新成功后按模块发起预热，并登记 kind=warmup 操作', async () => {
    calls.startBatch.length = 0
    calls.extractRun.length = 0

    const res = await post('/api/update', {})
    expect(res.status).toBe(200)

    const warmups = await waitForWarmup(3)
    expect(warmups.length).toBeGreaterThanOrEqual(3)

    // MOD-005：后台批量生成梗，cause 必须是 'ingestDone'，且**只针对选定的群**
    expect(calls.startBatch.length).toBeGreaterThan(0)
    expect(calls.startBatch[0]).toMatchObject({ cause: 'ingestDone' })
    expect((calls.startBatch[0] as { scope?: { groupIds?: string[] } }).scope?.groupIds).toEqual([
      'g1@chatroom',
      'g2@chatroom',
    ])

    /**
     * MOD-006：**不带窗口**调用，窗口由该模块按自己的增量水位推导。
     * 曾传 `{from: completedAt, to: completedAt}`（宽度 0）→ 首次抽取永远扫不到数据。
     */
    expect(calls.extractRun.length).toBeGreaterThan(0)
    expect(calls.extractRun[0]).toBeUndefined()

    // MOD-007：无入参取数预热
    expect(calls.fit).toBeGreaterThan(0)
    expect(calls.candidates).toBeGreaterThan(0)

    // 每模块一条 warmup 登记，scope 为模块 ID
    const scopes = warmups.map((op) => op['scope'])
    expect(scopes).toContain('MOD-005')
    expect(scopes).toContain('MOD-006')
    expect(scopes).toContain('MOD-007')
  })

  it('未选择待分析群时**不发起任何分析**（导入只入库）', async () => {
    // 另起一个实例：配置里 analysisGroupIds 为空
    const emptyDir = mkdtempSync(join(tmpdir(), 'messagepick-warmup-none-'))
    writeConfig(emptyDir, [])
    calls.startBatch.length = 0
    calls.extractRun.length = 0
    const before = { fit: calls.fit, candidates: calls.candidates }

    const bare = createShellApp({
      dataDir: emptyDir,
      token: TOKEN,
      logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
      ports: { ingest: fakeIngest, extract: fakeExtract, meme: fakeMeme, social: fakeSocial },
    })
    const server2 = bare.app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server2.once('listening', () => resolve()))
    const addr = server2.address() as AddressInfo
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mp-token': TOKEN },
        body: '{}',
      })
      expect(res.status).toBe(200)
      // 给后台留出误触发的时间窗
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(calls.startBatch).toHaveLength(0)
      expect(calls.extractRun).toHaveLength(0)
      expect(calls.fit).toBe(before.fit)
      expect(calls.candidates).toBe(before.candidates)
    } finally {
      server2.closeAllConnections()
      server2.close()
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('预热失败不阻塞 update 响应，且操作状态收敛为 failed', async () => {
    failWarmup = true
    try {
      const res = await post('/api/update', {})
      // 关键：预热在后台跑，失败绝不能让更新请求失败
      expect(res.status).toBe(200)

      const warmups = await waitForWarmup(3)
      expect(warmups.length).toBeGreaterThanOrEqual(3)
      expect(warmups.some((op) => op['state'] === 'failed')).toBe(true)
    } finally {
      failWarmup = false
    }
  })
})
