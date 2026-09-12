/**
 * CLI 子进程适配（mod-001 §7「CLI 适配」行；详设 §1.4、决策 1）。
 *
 * 这里是**唯一真拉子进程**的测试：用 `process.execPath`（node）作为无害替身验证 spawn 语义
 * （参数数组不经 shell、超时终止、退出码与输出捕获），**不调用 wechat-cli**。
 */

import { describe, expect, it } from 'vitest'

import { probeCli } from '../cli/probe'
import { DEFAULT_CLI_EXECUTABLE, createCliRunner, resolveCliExecutable } from '../cli/runner'

const NODE = process.execPath

describe('参数数组、退出码与输出捕获（替身 = node，不经 shell）', () => {
  it('空格 / 分号 / 命令替换一律按字面量传递（shell 参与则会变形）', async () => {
    const runner = createCliRunner({ executable: NODE })
    const result = await runner.run(
      ['-e', 'process.stdout.write(process.argv.slice(1).join("|"))', 'a b;c', '$(echo hi)'],
      10_000,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('a b;c|$(echo hi)')
    expect(result.timedOut).toBe(false)
    expect(result.spawnFailed).toBe(false)
  })

  it('退出码与 stderr 尾部原样带回', async () => {
    const runner = createCliRunner({ executable: NODE })
    const result = await runner.run(['-e', 'process.stderr.write("boom"); process.exit(2)'], 10_000)
    expect(result.exitCode).toBe(2)
    expect(result.stderrTail).toContain('boom')
  })

  it('超时即终止子进程：不等它自然结束、不读残缺输出', async () => {
    const runner = createCliRunner({ executable: NODE })
    const result = await runner.run(
      ['-e', 'process.stdout.write("半"); setTimeout(() => process.stdout.write("截"), 5_000)'],
      200,
    )
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(-1)
    expect(result.durationMs).toBeGreaterThanOrEqual(150)
    expect(result.durationMs).toBeLessThan(3_000)
  })

  it('可执行文件不存在 → spawnFailed（由调用方映射 NO_AUTH）', async () => {
    const runner = createCliRunner({ executable: '/definitely/not/here/wechat-cli' })
    const result = await runner.run(['sessions'], 1_000)
    expect(result.spawnFailed).toBe(true)
    expect(result.exitCode).toBe(-1)
  })
})

describe('入口解析与依赖探测', () => {
  it('resolveCliExecutable：显式配置 → WECHAT_CLI_BIN → WECHAT_CLI_REPO/bin → 默认入口', () => {
    expect(resolveCliExecutable('/explicit', { WECHAT_CLI_BIN: '/bin' } as NodeJS.ProcessEnv)).toBe('/explicit')
    expect(resolveCliExecutable(undefined, { WECHAT_CLI_BIN: '/bin' } as NodeJS.ProcessEnv)).toBe('/bin')
    expect(resolveCliExecutable(undefined, { WECHAT_CLI_REPO: '/repo' } as NodeJS.ProcessEnv)).toBe(
      '/repo/bin/wechat-cli',
    )
    expect(resolveCliExecutable(undefined, {} as NodeJS.ProcessEnv)).toBe(DEFAULT_CLI_EXECUTABLE)
  })

  it('probe：只探测可执行文件存在性；版本 / init 状态不猜（unknown）', async () => {
    const available = await probeCli({ executable: NODE })
    expect(available).toMatchObject({ available: true, version: null, initState: 'unknown' })

    const missing = await probeCli({ executable: '/definitely/not/here/wechat-cli' })
    expect(missing).toMatchObject({ available: false, version: null, initState: 'unknown' })
    expect(missing.note).toBeTruthy()
  })
})
