/**
 * 应用外壳组装根（mod-004 §3.1「app.ts」、§4.1 路由表、§4.6 组合端点、§4.8 进度传输、§6.2 守卫错误；
 * 详设 §4.1 本地接口防护、§7 配置与生效时机、决策 9「选端口 → 启服务 → 打开带令牌页面」）。
 *
 * 本文件只做三件事（不进任何业务口径）：
 * 1. **装配**：express 应用 + 守卫（Host / Origin + 写令牌）+ 路由表 + 静态页面 + SSE；
 * 2. **组合**：跨模块数据的唯一组装点（详情 = `API-019` + `API-029`，`REQ-070`）；业务模块之间零调用；
 * 3. **启动**：选端口（`config.server.port`，0 = 自动）→ 监听回环 → 给出带令牌页面地址。
 *
 * 设计的分层落点（后续拆分时按下面注释的分节机械平移，行为不变）：
 * - `http/router.ts` ← 「路由表」节；`http/static.ts` ← 「静态页面」节；
 * - `ports/*.ts` ← 「端口装配」节；`orchestration/operation-tracker.ts` ← 「操作登记」节；
 * - `orchestration/detail-assembly.ts` + `hint-members.ts` ← 「详情组装」节；
 * - `progress/sse-hub.ts` ← 「进度传输」节。
 *
 * 明确不做（口径来自上游）：不暴露模块内部队列深度（CHG-024）、不提供演示数据通道（`REQ-019`）、
 * 不持有业务数据副本、不改写任何模块输出、不新增错误标识（`code` 只取 `@shared` 的 14 个闭集值）。
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { type Server } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express'

import { configureEngine, notifyDataEpoch, shutdownEngine } from '@server/engine'
import { createExtractModule, type ExtractModule } from '@server/extract'
import { createIngestModule, type IngestModule } from '@server/ingest'
import type { MaterialItem } from '@server/regen'
import {
  createProfileBuildPipeline,
  createSocialProfileApi,
  type SocialProfileApi,
  SocialIndex,
} from '@server/social'
import { createStore, type Store } from '@server/store'
import type { Api001Request, DeletionScope, ErrorEnvelope, MemberHint, MessageDetail, SharedFilter } from '@shared'
import { INGEST_SOURCES } from '@shared'

import {
  loadConfig,
  saveConfig,
  settingsViewOf,
  type ConfigLoadResult,
  type SettingsPatch,
  type ShellConfig,
} from './config'
import { createGuard, createStartupToken, loopbackOrigins, TOKEN_HEADER, type MetaOf } from './http/guard'
import {
  GATE_STATUS,
  NOT_FOUND_STATUS,
  failure,
  isUnmapped,
  mapError,
  shellEnvelope,
  success,
} from './http/respond'
import { bodyBoolean, bodyEnum, bodyInt, bodyRecord, bodyString, invalidInput, queryFirst, queryInt } from './http/validate'
import { createShellLogger, type ShellLogLevel, type ShellLogger } from './log'

/** 页面侧发出的启动令牌头名（`src/web/shell/api/token.ts` 的 `LAUNCH_TOKEN_HEADER`）。 */
const PAGE_TOKEN_HEADER = 'x-messagepick-token'

/** 监听地址：只绑回环（详设 §4.1；HLD §4「服务仅监听回环地址」）。 */
const LOOPBACK_HOST = '127.0.0.1'

/** 日志级别闭集（`config.ts` 的校验同源；设置页可改）。 */
const LOG_LEVEL_OPTIONS: readonly ShellLogLevel[] = ['debug', 'info', 'warn', 'error']

/** 一次生成请求的素材确认结果（与 mod-008 `materials/consent.ts` 的 `ConsentResult` 同构）。 */
export interface MaterialConsentResult {
  consentIds: string[]
  confirmed: number
  alreadyConfirmed: number
}

/**
 * `MOD-008` 的进程内入口（mod-004 §4.7 / `TASK-037` 的 `submitMaterialConsent` / `readArtifact`）。
 *
 * 现状（实测）：`src/server/regen/index.ts` 只再导出 constants / domain / errors / materials·manifest /
 * render·registry，**未导出** `materials/consent.ts` 的 `submitMaterialConsent` 与 `store/artifacts.ts` 的
 * `readArtifact`。按「模块外只经模块出口取用」的口径，外壳不深挖子目录、不代为实现 ⇒ 这两个入口默认未接线，
 * 对应路由给出明确的未接线失败（500 + 日志），并在模块发布后再此注入即闭环（见 `ShellAppOptions.ports`）。
 */
export interface RegenPort {
  /** 素材合规确认：`(store, items, now)` 绑定后的进程内入口。 */
  submitMaterialConsent(items: readonly MaterialItem[], now: number): MaterialConsentResult
  /** 产物读取：`(store, ref)` 绑定后的进程内入口；产物随所属数据删除后 → `NOT_FOUND`。 */
  readArtifact(ref: string): { bytes: Uint8Array; mime: string }
}

/** 端口集合：外壳唯一的数据出入口（mod-004 §3.3；测试可整体替换）。 */
export interface ShellPorts {
  store: Store
  ingest: IngestModule
  extract: ExtractModule
  social: SocialProfileApi
  /** 缺省未接线（模块出口未发布，见 `RegenPort`）。 */
  regen?: RegenPort
}

