/**
 * 时钟抽象：退避等待与调用超时都经它取时（mod-003 §7「时钟（退避与超时用假时钟）」）。
 * 生产用 `systemClock`；测试用 `createManualClock()` 手动推进。
 */

/** 引擎内部使用的最小时钟接口。 */
export interface Clock {
  /** 当前时刻（UTC epoch 毫秒）。 */
  now(): number
  /** 延时触发；返回取消函数。 */
  setTimeout(handler: () => void, ms: number): () => void
}

class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }

  setTimeout(handler: () => void, ms: number): () => void {
    const timer = setTimeout(handler, ms)
    // 不让计时器阻止进程退出（调用本身由进行中的 fetch 保活）。
    timer.unref()
    return () => {
      clearTimeout(timer)
    }
  }
}

/** 生产时钟。 */
export const systemClock: Clock = new SystemClock()

/** 可手动推进的测试时钟。 */
export interface ManualClock extends Clock {
  /** 前进 `ms` 毫秒，依次触发到期计时器（每次触发后让出微任务队列）。 */
  advance(ms: number): Promise<void>
  /** 以时钟语义等待 `ms`（与引擎内部等待同一套计时器）。 */
  sleep(ms: number): Promise<void>
  /** 未触发的计时器数量（用于断言没有遗留计时器）。 */
  pendingTimers(): number
}

/** 创建假时钟（测试用，不依赖真实时间）。 */
export function createManualClock(startAt = 0): ManualClock {
  let now = startAt
  let sequence = 0
  const timers = new Map<number, { at: number; handler: () => void }>()
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  const clock: ManualClock = {
    now: () => now,
    setTimeout(handler, ms) {
      sequence += 1
      const id = sequence
      timers.set(id, { at: now + Math.max(0, ms), handler })
      return () => {
        timers.delete(id)
      }
    },
    async advance(ms) {
      const target = now + ms
      for (;;) {
        let dueId: number | null = null
        for (const [id, timer] of timers) {
          if (timer.at > target) continue
          if (dueId === null) {
            dueId = id
            continue
          }
          const current = timers.get(dueId)
          if (current === undefined || timer.at < current.at || (timer.at === current.at && id < dueId)) {
            dueId = id
          }
        }
        if (dueId === null) break
        const timer = timers.get(dueId)
        timers.delete(dueId)
        if (timer) {
          now = Math.max(now, timer.at)
          timer.handler()
        }
        await flush()
      }
      now = target
      await flush()
    },
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        clock.setTimeout(resolve, ms)
      }),
    pendingTimers: () => timers.size,
  }

  return clock
}
