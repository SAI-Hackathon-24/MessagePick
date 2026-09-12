/**
 * 解析 worker 入口（mod-001 决策 1；详设 §1.1 的 worker 允许项 / 禁止项）。
 *
 * - 只做「文本 → 解析结果」的纯计算：不带凭据、不含配置、不碰存储、不开库。
 * - 由 `pool.ts` 以 `worker_threads` 惰性拉起；异常按「输出非法」回传（→ `SOURCE_UNAVAILABLE`，可重试）。
 */

import { parentPort } from 'node:worker_threads'

import { OutputInvalidError, parseByKind, type ParseTask } from './parse'

interface ParseRequestMessage {
  type: 'parse'
  id: number
  task: ParseTask
}

const port = parentPort

if (port !== null) {
  port.on('message', (message: ParseRequestMessage) => {
    if (!message || message.type !== 'parse') return
    try {
      port.postMessage({ type: 'parsed', id: message.id, ok: true, result: parseByKind(message.task) })
    } catch (error) {
      const detail = error instanceof OutputInvalidError ? error.message : '解析 worker 内部异常'
      port.postMessage({ type: 'parsed', id: message.id, ok: false, error: { kind: 'OUTPUT_INVALID', message: detail } })
    }
  })
}