/** 外壳操作（mod-004 §3.3 / §5.2；与页面侧 `state/operations.ts` 同构）。 */
export interface ShellOperation {
  id: string
  kind: 'ingest' | 'deletion' | 'warmup' | 'generation'
  scope: string
  state: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'
  counts: { done: number; total?: number }
  error?: ErrorEnvelope
  startedAt: number
  updatedAt: number
}

/** 组装选项（全部可注入；缺省 = 真实装配）。 */
export interface ShellAppOptions {
  /** 应用数据目录（`app.db` / `media/` / `logs/` / `config.json` / `backup/` 的根；详设 §3.4）。 */
  dataDir?: string
  /** 已加载的配置；缺省 = 从 `dataDir` 读 `config.json`（解析失败按详设 §7 回落默认值）。 */
  config?: ShellConfig
  /** 启动令牌；缺省 = `createStartupToken()`（128 位随机，仅本次进程有效）。 */
  token?: string
  /** 日志 sink；缺省 = 标准输出 + `dataDir/logs` 落盘。 */
  logger?: ShellLogger
  /** 进程内时钟（测试注入）。 */
  clock?: () => number
  /** 已绑定的端口（Host / Origin 校验用）；缺省取 `config.server.port`，监听后自动更新。 */
  port?: number
  /** 端口对象（模块已装配时整体注入；缺省 = 就地装配）。 */
  ports?: Partial<ShellPorts>
  /** 静态页面目录；缺省 = `<仓库根>/dist/web`（`npm run build` 的产物）。 */
  webDir?: string
}

/** 组装结果（未监听；测试可直接拿去发请求）。 */
export interface ShellApp {
  app: Express
  config: ShellConfig
  token: string
  dataDir: string
  ports: ShellPorts
  logger: ShellLogger
  /** 页面产物是否存在（`dist/web/index.html`）。 */
  pageBuilt: boolean
  /** 监听后回填实际端口（守卫的 origin 集合随它变化）。 */
  setBoundPort(port: number): void
  /** 释放：断开 SSE、退订进度、关库、引擎收尾。 */
  dispose(): void
}

/** 启动结果（`main.ts` 的三步：选端口 → 启服务 → 打开带令牌页面）。 */
export interface ShellServer {
  port: number
  host: string
  /** 服务根地址（不含令牌）。 */
  url: string
  /** 页面地址（启动令牌经 URL fragment 注入；页面只在内存持有，详设 §4.1）。 */
  pageUrl: string
  token: string
  dataDir: string
  pageBuilt: boolean
  config: ShellConfig
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// 应用数据目录 / 页面产物目录
// ---------------------------------------------------------------------------

/** 应用数据目录：`MESSAGEPICK_DATA_DIR` → 缺省 `<仓库根>/data`（`.gitignore` 已忽略；详设 §3.4）。 */
export function defaultDataDir(): string {
  const configured = process.env['MESSAGEPICK_DATA_DIR']
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return resolve(configured)
  }
  return fileURLToPath(new URL('../../../data/', import.meta.url))
}

/** 前端构建产物目录（`npm run build` → `dist/web`）。 */
export function defaultWebDir(): string {
  return fileURLToPath(new URL('../../../dist/web/', import.meta.url))
}

// ---------------------------------------------------------------------------
// 操作登记（设计落点 `orchestration/operation-tracker.ts`；CHG-024：只登记外壳发起的操作）
// ---------------------------------------------------------------------------

interface OperationTracker {
  start(op: { kind: ShellOperation['kind']; scope: string; counts?: { done: number; total?: number } }): string
  update(id: string, patch: Partial<Omit<ShellOperation, 'id' | 'kind' | 'scope' | 'startedAt'>>): void
  snapshot(): ShellOperation[]
  subscribe(listener: () => void): () => void
  /** 是否存在该类别下「排队 / 在途」的操作（门控与入口置灰依据）。 */
  hasActive(kind: ShellOperation['kind']): boolean
}

