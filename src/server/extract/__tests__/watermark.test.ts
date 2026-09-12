/**
 * 增量水位与扫描窗口（mod-006 §5.2、§8 决策 1；§7 护栏口径）：
 *
 * - 水位 = max(本进程上次成功批次终点, 已有条目的最晚来源消息发送时间)（不持久化）；
 * - 扫描窗口 = (水位 − 7 天, 当前]；冷启动且无任何条目时全量扫描；
 * - 重叠部分由条目标识幂等吸收（管线侧测试见 `pipeline.test.ts` 的「重放」用例）。
 */

import { describe, expect, it } from 'vitest'

import { OVERLAP_WINDOW_MS } from '../constants'
import { deriveWatermark, scanWindow } from '../pipeline/watermark'
import { DAY_MS, NOW } from './harness'

describe('水位推导（§5.2）', () => {
  it('冷启动且无任何条目 → 无水位并标记 coldStart（全量扫描）', () => {
    const derivation = deriveWatermark({ lastBatchEnd: null, latestEntrySourceTime: null, hasEntries: false })
    expect(derivation).toEqual({ watermark: null, coldStart: true })
  })

  it('水位取两个事实的较大者：本进程批次终点 / 最新条目来源时间', () => {
    expect(
      deriveWatermark({ lastBatchEnd: 200, latestEntrySourceTime: 100, hasEntries: true }).watermark,
    ).toBe(200)
    expect(
      deriveWatermark({ lastBatchEnd: 100, latestEntrySourceTime: 200, hasEntries: true }).watermark,
    ).toBe(200)
  })

  it('有位无条目但已有水位（重启后首扫）时不标记 coldStart', () => {
    expect(deriveWatermark({ lastBatchEnd: 500, latestEntrySourceTime: null, hasEntries: true })).toEqual({
      watermark: 500,
      coldStart: false,
    })
  })
})

describe('扫描窗口（§5.2）', () => {
  it('无水位 → 全量扫描 [0, now]', () => {
    expect(scanWindow({ watermark: null, coldStart: true }, NOW)).toEqual({ from: 0, to: NOW })
  })

  it('水位 − 7 天重叠；右端 = 当前时刻', () => {
    const watermark = 10 * DAY_MS
    const now = watermark + 2 * DAY_MS
    const window = scanWindow({ watermark, coldStart: false }, now, OVERLAP_WINDOW_MS)
    expect(window.from).toBe(watermark - OVERLAP_WINDOW_MS)
    expect(window.to).toBe(now)
  })

  it('窗口左端不早于 0；水位超出 now + 重叠（时钟回拨）时收窄到 now，保证 from ≤ to', () => {
    expect(scanWindow({ watermark: 1000, coldStart: false }, 1).from).toBe(0)
    expect(scanWindow({ watermark: NOW + 10 * DAY_MS, coldStart: false }, NOW)).toEqual({ from: NOW, to: NOW })
  })
})
