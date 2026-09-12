/**
 * MOD-003 模块常数（mod-003 §3.1「policy/limits.ts —— 模块常数」）。
 *
 * 口径来源：
 * - mod-003 决策 4：分块上限（可分块类型逐块串行；不可分块类型超限 → INVALID_INPUT / INPUT_TOO_LARGE）。
 * - mod-003 决策 7：worker 阈值与池上限（`min(2, CPU−1)`；单机 1 核时退化为 1）。
 * - 详设 §2.3：退避 `1 s → 2 s → 4 s`、上限 30 s、±20% 抖动、熔断阈值 5 次 / 暂停 60 s。
 * - 详设 §5.4：查询护栏（模块内给显式上限，不无限放大单次调用）。
 *
 * 这些常数集中在实现层，按模型上下文窗口校准；不新增配置键（mod-003 决策 4 后果）。
 */

import { availableParallelism } from 'node:os'

/** 自动重试与熔断常数（详设 §2.3；不随配置文件变化）。 */
export interface RetryLimits {
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
  readonly breakerThreshold: number
  readonly breakerPauseMs: number
}

/** 模块级实现常数。测试可通过 `createEngine({ limits })` 局部覆盖以缩小规模。 */
export interface EngineLimits {
  /** 任务注册表 LRU 容量（mod-003 §5.3：淘汰后旧引用 → INVALID_INPUT）。 */
  readonly registryCapacity: number
  /** 可分块类型的单块消息条数上限。 */
  readonly chunkMaxUnits: number
  /** 不可分块类型单次调用的消息条数上限。 */
  readonly singleCallMaxUnits: number
  /** 不可分块类型单次调用的输入文本总长上限（字符）。 */
  readonly singleCallMaxChars: number
  /** 单任务输入单元总数上限（护栏）。 */
  readonly maxUnitsPerTask: number
  /** 响应体字符数达到该值 → 解析交 worker（mod-003 决策 7）。 */
  readonly workerDecodeMinChars: number
  /** 输入单元数达到该值 → 解析交 worker（结果条目数的代理指标）。 */
  readonly workerDecodeMinUnits: number
  /** worker 池上限（`min(2, CPU−1)`，下限 1）。 */
  readonly workerPoolSize: number
  readonly retry: RetryLimits
}

/** 默认模块常数（数值可按实现期校准；修改需同步 mod-003 决策 4 / 7 的口径）。 */
export const ENGINE_LIMITS: EngineLimits = {
  registryCapacity: 200,
  chunkMaxUnits: 40,
  /* 2026-09-13 校准：标签聚类等整入单次调用的输入随构建范围增长（实测 241 个标签即撞
     原 200 上限 → stage4 INPUT_TOO_LARGE）；上调至 400（提示词仍远小于模型上下文）。 */
  singleCallMaxUnits: 400,
  singleCallMaxChars: 120_000,
  maxUnitsPerTask: 2_000,
  workerDecodeMinChars: 262_144,
  workerDecodeMinUnits: 400,
  workerPoolSize: Math.max(1, Math.min(2, availableParallelism() - 1)),
  retry: {
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    jitterRatio: 0.2,
    breakerThreshold: 5,
    breakerPauseMs: 60_000,
  },
}