function createOperationTracker(clock: () => number): OperationTracker & { clear(): void } {
  const items = new Map<string, ShellOperation>()
  const listeners = new Set<() => void>()
  let seq = 0

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // 进度是旁路：订阅者异常不得反噬请求处理（与 ingest 的进度通道同口径）
      }
    }
  }

  return {
    start(op) {
      seq += 1
      const at = clock()
      const id = `op-${seq}`
      items.set(id, {
        id,
        kind: op.kind,
        scope: op.scope,
        state: 'queued',
        counts: op.counts ?? { done: 0 },
        startedAt: at,
        updatedAt: at,
      })
      notify()
      return id
    },
    update(id, patch) {
      const current = items.get(id)
      if (current === undefined) return
      items.set(id, { ...current, ...patch, updatedAt: clock() })
      notify()
    },
    snapshot() {
      return [...items.values()].map((operation) => ({ ...operation, counts: { ...operation.counts } }))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hasActive(kind) {
      for (const operation of items.values()) {
        if (operation.kind === kind && (operation.state === 'queued' || operation.state === 'running')) return true
      }
      return false
    },
    clear() {
      items.clear()
      listeners.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// 详情组装（设计落点 `orchestration/detail-assembly.ts` + `hint-members.ts`；REQ-070 / 决策 5）
// ---------------------------------------------------------------------------

/** 组合端点载荷（与页面侧 `compose/detail-view.ts` 的 `DetailPayload` 同构）。 */
export interface DetailPayload {
  detail: MessageDetail
  hints: MemberHint[]
  /** `degraded` = 提示子调用失败 / 超时，正文不受影响（REQ-016）。 */
  hintStatus: 'ok' | 'degraded'
}

/** 成员集 = ∪发送者 ∪ ∪提及成员（只用 DM-003 既有字段；去重保序）。 */
export function memberIdsOf(detail: MessageDetail): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const message of detail.body.sourceMessages) {
    const candidates = [message.senderMemberId, ...(message.mentionedMemberIds ?? [])]
    for (const id of candidates) {
      if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// 日志：级别可动态调整（详设 §7：`log.level` 立即生效）
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Readonly<Record<ShellLogLevel, number>> = { error: 0, warn: 1, info: 2, debug: 3 }

function createLevelAwareLogger(sink: ShellLogger, levelOf: () => ShellLogLevel): ShellLogger {
  const write = (level: ShellLogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[levelOf()]) return
    sink[level](event, fields)
  }
  return {
    error: (event, fields) => write('error', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    info: (event, fields) => write('info', event, fields),
    debug: (event, fields) => write('debug', event, fields),
  }
}

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------

/** 组装 express 应用（不监听；`startShell` 负责监听与页面地址）。 */
export function createShellApp(options: ShellAppOptions = {}): ShellApp {
  const clock = options.clock ?? Date.now
  const dataDir = options.dataDir ?? defaultDataDir()

  // 配置：读文件 → 归一化（未知键忽略、非法值回落并记 issue），凭据只留内存与文件（详设 §7 / §4.3）
  const loaded: ConfigLoadResult =
    options.config === undefined
      ? loadConfig(dataDir)
      : { config: options.config, source: 'file', badPath: null, issues: [] }
  const config = loaded.config

  const level = { current: config.log.level }
  const sink = options.logger ?? createShellLogger({ dataDir, level: 'debug', retentionDays: config.log.retentionDays })
  const logger = createLevelAwareLogger(sink, () => level.current)

  if (loaded.source === 'recovered') {
    logger.warn('config.recovered', { badPath: loaded.badPath, issues: loaded.issues.length })
  }
  for (const issue of loaded.issues) {
    logger.warn('config.issue', { detail: issue })
  }

  logger.info('shell.config', {
    dataDir,
    port: config.server.port,
    taskConcurrency: config.model.taskConcurrency,
    logLevel: config.log.level,
    injectedPorts: options.ports === undefined ? 0 : Object.keys(options.ports).length,
  })

  // 端口装配（设计落点 `ports/*`）：只经各模块出口调用，模块之间不互相引用
  const ownsStore = options.ports?.store === undefined
  const store = options.ports?.store ?? createStore({ dataDir, clock, logger })
  const ingest =
    options.ports?.ingest ?? createIngestModule({ store, clock, logger, config: ingestConfigOf(config) })
  const extract = options.ports?.extract ?? createExtractModule({ store, clock, logger })
  const social = options.ports?.social ?? createSocialPort(store, logger)
  const ports: ShellPorts = {
    store,
    ingest,
    extract,
    social,
    ...(options.ports?.regen === undefined ? {} : { regen: options.ports.regen }),
  }

  applyEngineConfig(config)

  const boundPort = { value: options.port ?? config.server.port }
  const requestIds = new WeakMap<object, string>()
  const tracker = createOperationTracker(clock)

  const metaOf: MetaOf = (req) => ({
    epoch: currentEpoch(store),
    requestId: requestIds.get(req) ?? randomUUID(),
  })

  const token = options.token ?? createStartupToken()
  const guard = createGuard({ token, origins: () => loopbackOrigins(boundPort.value) }, metaOf)

  /** 统一失败出口：**全部**异常经 `respond.ts` 映射成契约信封（不新增标识、不另造映射）。 */
  const respondFailure = (req: Request, res: Response, error: unknown, scope: string): void => {
    const mapped = mapError(error, scope)
    logUnmapped(logger, error, req, requestIds, mapped.envelope.code)
    res.status(mapped.status).json(failure(metaOf(req), mapped.envelope))
  }

  /** 路由处理器包装：同步异常与 Promise 拒绝都收敛到 `respondFailure`。 */
  const handle = (
    scope: string,
    handler: (req: Request, res: Response) => void | Promise<void>,
  ): RequestHandler => {
    return (req, res, next) => {
      try {
        const result = handler(req, res)
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            if (res.headersSent) next(error)
            else respondFailure(req, res, error, scope)
          })
        }
      } catch (error) {
        if (res.headersSent) next(error)
        else respondFailure(req, res, error, scope)
      }
    }
  }

  const app = express()
  app.disable('x-powered-by')

  // -------------------------------------------------------------------------
  // 入口中间件（顺序：请求标识 → Host → Origin → JSON 体 → 静态资源）
  // -------------------------------------------------------------------------

  app.use((req, res, next) => {
    const requestId = randomUUID()
    requestIds.set(req, requestId)
    const startedAt = clock()
    res.on('finish', () => {
      logger.debug('http.request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: clock() - startedAt,
        requestId,
      })
    })
    next()
  })
  app.use(guard.host)
  app.use(guard.origin)
  app.use(express.json({ limit: '1mb' }) as RequestHandler)

  const webDir = options.webDir ?? defaultWebDir()
  const indexHtml = join(webDir, 'index.html')
  const pageBuilt = existsSync(indexHtml)
  if (pageBuilt) {
    app.use(express.static(webDir, { index: 'index.html' }))
  }

  /**
   * 写操作守卫：`x-mp-token`（`guard.ts` 的 `TOKEN_HEADER`）与页面侧实际发出的
   * `x-messagepick-token`（`src/web/shell/api/token.ts`）当前不一致 —— 两端都已落盘、本文件不改它们，
   * 故在此做一次头名归一（缺省补齐、已给出时不动），守卫口径与状态码不变（403 + `GUARD_STATUS`）。
   */
  const bridgePageToken: RequestHandler = (req, _res, next) => {
    const provided = req.headers[PAGE_TOKEN_HEADER]
    if (typeof provided === 'string' && req.headers[TOKEN_HEADER] === undefined) {
      req.headers[TOKEN_HEADER] = provided
    }
    next()
  }
  const writeGuard: RequestHandler[] = [bridgePageToken, guard.write]

  // -------------------------------------------------------------------------
  // 路由表（mod-004 §4.1；读无令牌、写带令牌 + Host / Origin）
  // -------------------------------------------------------------------------

  // API-002 查询更新状态（直通）
  app.get(
    '/api/update-status',
    handle('update-status', (req, res) => {
      res.json(success(metaOf(req), ingest.status()))
    }),
  )

  // API-001 触发更新（编排：门控 → 登记操作 → 采集）
  app.post(
    '/api/update',
    ...writeGuard,
    handle('update', async (req, res) => {
      const payload = optionalBody(req, 'update')
      const targetSource = bodyEnum(payload, 'targetSource', INGEST_SOURCES, 'update') ?? undefined

      // 门控（决策 3）：二次确认之后（删除等待 / 执行）拒绝新采集；预检与待确认阶段不阻断
      const blocked = updateBlockedReason(tracker, store)
      if (blocked !== null) {
        res.status(GATE_STATUS).json(failure(metaOf(req), shellEnvelope('INVALID_INPUT', blocked, 'update')))
        return
      }

      await runIngest(req, res, targetSource === undefined ? {} : { targetSource })
    }),
  )

  // API-004（实体类型 = 群）群清单读路径（直通；群标识 + 群名，CHG-024）
  app.get(
    '/api/filter-options/groups',
    handle('filter-options:groups', (req, res) => {
      const offsetPage = pageRequestOf(req, 'filter-options:groups')
      const filter: SharedFilter | null = null // 群清单需要全量（删除范围选择与筛选条同源）；无筛选项 = 不限
      res.json(success(metaOf(req), store.read('DM-002', filter, offsetPage)))
    }),
  )

  // API-005 删除预检（编排：不登记操作、不阻断更新）
  app.post(
    '/api/deletions/preflight',
    ...writeGuard,
    handle('deletions:preflight', (req, res) => {
      const scope = deletionScopeOf(req, 'deletions:preflight')
      res.json(success(metaOf(req), store.preflightDeletion(scope)))
    }),
  )

  // API-006 执行删除（编排：二次确认是唯一授权凭证；未确认由模块返回 CONFIRMATION_REQUIRED）
  app.post(
    '/api/deletions',
    ...writeGuard,
    handle('deletions', async (req, res) => {
      const record = bodyRecordBody(req, 'deletions')
      const scope = deletionScopeOf(req, 'deletions')
      const confirmed = bodyBoolean(record, 'confirmed', 'deletions') === true

      if (!confirmed) {
        // 未确认：不登记操作（待确认阶段不阻断更新）、不代模块补齐标记 → 原样透传模块的 CONFIRMATION_REQUIRED
        try {
          await store.executeDeletion(scope, false)
          respondFailure(req, res, new Error('未确认的删除请求不应进入执行路径'), 'deletions')
        } catch (error) {
          respondFailure(req, res, error, 'deletions')
        }
        return
      }

      await runDeletion(req, res, scope)
    }),
  )

  // API-019 + API-029 组装的消息详情（组合；REQ-070 / TASK-036）
  app.get(
    '/api/message-detail/:entryId',
    handle('message-detail', async (req, res) => {
      const entryId = pathParam(req, 'entryId')
      if (entryId.length === 0) throw invalidInput('缺少条目标识', 'message-detail')
      res.json(success(metaOf(req), await assembleDetail(entryId)))
    }),
  )

  // MOD-008 进程内 submitMaterialConsent（编排：转进程内入口；未接线时明确失败）
  app.post(
    '/api/generations/material-consents',
    ...writeGuard,
    handle('generations:material-consents', (req, res) => {
      const regen = requireRegen(ports, 'generations:material-consents', logger)
      const record = bodyRecordBody(req, 'generations:material-consents')
      const items = materialItemsOf(record)
      logger.info('generations.material-consents', { counts: { items: items.length }, requestId: requestIds.get(req) })
      res.json(success(metaOf(req), regen.submitMaterialConsent(items, clock())))
    }),
  )

  // MOD-008 进程内 readArtifact（编排：产物随所属数据删除后 → NOT_FOUND）
  app.get(
    '/api/artifacts/:ref',
    handle('artifacts', (req, res) => {
      const regen = requireRegen(ports, 'artifacts', logger)
      const ref = pathParam(req, 'ref')
      const { bytes, mime } = regen.readArtifact(ref)
      sendBytes(res, bytes, mime)
    }),
  )

  // 媒体通道（按需解密；路径护栏与索引在 MOD-002，失败原样透传其信封）
  app.get(
    '/media/:ref',
    handle('media', (req, res) => {
      const ref = pathParam(req, 'ref')
      const { bytes, mime } = store.openMedia(ref)
      sendBytes(res, bytes, mime)
    }),
  )

  // 进度：SSE + 快照（同一份数据；失败由页面降级 5 s 轮询）
  const sseClients = new Set<Response>()
  const operationsPayload = (): string => JSON.stringify({ operations: tracker.snapshot() })
  const broadcast = (): void => {
    const chunk = `event: snapshot\ndata: ${operationsPayload()}\n\n`
    for (const client of [...sseClients]) {
      try {
        client.write(chunk)
      } catch {
        sseClients.delete(client)
      }
    }
  }
  const unsubscribeBroadcast = tracker.subscribe(broadcast)
  const heartbeat = setInterval(() => {
    for (const client of [...sseClients]) {
      try {
        client.write(': ping\n\n')
      } catch {
        sseClients.delete(client)
      }
    }
  }, 15_000)
  heartbeat.unref()

  app.get(
    '/api/events',
    handle('events', (req, res) => {
      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders()
      res.write(`event: snapshot\ndata: ${operationsPayload()}\n\n`)
      sseClients.add(res)
      req.on('close', () => {
        sseClients.delete(res)
      })
    }),
  )

  app.get(
    '/api/operations',
    handle('operations', (req, res) => {
      res.json(success(metaOf(req), { operations: tracker.snapshot() }))
    }),
  )

  // 本模块自有：配置读写（凭据只写不读回；`model.taskConcurrency` 立即生效）
  app.get(
    '/api/settings',
    handle('settings', (req, res) => {
      res.json(success(metaOf(req), settingsViewOf(config)))
    }),
  )
  app.put(
    '/api/settings',
    ...writeGuard,
    handle('settings', (req, res) => {
      const patch = settingsPatchOf(req)
      applySettings(config, patch)
      saveConfig(dataDir, config)
      level.current = config.log.level
      applyEngineConfig(config)
      logger.info('settings.saved', { fields: Object.keys(patch) })
      res.json(success(metaOf(req), settingsViewOf(config)))
    }),
  )

  // -------------------------------------------------------------------------
  // 静态页面与未命中路由（§6.2：路由 / 资源不存在 → 404）
  // -------------------------------------------------------------------------

  app.use((req, res) => {
    if (req.method === 'GET' && pageBuilt && acceptsHtml(req)) {
      // SPA 落点：页面内路由（引导 / 主界面 / 设置）由前端接管
      res.sendFile(indexHtml)
      return
    }
    if (req.method === 'GET' && !pageBuilt && acceptsHtml(req)) {
      res
        .status(NOT_FOUND_STATUS)
        .type('html')
        .send(
          [
            '<meta charset="utf-8">',
            '<h1>MessagePick</h1>',
            '<p>页面资源尚未构建：请先 <code>npm run build</code>，或开发期用 <code>npm run dev:web</code>（vite）打开页面。</p>',
          ].join('\n'),
        )
      return
    }
    res
      .status(NOT_FOUND_STATUS)
      .json(failure(metaOf(req), shellEnvelope('NOT_FOUND', '请求的路径不存在', 'router')))
  })

  // 未映射异常（含 JSON 体解析失败）：统一走错误信封，细节只进日志
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error)
      return
    }
    if (isBodyParseError(error)) {
      logger.warn('http.body.invalid', { path: req.path, requestId: requestIds.get(req) })
      res
        .status(400)
        .json(failure(metaOf(req), shellEnvelope('INVALID_INPUT', '请求体不是合法的 JSON', 'http:body')))
      return
    }
    const mapped = mapError(error, 'http')
    logUnmapped(logger, error, req, requestIds, mapped.envelope.code)
    res.status(mapped.status).json(failure(metaOf(req), mapped.envelope))
  })

  // -------------------------------------------------------------------------
  // 编排（设计落点 `orchestration/*`）：更新 / 删除 / 详情
  // -------------------------------------------------------------------------

  /** 本次采集的收尾 promise（删除的「等待采集」据此排队；详设 §1.2 / 决策 3）。 */
  let ingestRun: Promise<void> = Promise.resolve()
  /** 上一轮 ingest 操作 id（进度事件归属用）。 */
  let ingestOperationId: string | null = null

  const unsubscribeProgress = ingest.progress.subscribe((event) => {
    if (ingestOperationId === null || event.kind !== 'run') return
    // 运行开始：登记来源总数；`done` 以本次运行结束时的分来源结果为准（不猜中间态）
    if (event.phase === 'start') {
      tracker.update(ingestOperationId, { state: 'running', counts: { done: 0, total: event.sources.length } })
    }
  })

  async function runIngest(req: Request, res: Response, request: Api001Request): Promise<void> {
    const scope: string = request.targetSource ?? '全部来源'
    const id = tracker.start({ kind: 'ingest', scope })
    ingestOperationId = id
    tracker.update(id, { state: 'running' })

    const run = (async () => {
      try {
        const outcome = await ingest.trigger(request)
        const done = outcome.report.sources.filter((source) => source.status === 'succeeded').length
        const total = outcome.report.sources.length
        if (outcome.ok) {
          tracker.update(id, { state: 'succeeded', counts: { done, total } })
        } else {
          tracker.update(id, {
            state: done > 0 ? 'partial' : 'failed',
            counts: { done, total },
            error: outcome.error,
          })
        }
        // 采集会推进 dataEpoch：同步引擎注册表（详设 §3.3 / 引擎 §5.3）
        notifyDataEpoch(currentEpoch(store))
        if (outcome.ok) {
          res.json(success(metaOf(req), outcome.data))
        } else {
          respondFailure(req, res, outcome.error, 'update')
        }
      } catch (error) {
        tracker.update(id, { state: 'failed', error: envelopeOfUnknown(error, 'update') })
        respondFailure(req, res, error, 'update')
      } finally {
        ingestOperationId = null
      }
    })()

    ingestRun = run.then(
      () => undefined,
      () => undefined,
    )
    await run
  }

  async function runDeletion(req: Request, res: Response, scope: DeletionScope): Promise<void> {
    const id = tracker.start({ kind: 'deletion', scope: scope.kind === 'group' ? `群 ${scope.groupId}` : '全量' })

    // 采集进行中：先置等待态，采集收尾后再执行（页面显示等待态，详设 §1.2）
    if (ingest.isRunning()) {
      tracker.update(id, { state: 'queued' })
      logger.info('deletion.waiting-ingest', { requestId: requestIds.get(req) })
      await ingestRun
    }
    tracker.update(id, { state: 'running' })

    try {
      const result = await store.executeDeletion(scope, true)
      tracker.update(id, { state: 'succeeded' })
      notifyDataEpoch(currentEpoch(store))
      logger.info('deletion.done', {
        scope: scope.kind === 'group' ? `group:${scope.groupId}` : 'all',
        counts: { items: result.items.length },
        requestId: requestIds.get(req),
      })
      res.json(success(metaOf(req), result))
    } catch (error) {
      tracker.update(id, { state: 'failed', error: envelopeOfUnknown(error, 'deletions') })
      respondFailure(req, res, error, 'deletions')
    }
  }

  /**
   * 详情组装：并行取数、失败隔离（mod-004 §4.6 / 决策 5）。
   *
   * - `API-019` 失败：按模块口径原样冒泡（`NOT_FOUND` / `ANALYSIS_FAILED` / `TIMEOUT`）；
   * - `API-029` 失败 / 超时 → `hintStatus='degraded'`，正文照常；`NO_DATA` → 不显示提示、不弹错误。
   */
  async function assembleDetail(entryId: string): Promise<DetailPayload> {
    const detail = await extract.queryMessageDetail({ entryId })
    const memberIds = memberIdsOf(detail)
    if (memberIds.length === 0) return { detail, hints: [], hintStatus: 'ok' }
    try {
      const response = await social.getInterestHints({ memberIds })
      return { detail, hints: [...response.hints], hintStatus: 'ok' }
    } catch (error) {
      const envelope = mapError(error, 'social:API-029').envelope
      if (envelope.code === 'NO_DATA') return { detail, hints: [], hintStatus: 'ok' }
      logger.warn('detail.hints.degraded', { code: envelope.code, scope: envelope.scope })
      return { detail, hints: [], hintStatus: 'degraded' }
    }
  }

  // -------------------------------------------------------------------------
  // 释放
  // -------------------------------------------------------------------------

  const dispose = (): void => {
    clearInterval(heartbeat)
    unsubscribeBroadcast()
    unsubscribeProgress()
    for (const client of [...sseClients]) {
      try {
        client.end()
      } catch {
        // 断连不影响退出
      }
    }
    sseClients.clear()
    tracker.clear()
    if (ownsStore) store.close()
    shutdownEngine()
  }

  return {
    app,
    config,
    token,
    dataDir,
    ports,
    logger,
    pageBuilt,
    setBoundPort(port) {
      boundPort.value = port
    },
    dispose,
  }
}

