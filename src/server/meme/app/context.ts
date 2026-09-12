/**
 * 模块依赖组装（mod-005 §3.1「index.ts：组装依赖（存储网关、引擎网关、时钟）」）。
 *
 * 全部可注入点集中在此：存储端口、引擎网关、时钟、日志、阈值覆盖、重试策略、标识工厂、
 * 大结果集聚合选项。测试据此注入替身（MOD-002 / MOD-003 全 mock，不真调存储与模型）。
 */

import { randomUUID } from 'node:crypto'

import type { Id } from '@shared'

import {
  AGG_WORKER_THRESHOLD,
  AUTO_RETRY_BASE_DELAY_MS,
  AUTO_RETRY_JITTER_RATIO,
  AUTO_RETRY_MAX_ATTEMPTS,
  AUTO_RETRY_MAX_DELAY_MS,
  ESSENCE_CANDIDATE_MESSAGES,
  ESSENCE_ITEMS_PER_BATCH_MAX,
  READ_HARD_CAP,
  RECOGNIZE_WINDOW_MESSAGES,
} from '../constants'
import { createEngineGateway, type AnalysisGateway } from '../engine/analysisGateway'
import type { MemeStore } from '../store/memeStore'
import type { AggregateOptions } from '../worker/aggregate'

/** 结构化日志口（字段口径对齐详设 §6.1；不记消息正文）。 */
export interface MemeLogger {
  debug?(event: string, fields?: Record<string, unknown>): void
  info?(event: string, fields?: Record<string, unknown>): void
  warn?(event: string, fields?: Record<string, unknown>): void
  error?(event: string, fields?: Record<string, unknown>): void
}

/** 模块阈值（默认值来自 `constants.ts`；测试可局部缩小）。 */
export interface MemeLimits {
  readHardCap: number
  aggregateWorkerThreshold: number
  recognizeWindowMessages: number
  essenceCandidateMessages: number
  essenceItemsPerBatchMax: number
}

/** 后台分项自动重试策略（详设 §2.3）。 */
export interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
  sleep(ms: number): Promise<void>
  random(): number
}

/** 解析后的依赖集合。 */
export interface MemeDeps {
  store: MemeStore
  gateway: AnalysisGateway
  clock: () => number
  logger: MemeLogger
  limits: MemeLimits
  retry: RetryPolicy
  newId: (prefix: string) => Id
  aggregate: AggregateOptions
}

/** 模块装配选项。 */
export interface MemeDepsOptions {
  store: MemeStore
  gateway?: AnalysisGateway
  clock?: () => number
  logger?: MemeLogger
  limits?: Partial<MemeLimits>
  retry?: Partial<Omit<RetryPolicy, 'sleep' | 'random'>> & { sleep?: RetryPolicy['sleep']; random?: RetryPolicy['random'] }
  newId?: (prefix: string) => Id
  aggregate?: AggregateOptions
}

/** 解析依赖（缺省值集中在这里；不读配置文件、不自行建连）。 */
export function resolveDeps(options: MemeDepsOptions): MemeDeps {
  const logger = options.logger ?? {}
  const limits: MemeLimits = {
    readHardCap: READ_HARD_CAP,
    aggregateWorkerThreshold: AGG_WORKER_THRESHOLD,
    recognizeWindowMessages: RECOGNIZE_WINDOW_MESSAGES,
    essenceCandidateMessages: ESSENCE_CANDIDATE_MESSAGES,
    essenceItemsPerBatchMax: ESSENCE_ITEMS_PER_BATCH_MAX,
    ...(options.limits ?? {}),
  }
  const retryOptions = options.retry ?? {}
  const retry: RetryPolicy = {
    maxAttempts: retryOptions.maxAttempts ?? AUTO_RETRY_MAX_ATTEMPTS,
    baseDelayMs: retryOptions.baseDelayMs ?? AUTO_RETRY_BASE_DELAY_MS,
    maxDelayMs: retryOptions.maxDelayMs ?? AUTO_RETRY_MAX_DELAY_MS,
    jitterRatio: retryOptions.jitterRatio ?? AUTO_RETRY_JITTER_RATIO,
    sleep: retryOptions.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: retryOptions.random ?? Math.random,
  }
  return {
    store: options.store,
    gateway: options.gateway ?? createEngineGateway(),
    clock: options.clock ?? Date.now,
    logger,
    limits,
    retry,
    newId: options.newId ?? ((prefix) => `${prefix}_${randomUUID()}`),
    aggregate: { threshold: limits.aggregateWorkerThreshold, onWarn: logger.warn?.bind(logger), ...(options.aggregate ?? {}) },
  }
}

/** 当前时刻（经注入时钟）。 */
export function now(deps: MemeDeps): Date {
  return new Date(deps.clock())
}
