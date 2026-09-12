/**
 * CLI 命令的自动重试、退避与轻量熔断（mod-001 §4.1「重试」、详设 §2.3）。
 *
 * - 退避：指数 `1s → 2s → 4s`、上限 30s、叠加 ±20% 抖动；次数上限 = `retry.maxAttempts`（默认 3）。
 * - 熔断：同一目标连续 5 次可重试失败 → 暂停该目标的自动重试 60s（手动重试不受限）。
 * - 本文件同时是**退出码 / 输出异常 → 错误标识**的唯一映射点（§6.1 表）：
 *   `1 → NO_AUTH`（未初始化 / 密钥不匹配，不重试）、`2 → SOURCE_UNAVAILABLE`（参数非法，重放不会成功）、
 *   其他非零 / 输出非法 → `SOURCE_UNAVAILABLE`（可重试）、超时 → `TIMEOUT`（可重试）。
 * - 不读残缺输出：超时由 `runner` 终止子进程并置 `timedOut`（详设 §1.4）。
 */

import { failure, type IngestFailure } from '../errors'
import type { CliResult, CliRunner } from './runner'
import { OutputInvalidError, type ParseRunner } from './parse'

/** 命令级状态（与 `API-001` 出参枚举一一对应）。 */
export type CommandStatus = 'succeeded' | 'failed' | 'noAuth' | 'timeout'

/** 自动重试策略。 */
export interface RetryPolicy {
  /** 自动重试次数上限（不含首次执行） */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  /** 同一目标连续可重试失败达到该次数 → 开熔断 */
  breakerFailures: number
  breakerCooldownMs: number
}

/** 默认策略（详设 §2.3 / §7）。 */
export function createRetryPolicy(maxAttempts: number): RetryPolicy {
  return {
    maxAttempts: Math.max(0, Math.trunc(maxAttempts)),
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    breakerFailures: 5,
    breakerCooldownMs: 60_000,
  }
}

/** 熔断器：按目标（命令 + 群）记连续失败，冷却期内跳过自动重试。 */
export class RetryBreaker {
  private readonly state = new Map<string, { failures: number; openedAt: number | null }>()

  constructor(private readonly policy: Pick<RetryPolicy, 'breakerFailures' | 'breakerCooldownMs'>) {}

  /** 冷却期内 → true（跳过自动重试）。手动重试由调用方直接执行，不经过此判定。 */
  shouldSkip(key: string, now: number): boolean {
    const entry = this.state.get(key)
    if (entry === undefined || entry.openedAt === null) return false
    if (now - entry.openedAt >= this.policy.breakerCooldownMs) {
      this.state.delete(key)
      return false
    }
    return true
  }

  recordFailure(key: string, now: number): void {
    const entry = this.state.get(key) ?? { failures: 0, openedAt: null }
    entry.failures += 1
    if (entry.failures >= this.policy.breakerFailures && entry.openedAt === null) entry.openedAt = now
    this.state.set(key, entry)
  }

  recordSuccess(key: string): void {
    this.state.delete(key)
  }
}

/** 命令成功（解析后的结果）。 */
export interface CommandSuccess<T> {
  ok: true
  value: T
  attempts: number
  durationMs: number
}

/** 命令失败（终态）。 */
export interface CommandFailure {
  ok: false
  status: CommandStatus
  failure: IngestFailure
  attempts: number
  durationMs: number
}

export type CommandOutcome<T> = CommandSuccess<T> | CommandFailure

export interface CliCommandDeps {
  runner: CliRunner
  parse: ParseRunner
  policy: RetryPolicy
  breaker: RetryBreaker
  /** 退避等待（测试注入空实现，不真等） */
  sleep: (ms: number) => Promise<void>
  clock: () => number
  /** 抖动源（默认 `Math.random`） */
  random?: () => number
  /** 每次自动重试前的回调（写日志 / 进度用） */
  onRetry?: (info: { scope: string; attempt: number; delayMs: number; code: IngestFailure['code'] }) => void
}

export interface CliCommandRequest {
  args: string[]
  timeoutMs: number
  /** 失败边界（来源 / 群标识 / 分页） */
  scope: string
  kind: 'sessions' | 'history' | 'members' | 'contacts'
  /** 熔断键（同一目标的自动重试共享） */
  breakerKey: string
  /** 退出码 1 是否按 `NO_AUTH` 处理（来源级命令为 true；单群 / 分页命令为 false，见 `classifyCliResult`） */
  exit1MeansNoAuth?: boolean
}