// ---------------------------------------------------------------------------
// 启动（详设决策 9：选端口 → 启服务 → 打开带令牌页面）
// ---------------------------------------------------------------------------

/** 选端口 → 启服务；返回的 `pageUrl` 已带启动令牌 fragment。 */
export async function startShell(options: ShellAppOptions = {}): Promise<ShellServer> {
  const shell = createShellApp(options)
  const requested = options.port ?? shell.config.server.port

  let server: Server
  try {
    server = await listen(shell.app, requested)
  } catch (error) {
    shell.dispose()
    throw error
  }

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : requested
  shell.setBoundPort(port)

  shell.logger.info('shell.started', { port, dataDir: shell.dataDir, pageBuilt: shell.pageBuilt })

  return {
    port,
    host: LOOPBACK_HOST,
    url: `http://${LOOPBACK_HOST}:${port}/`,
    pageUrl: `http://${LOOPBACK_HOST}:${port}/#token=${shell.token}`,
    token: shell.token,
    dataDir: shell.dataDir,
    pageBuilt: shell.pageBuilt,
    config: shell.config,
    async close() {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose())
        server.closeAllConnections()
      })
      shell.dispose()
    },
  }
}

/** 监听回环（端口 0 = 由系统选空闲端口；`EADDRINUSE` 等错误原样上抛给启动脚本）。 */
function listen(app: Express, port: number): Promise<Server> {
  return new Promise<Server>((resolveListen, rejectListen) => {
    const server = app.listen(port, LOOPBACK_HOST)
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      rejectListen(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      // 运行期监听异常（不常见）：记标准错误，不吞、也不改退出码（服务自行判定）
      server.on('error', (error: Error) => {
        process.stderr.write(`服务监听异常：${error.message}\n`)
      })
      resolveListen(server)
    }
    server.once('error', onError)
    server.once('listening', onListening)
  })
}

