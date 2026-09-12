/**
 * 长任务进度通道：事件流 + 轮询降级（mod-004 §4.8、详设 §1.4 / 决策 1）。
 *
 * 口径：
 * - 建连失败 → 页面自动降级为 5 s 轮询同一份快照（`GET /api/operations`）；断连时保留最近快照。
 * - 重连先取一次快照再订阅（避免事件与快照之间的空窗）。
 * - 轮询期间按固定间隔重试建连；服务端为权威，断连不影响任务执行。
 * - 传输（事件流 / 快照读取 / 计时器）全部可注入，单测用假实现驱动，不依赖真实网络与真实定时器。
 */

import type { ShellOperation } from '../state/operations'
import { parseOperationsPayload } from '../state/operations'

/** 轮询间隔（详设 §1.4：SSE 建连失败 → 5 s 轮询）。 */
export const OPERATIONS_POLL_INTERVAL_MS = 5_000

/** 轮询期间的建连重试间隔。 */
export const OPERATIONS_RECONNECT_INTERVAL_MS = 30_000

/** 连接状态（页面顶栏 / 进度面板据此提示）。 */
export type OperationsConnection = 'connecting' | 'live' | 'polling' | 'offline'

/** 进度快照。 */
export interface OperationsSnapshot {
  operations: readonly ShellOperation[]
}

/** 事件流回调。 */
export interface SseHandlers {
  onOpen(): void
  onMessage(data: string): void
  onError(): void
}

/** 一条事件流连接。 */
export interface SseConnection {
  close(): void
}

/** 事件流传输（默认基于浏览器 `EventSource`；测试注入假实现）。 */
export interface SseTransport {
  connect(handlers: SseHandlers): SseConnection
}

/** 事件流的最小接口（`EventSource` 的可用子集，便于替身）。 */
export interface EventSourceLike {
  onopen: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  addEventListener(type: string, listener: (event: { data?: string }) => void): void
  close(): void
}

/** 计时器最小接口（测试注入手动计时器）。 */
export interface Timers {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

/** 默认计时器。 */
export const defaultTimers: Timers = {
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (handle) => {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>)
  },
}

/** 基于 `EventSource` 的事件流传输。 */
export function createEventSourceTransport(
  url: string,
  create: (url: string) => EventSourceLike = (target) =>
    new EventSource(target) as unknown as EventSourceLike,
): SseTransport {
  return {
    connect: (handlers) => {
      const source = create(url)
      source.onopen = () => handlers.onOpen()
      source.onerror = () => handlers.onError()
      const forward = (event: { data?: string }) => {
        if (typeof event.data === 'string') handlers.onMessage(event.data)
      }
      source.addEventListener('message', forward)
      source.addEventListener('snapshot', forward)
      return {
        close: () => {
          source.onopen = null
          source.onerror = null
          source.close()
        },
      }
    },
  }
}

/** 进度通道。 */
export interface OperationsChannel {
  start(): void
  stop(): void
  state(): OperationsConnection
}

/** 创建选项。 */
export interface OperationsChannelOptions {
  /** 读取一次进度快照（失败返回 `null`，通道保持降级态）。 */
  readSnapshot(): Promise<OperationsSnapshot | null>
  transport: SseTransport
  onSnapshot(snapshot: OperationsSnapshot): void
  onState(state: OperationsConnection): void
  pollIntervalMs?: number
  reconnectIntervalMs?: number
  timers?: Timers
}

/** 创建进度通道。 */
export function createOperationsChannel(options: OperationsChannelOptions): OperationsChannel {
  const timers = options.timers ?? defaultTimers
  const pollIntervalMs = options.pollIntervalMs ?? OPERATIONS_POLL_INTERVAL_MS
  const reconnectIntervalMs = options.reconnectIntervalMs ?? OPERATIONS_RECONNECT_INTERVAL_MS
  let state: OperationsConnection = 'offline'
  let connection: SseConnection | null = null
  let pollHandle: unknown = null
  let reconnectHandle: unknown = null
  let snapshotInFlight = false
  let stopped = true

  function setState(next: OperationsConnection): void {
    if (state === next) return
    state = next
    options.onState(next)
  }

  function closeConnection(): void {
    if (!connection) return
    const current = connection
    connection = null
    try {
      current.close()
    } catch {
      /* 关闭失败不影响降级路径 */
    }
  }

  function stopTimers(): void {
    if (pollHandle !== null) {
      timers.clearInterval(pollHandle)
      pollHandle = null
    }
    if (reconnectHandle !== null) {
      timers.clearInterval(reconnectHandle)
      reconnectHandle = null
    }
  }

  async function pullSnapshot(): Promise<void> {
    if (snapshotInFlight || stopped) return
    snapshotInFlight = true
    try {
      const snapshot = await options.readSnapshot()
      if (snapshot && !stopped) options.onSnapshot(snapshot)
    } finally {
      snapshotInFlight = false
    }
  }

  function enterPolling(): void {
    closeConnection()
    setState('polling')
    if (pollHandle === null) {
      pollHandle = timers.setInterval(() => {
        void pullSnapshot()
      }, pollIntervalMs)
    }
    if (reconnectHandle === null) {
      reconnectHandle = timers.setInterval(() => {
        void connect()
      }, reconnectIntervalMs)
    }
  }

  async function connect(): Promise<void> {
    if (stopped) return
    setState('connecting')
    // 重连先取一次快照，再订阅事件流（详设 §1.4）。
    await pullSnapshot()
    if (stopped) return
    try {
      connection = options.transport.connect({
        onOpen: () => {
          stopTimers()
          setState('live')
        },
        onMessage: (data) => {
          const parsed = parseOperationsPayload(data)
          if (parsed) options.onSnapshot(parsed)
        },
        onError: () => enterPolling(),
      })
    } catch {
      enterPolling()
    }
  }

  return {
    start: () => {
      if (!stopped) return
      stopped = false
      void connect()
    },
    stop: () => {
      stopped = true
      stopTimers()
      closeConnection()
      setState('offline')
    },
    state: () => state,
  }
}
