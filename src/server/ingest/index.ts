/**
 * MOD-001 数据接入与更新 —— 模块出口与装配（mod-001 §3.1「index.ts」、§3.2、§4）。
 *
 * 对外只暴露 `API-001` / `API-002` 的实现与装配工厂；`ingest/` 下其它文件不得被其他模块 import。
 * 组合根（`MOD-004`）的接线方式：
 *
 * ```ts
 * import { createIngestModule } from '@server/ingest'
 *
 * const ingest = createIngestModule({ store, config: { cliExecutable, cliStateDir } })
 * ingest.trigger({ targetSource: '群消息' })   // API-001（分来源结果 + 批次级错误信封）
 * ingest.status()                              // API-002（是否有数据 / 记录更新至 X / 来源状态 / 当前用户）
 * ingest.isRunning()                           // 删除门接线（详设 §1.2）
 * ingest.progress.subscribe((event) => …)      // 运行进度（SSE 传输在 MOD-004）
 * ```
 *
 * 依赖方向（§3.1）：`cli/` ← `sources/` ← `run/` ← `api/` ← 本文件；本文件只做装配，不含业务逻辑。
 */

import type { Api001Request, IngestSource, UpdateStatus } from '@shared'

import type { Store } from '@server/store'

import { type TriggerUpdateOutcome, createTriggerUpdate } from './api/trigger-update'
import { createUpdateStatus } from './api/update-status'
import { createParsePool } from './cli/pool'
import type { ParseRunner } from './cli/parse'
import { createRetryPolicy, RetryBreaker } from './cli/retry'
import { createCliRunner, type CliRunner } from './cli/runner'
import type { IngestLogger } from './errors'
import { createIngestExecutor, type IngestExecutor } from './run/executor'
import { createIngestProgress, type IngestProgressChannel } from './run/progress'
import { createContactsAdapter } from './sources/contacts'
import { createGroupMessagesAdapter } from './sources/group-messages'
import type { SourceAdapter } from './sources/source'

// ---------------------------------------------------------------------------
// 配置（详设 §7 的相关键 + 模块内常量）
// ---------------------------------------------------------------------------

/** 模块配置：外壳把 `config.json` 的 `cli.*` / `timeouts.cliCommandMs` / `retry.maxAttempts` / `ingest.pageSize` 灌进来。 */
export interface IngestConfig {
  /** 单条 CLI 命令超时（`timeouts.cliCommandMs`，默认 120000） */
  cliCommandMs: number
  /** 自动重试次数上限（`retry.maxAttempts`，默认 3；0 = 关闭自动重试） */
  maxAttempts: number
  /** 采集分页大小（`ingest.pageSize`，默认 1000） */
  pageSize: number
  /** CLI 可执行文件（`cli.executable`；空 = 自动解析环境变量与默认入口） */
  cliExecutable: string
  /** CLI 状态目录（`cli.stateDir`；空 = CLI 自己的默认） */
  cliStateDir: string
  /** `sessions` 条数上限（群清单与私聊好友列表；模块内常量，未分配配置键） */
  sessionLimit: number
  /** `contacts` 条数上限（模块内常量，未分配配置键） */
  listLimit: number
}

/** 配置默认值（详设 §7 + 模块内常量）。 */
export const DEFAULT_INGEST_CONFIG: IngestConfig = {
  cliCommandMs: 120_000,
  maxAttempts: 3,
  pageSize: 1_000,
  cliExecutable: '',
  cliStateDir: '',
  sessionLimit: 200,
  listLimit: 1_000,
}

/** 配置局部覆盖。 */
export type IngestConfigPatch = Partial<IngestConfig>

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

export interface IngestModuleOptions {
  /** `MOD-002` 门面（唯一读写通道；本模块不打开数据库） */
  store: Store
  /** CLI 运行器（测试注入替身；缺省 = 真实子进程，入口见 `cli/runner.ts`） */
  runner?: CliRunner
  /** 解析执行器（缺省 = worker 池；小输出内联） */
  parse?: ParseRunner
  /** 进程内时钟（测试注入） */
  clock?: () => number
  /** 退避等待（测试注入空实现，不真等） */
  sleep?: (ms: number) => Promise<void>
  logger?: IngestLogger
  /** 配置覆盖（部分给出即可） */
  config?: IngestConfigPatch
}

/** 模块出口（`MOD-004` 只依赖这些成员）。 */
export interface IngestModule {
  /** `API-001` 触发更新：按来源采集 / 重试，返回分来源结果与批次级错误信封 */
  trigger(req: Api001Request): Promise<TriggerUpdateOutcome>
  /** `API-002` 查询更新状态：只读、幂等、无缓存（`STORAGE_UNAVAILABLE` 原样冒泡） */
  status(): UpdateStatus
  /** 运行槽是否被占用（含 FIFO 排队；删除门接线用） */
  isRunning(): boolean
  /** 单飞执行器（合流 / 排队语义；供组合根登记与分项呈现） */
  readonly executor: IngestExecutor
  /** 进度通道（订阅运行 / 来源级事件） */
  readonly progress: IngestProgressChannel
}

/**
 * 创建模块实例（一个进程一个实例；来源适配器集合封闭为两个来源，无演示数据通道）。
 */
export function createIngestModule(options: IngestModuleOptions): IngestModule {
  const config: IngestConfig = { ...DEFAULT_INGEST_CONFIG, ...(options.config ?? {}) }
  const clock = options.clock ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const logger = options.logger

  const runner = options.runner ?? createCliRunner({ executable: config.cliExecutable, stateDir: config.cliStateDir })
  const parse = options.parse ?? createParsePool()
  const policy = createRetryPolicy(config.maxAttempts)
  const breaker = new RetryBreaker(policy)
  const shared = {
    store: options.store,
    runner,
    parse,
    policy,
    breaker,
    sleep,
    clock,
    timeoutMs: config.cliCommandMs,
    ...(logger === undefined ? {} : { logger }),
  }

  // 来源适配器恰两个：群消息、通讯录与好友列表（REQ-001 / REQ-019；不存在第三来源与演示通道）
  const adapters: Readonly<Record<IngestSource, SourceAdapter>> = {
    群消息: createGroupMessagesAdapter({ ...shared, pageSize: config.pageSize, sessionLimit: config.sessionLimit }),
    通讯录与好友列表: createContactsAdapter({ ...shared, listLimit: config.listLimit }),
  }

  const progress = createIngestProgress()
  const executor = createIngestExecutor({
    store: options.store,
    adapters,
    clock,
    progress,
    ...(logger === undefined ? {} : { logger }),
  })
  const trigger = createTriggerUpdate({ executor })
  const status = createUpdateStatus({ store: options.store })

  return {
    trigger,
    status,
    isRunning: () => executor.isRunning(),
    executor,
    progress,
  }
}

// ---------------------------------------------------------------------------
// 再导出（契约类型与声明面；实现细节不外泄）
// ---------------------------------------------------------------------------

export { createIngestExecutor, createIngestProgress }
export type { TriggerUpdateOutcome } from './api/trigger-update'
export type { IngestExecutor, RunReport, RunRequest } from './run/executor'
export type { IngestProgressChannel, IngestProgressEvent } from './run/progress'
export type { IngestLogger } from './errors'
export type {
  CollectContext,
  CollectOutcome,
  SourceAdapter,
  SourceCheckpoint,
  SourceProgress,
  SourceStatus,
} from './sources/source'
export type { CliRunner } from './cli/runner'
export type {
  Api001Request,
  Api001Response,
  Api002Response,
  IngestSource,
  IngestSourceStatus,
  UpdateStatus,
} from '@shared'
