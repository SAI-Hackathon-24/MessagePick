/**
 * CLI 退出码 / 超时 / 非法输出 → 状态与错误标识的映射，以及自动重试与熔断（mod-001 §7「CLI 适配」行、
 * §6.1 表；详设 §2.3）。
 *
 * 口径：
 * - 退出码 1（未初始化 / 密钥不匹配）→ `NO_AUTH`，不重试；分项命令的退出码 1（找不到聊天对象）按
 *   `SOURCE_UNAVAILABLE` 处理；
 * - 退出码 2（参数非法）→ `SOURCE_UNAVAILABLE`，不重试（重放不会成功）；
 * - 其他非零 / 非法输出 → `SOURCE_UNAVAILABLE`，可重试；超时 → `TIMEOUT`，可重试；
 * - 退避：指数 1s → 2s → 4s、上限 30s、±20% 抖动；熔断：连续可重试失败达阈值即暂停自动重试。
 */

import { describe, expect, it } from 'vitest'

import type { CliResult } from '../cli/runner'
import { createInlineParseRunner } from '../cli/parse'
import {
  RetryBreaker,
  backoffDelay,
  classifyCliResult,
  createRetryPolicy,
  runCliCommand,
  type CliCommandDeps,
} from '../cli/retry'

import { FakeCliRunner, NOW, failReply, okReply, spawnFailReply, timeoutReply } from './harness'

const SCOPE = '群消息:sessions'
const BREAKER_KEY = 'sessions:群消息:sessions'

function cliResult(partial: Partial<CliResult>): CliResult {
  return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1, timedOut: false, spawnFailed: false, ...partial }
}

function makeDeps(
  runner: FakeCliRunner,
  options: { maxAttempts?: number; sleeps?: number[]; breakerFailures?: number; random?: () => number } = {},
): CliCommandDeps {
  const base = createRetryPolicy(options.maxAttempts ?? 0)
  const policy = { ...base, breakerFailures: options.breakerFailures ?? base.breakerFailures }
  return {
    runner,
    parse: createInlineParseRunner(),
    policy,
    breaker: new RetryBreaker(policy),
    sleep: async (ms) => {
      options.sleeps?.push(ms)
    },
    clock: () => NOW,
    random: options.random ?? (() => 0.5),
  }
}

const request = {
  kind: 'sessions' as const,
  args: ['sessions', '--limit', '200'],
  timeoutMs: 1_000,
  scope: SCOPE,
  breakerKey: BREAKER_KEY,
}

describe('退出码 / 超时 / 启动失败 → 状态与错误标识（§6.1 表）', () => {
  it('退出码 1（默认口径）→ 无授权 NO_AUTH，不重试', () => {
    const classified = classifyCliResult(cliResult({ exitCode: 1 }), SCOPE)
    expect(classified).toMatchObject({ status: 'noAuth', failure: { code: 'NO_AUTH', retryable: false } })
  })

  it('退出码 1（分项命令：找不到聊天对象）→ SOURCE_UNAVAILABLE，不重试', () => {
    const classified = classifyCliResult(cliResult({ exitCode: 1 }), SCOPE, { exit1MeansNoAuth: false })
    expect(classified).toMatchObject({ status: 'failed', failure: { code: 'SOURCE_UNAVAILABLE', retryable: false } })
  })

  it('退出码 2（参数非法）→ SOURCE_UNAVAILABLE，不重试（重放不会成功）', () => {
    const classified = classifyCliResult(cliResult({ exitCode: 2 }), SCOPE)
    expect(classified).toMatchObject({ status: 'failed', failure: { code: 'SOURCE_UNAVAILABLE', retryable: false } })
  })

  it('其他非零退出 → SOURCE_UNAVAILABLE，可重试（原因不明）', () => {
    const classified = classifyCliResult(cliResult({ exitCode: 3 }), SCOPE)
    expect(classified).toMatchObject({ status: 'failed', failure: { code: 'SOURCE_UNAVAILABLE', retryable: true } })
  })

  it('超时（子进程已终止）→ TIMEOUT，可重试', () => {
    const classified = classifyCliResult(cliResult({ exitCode: -1, timedOut: true }), SCOPE)
    expect(classified).toMatchObject({ status: 'timeout', failure: { code: 'TIMEOUT', retryable: true } })
  })

  it('启动失败（可执行文件不存在 / 无执行权限）→ NO_AUTH，不重试（依赖未就绪）', () => {
    const classified = classifyCliResult(cliResult({ exitCode: -1, spawnFailed: true }), SCOPE)
    expect(classified).toMatchObject({ status: 'noAuth', failure: { code: 'NO_AUTH', retryable: false } })
  })
})