/**
 * 打开浏览器（best-effort；失败不影响服务）。三平台命令：`xdg-open` / `open` / `cmd start`。
 */
export function openPage(url: string): boolean {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 组装辅助（保持路由处理器只做「取值 → 调端口 → 出信封」）
// ---------------------------------------------------------------------------

/** 端口装配：MOD-007 的进程内索引 / 构建流水线 / 查询层共用同一实例（mod-007 §3.1）。 */
function createSocialPort(store: Store, logger: ShellLogger): SocialProfileApi {
  const index = new SocialIndex()
  const pipeline = createProfileBuildPipeline({ store, index, logger })
  return createSocialProfileApi({ store, index, pipeline, logger })
}

/** 模块一配置灌入（详设 §7 的相关键；`sessionLimit` / `listLimit` 用模块内默认值）。 */
function ingestConfigOf(config: ShellConfig): {
  cliCommandMs: number
  maxAttempts: number
  pageSize: number
  cliExecutable: string
  cliStateDir: string
} {
  return {
    cliCommandMs: config.timeouts.cliCommandMs,
    maxAttempts: config.retry.maxAttempts,
    pageSize: config.ingest.pageSize,
    cliExecutable: config.cli.executable,
    cliStateDir: config.cli.stateDir,
  }
}

/** 引擎配置（详设 §7：`model.*` / `timeouts.modelCallMs` / `retry.maxAttempts`；立即可配项）。 */
function applyEngineConfig(config: ShellConfig): void {
  configureEngine({
    model: {
      baseUrl: config.model.baseUrl,
      apiKey: config.model.apiKey,
      taskConcurrency: config.model.taskConcurrency,
    },
    timeouts: { modelCallMs: config.timeouts.modelCallMs },
    retry: { maxAttempts: config.retry.maxAttempts },
  })
}

/** 枚举未知异常的信封（登记用；映射本身仍只走 `respond.ts`）。 */
function envelopeOfUnknown(error: unknown, scope: string): ErrorEnvelope {
  return mapError(error, scope).envelope
}

function currentEpoch(store: Store): number {
  try {
    return store.currentEpoch()
  } catch {
    return 0
  }
}

/** 取 JSON 体（空体 = 空对象；非对象抛 `INVALID_INPUT`）。 */
function optionalBody(req: Request, scope: string): Record<string, unknown> {
  const raw = req.body as unknown
  if (raw === undefined || raw === null || raw === '') return {}
  return bodyRecord(raw, scope)
}

/** 路径参数（Express 的 params 值可能是字符串数组：取首个非空值）。 */
function pathParam(req: Request, name: string): string {
  return queryFirst(req.params[name]) ?? ''
}

/** 取 JSON 体（必须存在且为对象）。 */
function bodyRecordBody(req: Request, scope: string): Record<string, unknown> {
  return bodyRecord(req.body as unknown, scope)
}

function pageRequestOf(req: Request, scope: string) {
  const page = queryInt(req.query['page'], 'page', scope)
  const pageSize = queryInt(req.query['pageSize'], 'pageSize', scope)
  return { page, pageSize }
}

/** 删除范围结构校验（闭集内 `INVALID_INPUT`；不做业务判断）。 */
function deletionScopeOf(req: Request, scope: string): DeletionScope {
  const record = optionalBody(req, scope)['scope']
  const body = bodyRecord(record === undefined ? {} : record, scope)
  const kind = bodyEnum(body, 'kind', ['all', 'group'] as const, scope)
  if (kind === 'all') return { kind: 'all' }
  if (kind === 'group') {
    const groupId = bodyString(body, 'groupId', scope)
    if (groupId === null) throw invalidInput('缺少必填字段 groupId', scope, { field: 'groupId' })
    return { kind: 'group', groupId }
  }
  throw invalidInput('删除范围取值不在闭集内', scope, { field: 'kind', allowed: ['all', 'group'] })
}

/** 素材确认清单结构校验（逐条只校验结构，不解释素材语义）。 */
function materialItemsOf(record: Record<string, unknown>): MaterialItem[] {
  const scope = 'generations:material-consents'
  const raw = record['items']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw invalidInput('字段 items 需为非空数组', scope, { field: 'items' })
  }
  return raw.map((item, index) => {
    const entry = bodyRecord(item, scope)
    const kind = bodyString(entry, 'kind', scope)
    const ref = bodyString(entry, 'ref', scope)
    if (kind === null) throw invalidInput(`items[${index}] 缺少 kind`, scope, { index, field: 'kind' })
    if (ref === null) throw invalidInput(`items[${index}] 缺少 ref`, scope, { index, field: 'ref' })
    return {
      kind: kind as MaterialItem['kind'],
      ref,
      memberRef: bodyString(entry, 'memberRef', scope) ?? undefined,
      originMsgRef: bodyString(entry, 'originMsgRef', scope) ?? undefined,
      slotId: bodyString(entry, 'slotId', scope) ?? undefined,
    }
  })
}

