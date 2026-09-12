/**
 * 数据代际（`dataEpoch`）闸门（详设 §3.3 / mod-004 §4.2）。
 *
 * 规则：
 * - 响应 `epoch` 小于当前值 → 过期响应，调用方丢弃（不覆盖新数据）。
 * - 大于当前值 → 代际前进：通知订阅者失效缓存（页面侧缓存 = 群清单，键为 `dataEpoch`）。
 * - 缺失 `epoch`（直连旧实现 / 测试替身）→ 按「不过期」放行，不推进代际。
 */

/** 代际闸门。 */
export interface EpochGate {
  /** 当前代际（尚未见过任何响应时为 `null`）。 */
  current(): number | null
  /** 该代际是否应被接受（`false` = 过期响应，丢弃）。 */
  accept(epoch: number | null | undefined): boolean
  /** 订阅「代际前进」（缓存失效）。 */
  onAdvance(listener: (epoch: number) => void): () => void
}

/** 创建代际闸门。 */
export function createEpochGate(): EpochGate {
  let current: number | null = null
  const listeners = new Set<(epoch: number) => void>()
  return {
    current: () => current,
    accept: (epoch) => {
      if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return true
      if (current === null || epoch > current) {
        current = epoch
        for (const listener of listeners) listener(epoch)
        return true
      }
      return epoch === current
    },
    onAdvance: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
