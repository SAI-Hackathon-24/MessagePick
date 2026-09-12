/**
 * 渲染 worker 入口（mod-008 §3.1「render/render.worker」、§4.1 步骤 4）。
 *
 * - 只收参数、回传字节：不落盘、不开库、不读应用数据目录（§3.1 约束）；
 * - 合成逻辑 = `compose`（纯函数），与主线程同一份实现，保证可脱离 worker 单测；
 * - worker 崩溃 / 异常退出由池按该变体失败处理（详设 §1.4），主进程不受影响。
 */

import { parentPort } from 'node:worker_threads'

import { compose, type ResolvedAsset } from './compose'
import type { DrawDirective } from './layout'

interface WorkerRequest {
  id: number
  directives: DrawDirective[]
  assets: ResolvedAsset[]
}

interface WorkerResponse {
  id: number
  ok: boolean
  bytes?: Uint8Array
  error?: string
  kind?: string
}

const port = parentPort

if (port !== null) {
  port.on('message', (message: WorkerRequest) => {
    const reply: WorkerResponse = { id: message.id, ok: false }
    try {
      reply.bytes = compose(message.directives, message.assets)
      reply.ok = true
    } catch (error) {
      reply.error = error instanceof Error ? error.message : String(error)
      reply.kind = error instanceof Error ? error.name : 'Error'
    }
    port.postMessage(reply)
  })
}