/** 设置补丁结构校验 + 边界（详设 §7：并发 1–8；凭据值可为空串 = 清除）。 */
function settingsPatchOf(req: Request): SettingsPatch {
  const scope = 'settings'
  const record = optionalBody(req, scope)
  const patch: SettingsPatch = {}

  const modelRaw = record['model']
  if (modelRaw !== undefined && modelRaw !== null) {
    const model = bodyRecord(modelRaw, `${scope}.model`)
    const next: NonNullable<SettingsPatch['model']> = {}
    if (model['baseUrl'] !== undefined) next.baseUrl = bodyString(model, 'baseUrl', scope) ?? ''
    if (model['apiKey'] !== undefined) next.apiKey = bodyString(model, 'apiKey', scope) ?? ''
    const concurrency = bodyInt(model, 'taskConcurrency', scope)
    if (concurrency !== null) {
      if (concurrency < 1 || concurrency > 8) {
        throw invalidInput('model.taskConcurrency 需在 1–8 之间', scope, { field: 'taskConcurrency', min: 1, max: 8 })
      }
      next.taskConcurrency = concurrency
    }
    patch.model = next
  }

  const ingestRaw = record['ingest']
  if (ingestRaw !== undefined && ingestRaw !== null) {
    const ingest = bodyRecord(ingestRaw, `${scope}.ingest`)
    const autoTrigger = bodyBoolean(ingest, 'autoTriggerAfterIngest', scope)
    if (autoTrigger !== null) patch.ingest = { autoTriggerAfterIngest: autoTrigger }
  }

  const logRaw = record['log']
  if (logRaw !== undefined && logRaw !== null) {
    const log = bodyRecord(logRaw, `${scope}.log`)
    const level = bodyEnum(log, 'level', LOG_LEVEL_OPTIONS, scope)
    if (level !== null) {
      // 详设 §7 的闭集为 error / warn / info / debug；设置页展示名由页面侧映射
      patch.log = { level }
    }
  }

  return patch
}

