/**
 * 任务队列：FIFO + 可热调整信号量（mod-003 §3.1、决策 5；详设 §1.2 模型任务串行域）。
 *
 * - 一个任务占一个额度，任务内串行调用（决策 5）；超限 FIFO 排队。
 * - 容量热调整：重设信号量（详设 §7「立即生效，运行中任务不打断」）——调小时运行中任务照跑，
 *   新任务在 `active < capacity` 前不出发。
 * - 无硬性队列上限（详设 §1.3：单机单用户，输入规模有限）。
 */

export interface QueueStats {
  /** 排队等待的任务数。 */
  queued: number
  /** 正在执行的任务数。 */
  running: number
}

export class TaskQueue {
  #capacity: number
  #active = 0
  #waiters: Array<() => void> = []

  constructor(capacity: number) {
    this.#capacity = assertCapacity(capacity)
  }

  get capacity(): number {
    return this.#capacity
  }

  get stats(): QueueStats {
    return { queued: this.#waiters.length, running: this.#active }
  }

  /** 热调整并发上限（详设 §7）。 */
  setCapacity(capacity: number): void {
    this.#capacity = assertCapacity(capacity)
    this.#drain()
  }

  /** 入队执行；取到信号量后才调用 `task`，完成后释放额度。 */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire()
    try {
      return await task()
    } finally {
      this.#active -= 1
      this.#drain()
    }
  }

  #acquire(): Promise<void> {
    if (this.#active < this.#capacity) {
      this.#active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.#waiters.push(() => {
        this.#active += 1
        resolve()
      })
    })
  }

  #drain(): void {
    while (this.#waiters.length > 0 && this.#active < this.#capacity) {
      const next = this.#waiters.shift()
      if (next) next()
    }
  }
}

function assertCapacity(capacity: number): number {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`并发上限必须是 ≥ 1 的整数（收到 ${String(capacity)}）`)
  }
  return capacity
}