describe('runCliCommand：解析、自动重试与熔断', () => {
  it('成功一次即返回：输出经真实解析路径（sessions 裸数组）', async () => {
    const runner = new FakeCliRunner()
    runner.queue.push(okReply('[]'))
    const outcome = await runCliCommand<unknown[]>(makeDeps(runner), request)
    expect(outcome).toMatchObject({ ok: true, attempts: 1 })
    expect(runner.calls).toEqual([{ args: request.args, timeoutMs: 1_000 }])
  })

  it('可重试失败按退避重试：1s → 2s（注入抖动 = 1.0）', async () => {
    const runner = new FakeCliRunner()
    const sleeps: number[] = []
    runner.queue.push(failReply(3), failReply(3), okReply('[]'))
    const outcome = await runCliCommand<unknown[]>(makeDeps(runner, { maxAttempts: 2, sleeps }), request)
    expect(outcome).toMatchObject({ ok: true, attempts: 3 })
    expect(sleeps).toEqual([1_000, 2_000])
  })

  it('不可重试失败（退出码 1 / 2）只调用一次', async () => {
    for (const exitCode of [1, 2]) {
      const runner = new FakeCliRunner()
      runner.queue.push(failReply(exitCode))
      const outcome = await runCliCommand<unknown[]>(makeDeps(runner, { maxAttempts: 3 }), request)
      expect(outcome).toMatchObject({ ok: false, attempts: 1 })
      expect(runner.calls).toHaveLength(1)
    }
  })

  it('非法输出 → SOURCE_UNAVAILABLE（可重试），重试耗尽后返回终态', async () => {
    const runner = new FakeCliRunner()
    runner.queue.push(okReply('不是 JSON'), okReply('还是不是 JSON'))
    const outcome = await runCliCommand<unknown[]>(makeDeps(runner, { maxAttempts: 1 }), request)
    expect(outcome).toMatchObject({
      ok: false,
      attempts: 2,
      status: 'failed',
      failure: { code: 'SOURCE_UNAVAILABLE', retryable: true },
    })
    expect(outcome.ok === false && outcome.failure.reason).toContain('输出非法')
  })

  it('超时 → TIMEOUT（可重试）；重试回调带出标识与退避时长', async () => {
    const runner = new FakeCliRunner()
    const retries: Array<{ code: string; delayMs: number }> = []
    runner.queue.push(timeoutReply(), okReply('[]'))
    const deps = makeDeps(runner, { maxAttempts: 1 })
    const outcome = await runCliCommand<unknown[]>(
      { ...deps, onRetry: (info) => retries.push({ code: info.code, delayMs: info.delayMs }) },
      request,
    )
    expect(outcome).toMatchObject({ ok: true, attempts: 2 })
    expect(retries).toEqual([{ code: 'TIMEOUT', delayMs: 1_000 }])
  })

  it('熔断：连续可重试失败达阈值后暂停自动重试（本次直接返回终态）', async () => {
    const runner = new FakeCliRunner()
    runner.queue.push(failReply(3))
    const deps = makeDeps(runner, { maxAttempts: 3, breakerFailures: 1 })
    const outcome = await runCliCommand<unknown[]>(deps, request)
    expect(outcome).toMatchObject({ ok: false, attempts: 1 })
    expect(runner.calls).toHaveLength(1)
  })

  it('参数数组原样传递（不经 shell：由 runner 层保证，调用方只给数组）', async () => {
    const runner = new FakeCliRunner()
    runner.queue.push(okReply('[]'))
    const args = ['history', 'g1@chatroom', '--limit', '1000', '--offset', '0']
    await runCliCommand<unknown[]>(makeDeps(runner), { ...request, kind: 'history', args })
    expect(runner.calls[0]?.args).toEqual(args)
  })
})

describe('backoffDelay / RetryBreaker', () => {
  it('抖动 ±20% 与上限 30s', () => {
    const policy = createRetryPolicy(3)
    expect(backoffDelay(policy, 1, () => 0)).toBe(800)
    expect(backoffDelay(policy, 1, () => 1)).toBe(1_200)
    expect(backoffDelay(policy, 2, () => 0.5)).toBe(2_000)
    expect(backoffDelay(policy, 10, () => 1)).toBe(30_000)
  })

  it('连续失败达到阈值开熔断；冷却结束后自动恢复；成功即清零', () => {
    const policy = createRetryPolicy(3)
    const breaker = new RetryBreaker({ breakerFailures: 2, breakerCooldownMs: 60_000 })
    expect(breaker.shouldSkip('k', NOW)).toBe(false)
    breaker.recordFailure('k', NOW)
    expect(breaker.shouldSkip('k', NOW)).toBe(false)
    breaker.recordFailure('k', NOW)
    expect(breaker.shouldSkip('k', NOW)).toBe(true)
    expect(breaker.shouldSkip('k', NOW + policy.breakerCooldownMs)).toBe(false)
    breaker.recordFailure('k', NOW)
    breaker.recordSuccess('k')
    expect(breaker.shouldSkip('k', NOW)).toBe(false)
  })

  it('启动失败也计入熔断（依赖未就绪时不反复拉起子进程）', async () => {
    const runner = new FakeCliRunner()
    runner.queue.push(spawnFailReply())
    const outcome = await runCliCommand<unknown[]>(makeDeps(runner, { maxAttempts: 3 }), request)
    expect(outcome).toMatchObject({ ok: false, attempts: 1, status: 'noAuth' })
  })
})