/** 补丁并入配置（只改补丁给出的键；`server.port` 不在补丁面内 = 下次启动生效）。 */
function applySettings(config: ShellConfig, patch: SettingsPatch): void {
  if (patch.model?.baseUrl !== undefined) config.model.baseUrl = patch.model.baseUrl
  if (patch.model?.apiKey !== undefined) config.model.apiKey = patch.model.apiKey
  if (patch.model?.taskConcurrency !== undefined) config.model.taskConcurrency = patch.model.taskConcurrency
  if (patch.ingest?.autoTriggerAfterIngest !== undefined) {
    config.ingest.autoTriggerAfterIngest = patch.ingest.autoTriggerAfterIngest
  }
  if (patch.log?.level !== undefined) config.log.level = patch.log.level
}

/** 更新入口阻断原因（`null` = 可用；决策 3：二次确认之后的删除等待 / 执行期间拒绝）。 */
function updateBlockedReason(tracker: OperationTracker, store: Store): string | null {
  if (tracker.hasActive('deletion')) return '删除进行中'
  if (store.deleteGate.isDeleting()) return '删除进行中'
  return null
}

/** 取 MOD-008 入口；未接线时给出明确失败（不伪造成功、不深挖模块子目录）。 */
function requireRegen(ports: ShellPorts, route: string, logger: ShellLogger): RegenPort {
  if (ports.regen !== undefined) return ports.regen
  logger.error('shell.not-wired', { route, module: 'MOD-008' })
  throw new Error(`MOD-008 入口未接线（${route}）：regen/index.ts 尚未导出该进程内入口`)
}

/** 字节响应（媒体 / 产物共用；本地个人数据不落浏览器缓存）。 */
function sendBytes(res: Response, bytes: Uint8Array, mime: string): void {
  res.setHeader('Content-Type', mime)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(Buffer.from(bytes))
}

/** 未映射异常的内部细节只进日志（详设 §2.2；不把 message 给使用者）。 */
function logUnmapped(
  logger: ShellLogger,
  error: unknown,
  req: Request,
  requestIds: WeakMap<object, string>,
  code: string,
): void {
  if (!isUnmapped(error)) return
  logger.error('http.unmapped', {
    path: req.path,
    code,
    detail: error instanceof Error ? error.message : String(error),
    requestId: requestIds.get(req),
  })
}

function isBodyParseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'SyntaxError' && 'status' in error && (error as { status?: number }).status === 400
}

function acceptsHtml(req: Request): boolean {
  const accept = req.headers.accept
  return typeof accept === 'string' && accept.includes('text/html')
}