/** 退出码 / 超时 / 启动失败 → 状态 + 标识 + 可重试性（§6.1 表）。 */
export function classifyCliResult(
  result: CliResult,
  scope: string,
  options: { exit1MeansNoAuth?: boolean } = {},
): { status: CommandStatus; failure: IngestFailure } {
  if (result.spawnFailed) {
    return {
      status: 'noAuth',
      failure: failure(
        'NO_AUTH',
        '找不到 wechat-cli 可执行文件（依赖未就绪）：请检查终端里的安装与 cli.executable 配置',
        scope,
        false,
      ),
    }
  }
  if (result.timedOut) {
    return {
      status: 'timeout',
      failure: failure('TIMEOUT', `CLI 命令超时（${scope}）：已终止子进程且未读取残缺输出`, scope, true),
    }
  }
  if (result.exitCode === 0) {
    return { status: 'failed', failure: failure('SOURCE_UNAVAILABLE', `CLI 命令失败（${scope}）`, scope, true) }
  }
  if (result.exitCode === 1 && options.exit1MeansNoAuth !== false) {
    return {
      status: 'noAuth',
      failure: failure(
        'NO_AUTH',
        'wechat-cli 未初始化或未授权（退出码 1：找不到聊天对象 / 密钥缺失或不匹配）：请在终端完成首次提权提取后重试',
        scope,
        false,
      ),
    }
  }
  if (result.exitCode === 2) {
    return {
      status: 'failed',
      failure: failure(
        'SOURCE_UNAVAILABLE',
        `CLI 参数非法（退出码 2，${scope}）：本模块构造的命令参数不被接受，重放不会成功`,
        scope,
        false,
      ),
    }
  }
  if (result.exitCode === 1) {
    // 分项命令（成员 / 历史）的退出码 1 = 找不到该聊天对象：按分项失败处理，不把整个来源判成「未授权」。
    return {
      status: 'failed',
      failure: failure('SOURCE_UNAVAILABLE', `找不到聊天对象（退出码 1，${scope}）`, scope, false),
    }
  }
  return {
    status: 'failed',
    failure: failure('SOURCE_UNAVAILABLE', `CLI 非零退出（退出码 ${result.exitCode}，${scope}）`, scope, true),
  }
}

/** 退避时长（指数 + 抖动 + 上限）。 */
export function backoffDelay(policy: RetryPolicy, attempt: number, random: () => number): number {
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  const jitter = 0.8 + random() * 0.4
  return Math.min(policy.maxDelayMs, Math.round(base * jitter))
}

/**
 * 执行一条 CLI 命令：spawn → 超时 / 退出码判定 → 解析（worker 池）→ 按需自动重试。
 *
 * 终态返回，不抛异常（内部异常按「未知失败」处理，由调用方记录日志）。
 */
export async function runCliCommand<T>(deps: CliCommandDeps, request: CliCommandRequest): Promise<CommandOutcome<T>> {
  const random = deps.random ?? Math.random
  let attempts = 0
  let durationMs = 0
  let last: CommandFailure | null = null

  for (;;) {
    attempts += 1
    const result = await deps.runner.run(request.args, request.timeoutMs)
    durationMs += result.durationMs
    if (result.exitCode !== 0 || result.spawnFailed || result.timedOut) {
      const classified = classifyCliResult(result, request.scope, { exit1MeansNoAuth: request.exit1MeansNoAuth })
      last = { ok: false, status: classified.status, failure: classified.failure, attempts, durationMs }
      deps.breaker.recordFailure(request.breakerKey, deps.clock())
    } else {
      try {
        const value = (await deps.parse({ kind: request.kind, text: result.stdout, scope: request.scope })) as T
        deps.breaker.recordSuccess(request.breakerKey)
        return { ok: true, value, attempts, durationMs }
      } catch (error) {
        const reason =
          error instanceof OutputInvalidError
            ? `${error.message}（输出非法，已重试）`
            : `CLI 输出无法解析（${request.scope}）`
        last = {
          ok: false,
          status: 'failed',
          failure: failure('SOURCE_UNAVAILABLE', reason, request.scope, true),
          attempts,
          durationMs,
        }
        deps.breaker.recordFailure(request.breakerKey, deps.clock())
      }
    }

    const retryable = last.failure.retryable
    if (!retryable || attempts >= deps.policy.maxAttempts + 1) return last
    if (deps.breaker.shouldSkip(request.breakerKey, deps.clock())) return last
    const delayMs = backoffDelay(deps.policy, attempts, random)
    deps.onRetry?.({ scope: request.scope, attempt: attempts, delayMs, code: last.failure.code })
    await deps.sleep(delayMs)
  }
}
