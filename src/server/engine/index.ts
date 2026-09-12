/**
 * MOD-003 智能分析引擎 —— 模块出口（mod-003 §3.1「index.ts」）。
 *
 * 供四个调用方模块（MOD-005 ~ MOD-008）与外壳（MOD-004）使用：
 *
 * ```ts
 * import { executeTask, retryTask, taskRefFromEnvelope } from '@server/engine'
 *
 * const outcome = await executeTask({ taskType: '识别', input, params })   // API-007
 * if (!outcome.ok) {
 *   const ref = taskRefFromEnvelope(outcome.error)                          // 失败 / 超时也带任务引用
 *   const again = await retryTask(ref!)                                     // API-008
 * }
 * ```
 *
 * 出口边界（§2、§3.1）：
 * - 无 HTTP 路由、无界面入口；除本文件外，`engine/` 下其它文件不得被其他模块 import。
 * - 引擎不读写持久化、不定义业务语义（判定口径全部来自调用方 `params`）。
 * - 外壳接线：`configureEngine(config.json 的 model.* / timeouts.* / retry.*)` 灌配置，
 *   `engineEvents.subscribe(...)` 转发 SSE，`notifyDataEpoch(...)` 在数据 epoch 递增时清空注册表。
 */

import type { Api007Request, TaskOutcome, TaskRef } from '@shared'

import { configureEngine, createEngineConfig, engineConfig, type EngineConfig, type EngineConfigPatch } from './config'
import { createEngine, Engine, type EngineOptions } from './executor'
import {
  createNoopLogSink,
  engineEvents,
  EngineEventChannel,
  type EngineCounters,
  type EngineEventCounts,
  type EngineLogEntry,
  type EngineLogSink,
  type EngineTaskEvent,
  type EngineTaskState,
} from './events'
import { ENGINE_LIMITS } from './policy/limits'
import { PROTOCOL_VERSION } from './prompt/protocol'
import { taskRefFromEnvelope, taskScope } from './task-ref'

/** 进程级默认引擎实例（包装好的模块出口函数都绑定到它）。 */
export const engine: Engine = createEngine()

/** `API-007` 执行任务（统一执行五类模型任务并返回结果与引用）。 */
export function executeTask(req: Api007Request): Promise<TaskOutcome> {
  return engine.executeTask(req)
}

/** `API-008` 重试任务（按任务引用重试失败 / 超时的任务，返回新的任务引用）。 */
export function retryTask(ref: TaskRef): Promise<TaskOutcome> {
  return engine.retryTask(ref)
}

/** 只读计数：队列长度与进行中数量（供外壳展示，§4.3）。 */
export function engineCounters(): EngineCounters {
  return engine.getCounters()
}

/** dataEpoch 递增（更新完成 / 删除完成 / 改判落库 / 迁移完成）→ 清空注册表，旧引用失效（§5.3）。 */
export function notifyDataEpoch(epoch: number): void {
  engine.notifyDataEpoch(epoch)
}

/** 进程收尾：`queued` 任务转 `canceled`（§5.2）。 */
export function shutdownEngine(): void {
  engine.shutdown()
}

export { configureEngine, createEngine, createEngineConfig, engineConfig, Engine, EngineEventChannel, ENGINE_LIMITS, engineEvents, PROTOCOL_VERSION, taskRefFromEnvelope, taskScope }
export type { EngineConfig, EngineConfigPatch, EngineOptions, EngineCounters, EngineEventCounts, EngineLogEntry, EngineLogSink, EngineTaskEvent, EngineTaskState }
export type { Api007Request, Api007Response, Api008Request, Api008Response, ErrorEnvelope, SourceRef, TaskInput, TaskOutcome, TaskParams, TaskRef, TaskType, TaskUnit } from '@shared'
export { createNoopLogSink }
