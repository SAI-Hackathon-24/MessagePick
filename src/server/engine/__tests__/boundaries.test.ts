/**
 * MOD-003 纪律与边界（mod-003 §7-10；§2 依赖方向；详设 §4.3 / §6.1）。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createHarness, createCrashingDecoder, drive, expectFailed, expectOk, item, messagesInput, request } from './harness'

const engineDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('MOD-003 依赖与纪律', () => {
  it('引擎不 import 存储与业务模块（import 边界测试，§2）', () => {
    const files = listSourceFiles(engineDir)
    expect(files.length).toBeGreaterThan(15)

    const violations: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const specifier of importSpecifiers(source)) {
        const label = `${file.slice(engineDir.length + 1)} → ${specifier}`
        if (specifier.startsWith('node:')) continue
        if (specifier === '@shared' || specifier.startsWith('@shared/')) continue
        if (specifier.startsWith('.')) {
          const resolved = resolve(dirname(file), specifier)
          if (!resolved.startsWith(engineDir + sep)) violations.push(label)
          continue
        }
        violations.push(label)
      }
    }

    expect(violations).toEqual([])
  })

  it('日志与事件不含消息文本与凭据（哨兵断言，详设 §4.3 / §6.1）', async () => {
    const sentinel = 'SENTINEL_TEXT_9f3c'
    const { engine, service, events, logs } = createHarness({ config: { retry: { maxAttempts: 0 } } })

    // 成功路径：哨兵出现在单元文本与任务说明里
    service.replyItems([item('a', [1])])
    await engine.executeTask(
      request('识别', { kind: '消息集合', units: [{ id: 'm1', text: sentinel }] }, {
        instruction: `任务说明 ${sentinel}`,
        outputSchema: { type: 'object', required: ['label'], properties: { label: { type: 'string' } } },
      }),
    )

    // 失败路径：错误信封也只表达分类与边界
    service.replyStatus(500)
    const failed = expectFailed(await engine.executeTask(request('识别', messagesInput('m2'))))
    expect(failed.error.message).not.toContain(sentinel)

    const blob = JSON.stringify({ events, logs })
    expect(blob).not.toContain(sentinel)
    expect(blob).not.toContain('test-api-key')
    expect(blob).not.toContain('Bearer')
  })
})

describe('MOD-003 worker 边界（决策 7）', () => {
  it('worker 崩溃映射为可重试失败（WORKER_CRASH），自动重试后可成功', async () => {
    const { engine, clock, service } = createHarness({
      limits: { workerDecodeMinChars: 1 }, // 强制走 worker 阈值路径
      config: { retry: { maxAttempts: 1 } },
      decodeWorker: createCrashingDecoder({ crashTimes: 1 }),
    })
    service.replyItems([item('a', ['m1'])])
    service.replyItems([item('b', ['m1'])])

    const outcome = expectOk(await drive(clock, engine.executeTask(request('识别', messagesInput('m1')))))

    expect(service.calls).toHaveLength(2)
    expect(outcome.result.items[0]?.label).toBe('b')
  })

  it('worker 崩溃且无重试预算 → ANALYSIS_FAILED / WORKER_CRASH（retryable=true）', async () => {
    const { engine, service } = createHarness({
      limits: { workerDecodeMinChars: 1 },
      config: { retry: { maxAttempts: 0 } },
      decodeWorker: createCrashingDecoder({ crashTimes: 99 }),
    })
    service.replyItems([item('a', ['m1'])])

    const outcome = expectFailed(await engine.executeTask(request('识别', messagesInput('m1'))))

    expect(outcome.error.code).toBe('ANALYSIS_FAILED')
    expect(outcome.error.context?.reason).toBe('WORKER_CRASH')
    expect(outcome.error.retryable).toBe(true)
  })

  it('未映射的内部异常也以信封上抛（AC-038：不静默失败）', async () => {
    const { engine, service } = createHarness({
      limits: { workerDecodeMinChars: 1 },
      config: { retry: { maxAttempts: 0 } },
      decodeWorker: async () => {
        throw new Error('boom')
      },
    })
    service.replyItems([item('a', ['m1'])])

    const outcome = expectFailed(await engine.executeTask(request('识别', messagesInput('m1'))))

    expect(outcome.error.code).toBe('ANALYSIS_FAILED')
    expect(outcome.error.context?.reason).toBe('UNKNOWN')
    expect(outcome.error.retryable).toBe(false)
  })
})

describe('MOD-003 模块出口', () => {
  it('index.ts 导出面稳定（供 MOD-005 ~ MOD-008 与外壳 import）', async () => {
    const mod = await import('../index')

    for (const name of ['executeTask', 'retryTask', 'engineCounters', 'notifyDataEpoch', 'shutdownEngine', 'configureEngine', 'createEngine', 'createEngineConfig', 'taskRefFromEnvelope'] as const) {
      expect(typeof mod[name], name).toBe('function')
    }
    expect(mod.ENGINE_LIMITS.retry.breakerThreshold).toBe(5)
    expect(mod.PROTOCOL_VERSION).toMatch(/^mp-protocol-v\d+$/)
    expect(mod.engine).toBeInstanceOf(mod.Engine)
    expect(mod.engineCounters()).toEqual({ queued: 0, running: 0 })
  })
})

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full))
    } else if (entry.name.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

/** 扫描真实的 import / export-from（先剔除注释，避免把文档示例当代码）。 */
function importSpecifiers(rawSource: string): string[] {
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
  const specifiers: string[] = []
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}
