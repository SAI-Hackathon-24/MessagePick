/**
 * 自动重试与退避 + 轻量熔断（mod-003 §3.1「policy/retry.ts」；详设 §2.3、§6.1 `BREAKER_OPEN`）。
 *
 * - 退避：指数 `1 s → 2 s → 4 s`，上限 30 s，叠加 ±20% 抖动；`Retry-After` 优先（不再叠加抖动）。
 * - 预算：`retry.maxAttempts`（默认 3；0 = 关闭自动重试）。
 * - 熔断：同一目标连续 5 次可重试失败 → 暂停该目标的自动重试 60 s；期间手动重试仍可用
 *   （熔断只拦「失败后的再次尝试」，首次调用永远发出）。
 * - 只对 `autoRetry = true` 的分类生效（凭据 / 配置 / 拒绝类不自动重试，§6.1）。
 */

import type { Clock } from '../clock'
import { asEngineFailure, EngineFailure, type FailureReason } from '../errors'

/** 退避抽象（独立导出便于单测边界值）。 */
export function computeBackoffMs(retryIndex: number, random: () => number, options: { baseDelayMs: number; maxDelayMs: number; jitterRatio: number }): number {
  const { baseDelayMs, maxDelayMs, jitterRatio } = options
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex)
  const jitterSpan = exponential * jitterRatio
  const offset = (random() * 2 - 1) * jitterSpan
  return Math.max(0, Math.round(exponential + offset))
}

/** 熔断状态（按目标地址）。 */
export interface BreakerOptions {
  threshold: number
  pauseMs: number
  clock: Clock
}

export class CircuitBreaker {
  #state = new Map<string, { failures: number; openUntil: number }>()

  constructor(private readonly options: BreakerOptions) {}

  /** 自动重试是否被暂停（暂停期内）。 */
  isOpen(target: string): boolean {
    const state = this.#state.get(target)
    if (!state) return false
    if (this.options.clock.now() >= state.openUntil) {
      this.#state.delete(target)
      return false
    }
    return state.openUntil > 0
  }

  /** 记录一次可重试失败；达到阈值即打开暂停窗口。 */
  recordRetryableFailure(target: string): void {
    const state = this.#state.get(target) ?? { failures: 0, openUntil: 0 }
    state.failures += 1
    if (state.failures >= this.options.threshold) {
      state.openUntil = this.options.clock.now() + this.options.pauseMs
      state.failures = 0
    }
    this.#state.set(target, state)
  }

  /** 记录一次成功：连续失败计数清零、暂停解除。 */
  recordSuccess(target: string): void {
    this.#state.delete(target)
  }

  /** 诊断用快照（测试与排障）。 */
  snapshot(target: string): { failures: number; openUntil: number } {
    return { ...(this.#state.get(target) ?? { failures: 0, openUntil: 0 }) }
  }
}

/** 自动重试运行时选项。 */
export interface AutoRetryOptions {
  maxAttempts: () => number
  clock: Clock
  random: () => number
  breaker: CircuitBreaker
  target: string
  backoff?: { baseDelayMs: number; maxDelayMs: number; jitterRatio: number }
  onRetry?: (info: { retries: number; delayMs: number; reason: FailureReason }) => void
}

const DEFAULT_BACKOFF = { baseDelayMs: 1_000, maxDelayMs: 30_000, jitterRatio: 0.2 }

/** 反复执行 `operation` 直到成功 / 无可重试机会；返回成功值或抛出最终分类。 */
export async function runWithAutoRetry<T>(operation: () => Promise<T>, options: AutoRetryOptions): Promise<T> {
  const backoff = options.backoff ?? DEFAULT_BACKOFF
  let retriesUsed = 0

  for (;;) {
    try {
      const value = await operation()
      options.breaker.recordSuccess(options.target)
      return value
    } catch (error) {
      const failure = asEngineFailure(error)
      if (!failure.autoRetry) throw failure

      options.breaker.recordRetryableFailure(options.target)

      if (retriesUsed >= options.maxAttempts()) throw failure

      if (options.breaker.isOpen(options.target)) {
        throw new EngineFailure('BREAKER_OPEN', `熔断打开：暂停自动重试（原失败：${failure.reason}；${failure.message}）`, { cause: failure })
      }

      const delayMs = failure.retryAfterMs ?? computeBackoffMs(retriesUsed, options.random, backoff)
      retriesUsed += 1
      options.onRetry?.({ retries: retriesUsed, delayMs, reason: failure.reason })
      await new Promise<void>((resolve) => options.clock.setTimeout(resolve, delayMs))
    }
  }
}
