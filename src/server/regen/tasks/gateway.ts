/**
 * 经 `API-007` / `API-008` 的任务网关与自动重试（mod-008 §3.1「tasks/」、详设 §2.3）。
 *
 * - 一切模型调用经本网关；模块内不出现模型地址、凭据与 SDK 调用点（§2 实现侧硬边界）；
 * - 默认实现绑定 `MOD-003` 的进程级引擎（动态 import：测试注入替身时不加载引擎）；
 * - 任务失败 / 超时按 §6 映射为 `ANALYSIS_FAILED` / `TIMEOUT`，并携带任务引用
 *   （`scope = task:<ref>`，外壳可凭它经 `API-008` 重试）；
 * - 「生成」在可自动重试场景内：本层先按详设 §2.3 自动重试，重试仍失败才上抛。
 */

import type { Api007Request, ErrorEnvelope, SourceRef, TaskOutcome, TaskRef, TaskResult } from '@shared'

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_JITTER_RATIO,
  RETRY_MAX_DELAY_MS,
} from '../constants'
import { failAnalysis, failTimeout } from '../errors'

/** 任务执行与重试的最小接口（测试注入桩，不真调模型 / 不联网）。 */
export interface TaskGateway {
  /** `API-007`：执行任务。 */
  execute(req: Api007Request): Promise<TaskOutcome>
  /** `API-008`：按任务引用重试失败 / 超时的任务。 */
  retry(taskRef: TaskRef): Promise<TaskOutcome>
}

const TASK_SCOPE_PREFIX = 'task:'

/** 从失败 / 超时的错误信封取回任务引用（`MOD-003` 约定的 `scope = task:<ref>`）。 */
export function taskRefFromEnvelope(error: ErrorEnvelope): TaskRef | null {
  if (typeof error.scope !== 'string' || !error.scope.startsWith(TASK_SCOPE_PREFIX)) return null
  const ref = error.scope.slice(TASK_SCOPE_PREFIX.length)
  return ref.length > 0 ? ref : null
}

let engineModule: Promise<typeof import('@server/engine')> | null = null

function loadEngine(): Promise<typeof import('@server/engine')> {
  engineModule ??= import('@server/engine')
  return engineModule
}

/** 绑定 `MOD-003` 进程级引擎的默认网关（动态 import，保持模块边界清晰）。 */
export function createEngineTaskGateway(): TaskGateway {
  return {
    execute: async (req) => {
      const engine = await loadEngine()
      return engine.executeTask(req)
    },
    retry: async (taskRef) => {
      const engine = await loadEngine()
      return engine.retryTask(taskRef)
    },
  }
}

/** 成功的任务结果（`TaskOutcome` 成功分支的窄化形态）。 */
export interface TaskSuccess {
  result: TaskResult
  sourceRefs: SourceRef[]
  taskRef: TaskRef
}

/** 任务执行选项（自动重试次数与休眠可注入；默认取 `constants.ts`）。 */
export interface TaskRunOptions {
  /** 总尝试次数（首次 + 自动重试；默认 `1 + AUTO_RETRY_MAX_ATTEMPTS`） */
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  /** 抖动源（默认 `Math.random`） */
  jitter?: () => number
}

/**
 * 执行任务并吸收技术重试：失败 / 超时（带任务引用）时按退避自动重试，
 * 重试仍失败则按 §6 抛出（`ANALYSIS_FAILED` / `TIMEOUT`，scope 携带任务引用）。
 */
export async function runTask(
  gateway: TaskGateway,
  request: Api007Request,
  options: TaskRunOptions = {},
): Promise<TaskSuccess> {
  const attempts = Math.max(1, options.attempts ?? AUTO_RETRY_MAX_ATTEMPTS + 1)
  const sleep = options.sleep ?? defaultSleep
  const jitter = options.jitter ?? Math.random

  let outcome: TaskOutcome
  try {
    outcome = await gateway.execute(request)
  } catch (error) {
    taskFailure('任务执行异常', 'ANALYSIS_FAILED', null, error)
  }

  let attempt = 1
  while (!outcome.ok && attempt < attempts) {
    const taskRef = taskRefFromEnvelope(outcome.error)
    if (taskRef === null || !isRetryable(outcome.error)) break
    await sleep(backoffDelayMs(attempt, jitter))
    attempt += 1
    try {
      outcome = await gateway.retry(taskRef)
    } catch (error) {
      taskFailure('任务重试异常', 'ANALYSIS_FAILED', taskRef, error)
    }
  }

  if (outcome.ok) return outcome
  const taskRef = taskRefFromEnvelope(outcome.error)
  const code = outcome.error.code === 'TIMEOUT' ? 'TIMEOUT' : 'ANALYSIS_FAILED'
  taskFailure(outcome.error.message, code, taskRef, null)
}

/** 只对可恢复的失败自动重试（`ANALYSIS_FAILED` / `TIMEOUT`）。 */
function isRetryable(error: ErrorEnvelope): boolean {
  return error.code === 'ANALYSIS_FAILED' || error.code === 'TIMEOUT'
}

/** 任务失败 → 契约信封（携带任务引用，供经 `API-008` 重试）。 */
function taskFailure(
  message: string,
  code: 'ANALYSIS_FAILED' | 'TIMEOUT',
  taskRef: TaskRef | null,
  cause: unknown,
): never {
  const context: Record<string, unknown> = {}
  if (cause !== null && cause !== undefined) {
    context.cause = cause instanceof Error ? cause.message : String(cause)
  }
  if (code === 'TIMEOUT') {
    failTimeout(message, { taskRef: taskRef ?? undefined, context })
  }
  failAnalysis(message, { taskRef: taskRef ?? undefined, context })
}

/** 任务退避（1 s → 2 s → 4 s，上限 30 s，±20% 抖动；详设 §2.3）。 */
export function backoffDelayMs(attempt: number, jitter: () => number): number {
  const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1))
  const ratio = 1 + (jitter() * 2 - 1) * RETRY_JITTER_RATIO
  return Math.max(0, Math.round(base * ratio))
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
