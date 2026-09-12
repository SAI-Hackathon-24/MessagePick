/**
 * MOD-008 模块常数（mod-008 §7.1 / §7.3；详设 §2.3 / §5.4 / §7）。
 *
 * 断言口径：`constants.ts` 是模块唯一取值来源，测试钉住设计文档给定的值（改口径先改文档）。
 */

import { availableParallelism } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  CANDIDATE_MAX_COUNT,
  CONSENT_SCAN_MAX_PAGES,
  CONSENT_SCAN_PAGE_SIZE,
  CREATION_BADGE_LABEL,
  DAY_MS,
  G1_VARIANT_COUNT,
  G2_VARIANT_COUNT,
  HISTORY_MAX_PAGES,
  HISTORY_MAX_RECORDS,
  HISTORY_PAGE_SIZE,
  HOT_MEME_MAX_ITEMS,
  HOT_MEME_WINDOW_DAYS,
  LOOKUP_SCAN_MAX_PAGES,
  LOOKUP_SCAN_PAGE_SIZE,
  MATERIAL_SCAN_MAX_PAGES,
  MATERIAL_SCAN_PAGE_SIZE,
  MAX_CANVAS_SIDE,
  QUOTE_MIN_CHARS,
  RECENT_MESSAGE_LIMIT,
  RECENT_SCAN_MAX_PAGES,
  RECENT_SCAN_PAGE_SIZE,
  RENDER_POOL_SIZE,
  RENDER_TIMEOUT_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_JITTER_RATIO,
  RETRY_MAX_DELAY_MS,
} from '../constants'

describe('MOD-008 生成口径（REQ-036 ~ REQ-038 / REQ-013）', () => {
  it('G1 = 同一模板下 4 个文案变体、G2 默认 5 条（AC-066 / AC-069）', () => {
    expect(G1_VARIANT_COUNT).toBe(4)
    expect(G2_VARIANT_COUNT).toBe(5)
  })

  it('G3 候选条数上限落在 1–2（§4.3「本模块定义」）', () => {
    expect(CANDIDATE_MAX_COUNT).toBeGreaterThanOrEqual(1)
    expect(CANDIDATE_MAX_COUNT).toBeLessThanOrEqual(2)
  })

  it('成员原话判定阈值 = 逐字一致且长度 ≥ 6 字（§5.3）', () => {
    expect(QUOTE_MIN_CHARS).toBe(6)
  })

  it('「创作」标注为固定文案（REQ-013 / AC-031）', () => {
    expect(CREATION_BADGE_LABEL).toBe('创作')
  })
})

describe('MOD-008 重试、超时与渲染池（详设 §2.3 / §7；§8 决策 4）', () => {
  it('自动重试最多 3 次、退避 1 s → 2 s → 4 s、上限 30 s、±20% 抖动', () => {
    expect(AUTO_RETRY_MAX_ATTEMPTS).toBe(3)
    expect(RETRY_BASE_DELAY_MS).toBe(1_000)
    expect(RETRY_MAX_DELAY_MS).toBe(30_000)
    expect(RETRY_JITTER_RATIO).toBeCloseTo(0.2, 10)

    const backoff = Array.from({ length: AUTO_RETRY_MAX_ATTEMPTS }, (_, index) => RETRY_BASE_DELAY_MS * 2 ** index)
    expect(backoff).toEqual([1_000, 2_000, 4_000])
    expect(Math.max(...backoff)).toBeLessThanOrEqual(RETRY_MAX_DELAY_MS)
  })

  it('逐变体渲染超时 = timeouts.renderMs（30 s，详设 §7）', () => {
    expect(RENDER_TIMEOUT_MS).toBe(30_000)
  })

  it('worker 池上限 = min(4, CPU-1) 且至少为 1（详设 §1.2）', () => {
    expect(RENDER_POOL_SIZE).toBe(Math.max(1, Math.min(4, availableParallelism() - 1)))
    expect(RENDER_POOL_SIZE).toBeGreaterThanOrEqual(1)
    expect(RENDER_POOL_SIZE).toBeLessThanOrEqual(G1_VARIANT_COUNT)
  })
})

describe('MOD-008 读取护栏（详设 §5.4：显式上限，不一次拉全量）', () => {
  it('全部扫描/分页护栏为正整数，组合上限自洽', () => {
    const guards = {
      MATERIAL_SCAN_PAGE_SIZE,
      MATERIAL_SCAN_MAX_PAGES,
      RECENT_SCAN_PAGE_SIZE,
      RECENT_SCAN_MAX_PAGES,
      LOOKUP_SCAN_PAGE_SIZE,
      LOOKUP_SCAN_MAX_PAGES,
      HISTORY_PAGE_SIZE,
      HISTORY_MAX_PAGES,
      CONSENT_SCAN_PAGE_SIZE,
      CONSENT_SCAN_MAX_PAGES,
      HOT_MEME_WINDOW_DAYS,
      HOT_MEME_MAX_ITEMS,
    }
    for (const [name, value] of Object.entries(guards)) {
      expect(Number.isInteger(value), name).toBe(true)
      expect(value, name).toBeGreaterThan(0)
    }

    // G3 送入任务的消息单元数 ≤ 引擎单次调用上限 200，且不超过扫描护栏总量
    expect(RECENT_MESSAGE_LIMIT).toBeLessThanOrEqual(200)
    expect(RECENT_MESSAGE_LIMIT).toBeLessThanOrEqual(RECENT_SCAN_PAGE_SIZE * RECENT_SCAN_MAX_PAGES)
    // 生成历史结果上限不超过「每页条数 × 页数上限」
    expect(HISTORY_MAX_RECORDS).toBeLessThanOrEqual(HISTORY_PAGE_SIZE * HISTORY_MAX_PAGES)
  })

  it('画布上限 1080×1080（§4.1 性能假设）与一天毫秒数', () => {
    expect(MAX_CANVAS_SIDE).toBe(1_080)
    expect(DAY_MS).toBe(86_400_000)
  })
})
