/**
 * TEMP AUDIT FILE — delete after the audit.
 * Probes `src/server/regen/render/pipeline.ts` :: createWorkerPool slot bookkeeping.
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createWorkerPool, RenderTimeoutError, type RenderJob } from '../render/pipeline'

const dir = mkdtempSync(join(tmpdir(), 'mp-audit-worker-'))
const logFile = join(dir, 'spawns.log')

const workerSource = `
const { parentPort } = require('node:worker_threads')
const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(logFile)}, 'spawn\\n')
let seen = 0
parentPort.on('message', (msg) => {
  seen += 1
  const reply = () => parentPort.postMessage({ id: msg.id, ok: true, bytes: new Uint8Array([1, 2, 3]) })
  // 每个 worker 实例的第一条消息故意变慢（触发池级超时 → worker 被丢弃）
  if (seen === 1) setTimeout(reply, 300)
  else reply()
})
`
writeFileSync(join(dir, 'slow-once.cjs'), workerSource)

const job = (variantIndex: number): RenderJob => ({
  variantIndex,
  text: 'x',
  directives: [],
  assets: [],
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('AUDIT: regen 渲染 worker 池在丢弃 worker 后无法再拉起', () => {
  it('超时丢弃 worker 后，后续任务排进队列且永远没有 worker 处理', async () => {
    const pool = createWorkerPool({ size: 1, workerFile: pathToFileURL(join(dir, 'slow-once.cjs')) })

    // 第一次：worker 的第一条消息被故意拖慢 → 池级超时 → drop(worker)
    await expect(pool.run(job(0), { timeoutMs: 100 })).rejects.toThrow(RenderTimeoutError)
    const spawnsAfterFirst = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length

    // 第二次：期望「下次任务时重建 worker」并立刻拿到字节
    let second = 'PENDING'
    void pool.run(job(1), { timeoutMs: 5_000 }).then(
      () => {
        second = 'RESOLVED'
      },
      (error: unknown) => {
        second = `REJECTED:${String(error)}`
      },
    )
    await sleep(1_000)

    const spawnsAfterSecond = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length
    console.log('[audit] second run state =', second)
    console.log('[audit] worker spawn count =', spawnsAfterFirst, '->', spawnsAfterSecond)

    expect(second).toBe('RESOLVED')
    await pool.dispose?.()
    rmSync(dir, { recursive: true, force: true })
  }, 20_000)
})
