/**
 * 解析 worker 入口（mod-003 §3.1「worker/decode-worker.ts」；决策 7）。
 *
 * - 只做「文本 → 解析结果」的纯计算：不带凭据、不含配置、不碰存储（详设 §1.1 worker 禁止项）。
 * - 由 `worker/pool.ts` 以 `worker_threads` 惰性拉起；崩溃由池映射为可重试失败（`WORKER_CRASH`）。
 */

import { parentPort } from 'node:worker_threads'

import { decodeResponseText, OutputInvalidError } from '../parse/decode'
import type { DecodePayload } from '../parse/decode'

interface DecodeRequestMessage {
  type: 'decode'
  id: number
  payload: DecodePayload
}

const port = parentPort

if (port) {
  port.on('message', (message: DecodeRequestMessage) => {
    if (!message || message.type !== 'decode') return
    try {
      const result = decodeResponseText(message.payload)
      port.postMessage({ type: 'decoded', id: message.id, ok: true, result })
    } catch (error) {
      if (error instanceof OutputInvalidError) {
        port.postMessage({ type: 'decoded', id: message.id, ok: false, error: { kind: 'OUTPUT_INVALID', message: error.message } })
      } else {
        port.postMessage({ type: 'decoded', id: message.id, ok: false, error: { kind: 'INTERNAL', message: '解析 worker 内部异常' } })
      }
    }
  })
}
