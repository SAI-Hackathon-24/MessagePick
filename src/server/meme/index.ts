/**
 * MOD-005 梗分析（模块一）—— 模块出口与装配（mod-005 §3.1「index.ts」、§3.3、§4）。
 *
 * 组装依赖（存储网关、引擎网关、时钟）并导出模块入口；不自行建连、不读配置文件（§3.1）。
 * 组合根（`MOD-004`）的接线方式：
 *
 * ```ts
 * import { createMemeModule } from '@server/meme'
 *
 * const meme = createMemeModule({ store })            // store = MOD-002 门面（API-003 / API-004）
 * await meme.queryCloud({ layout: '按热度' })          // API-009
 * await meme.queryCell({ memeId })                    // API-010
 * await meme.queryLifecycle({ months })               // API-011
 * await meme.applyCorrection({ memeId, correction })  // API-012
 * await meme.queryMine({ view: '我用过的' })           // API-013
 * meme.startBatch('ingestDone', scope)                // 采集完成后后台触发（HLD 决策 9）
 * meme.orchestrator.items() / retryItem(item, taskRef) // 进度与失败重试（API-008）
 * ```
 *
 * 出错约定（§6）：5 条用例以 `MemeError` 抛出，`envelope` 即统一错误信封
 * （`{ code, message, retryable, scope, context }`），外壳按信封映射 HTTP 响应。
 *
 * 依赖方向：只消费 `MOD-002`（API-003 / API-004）与 `MOD-003`（API-007 / API-008）；
 * 不 import `MOD-006` / `MOD-007` / `MOD-008`（跨模块数据由外壳转交）。
 */

import type { MemeDeps, MemeDepsOptions } from './app/context'
import { resolveDeps } from './app/context'
import { applyCorrection as applyCorrectionCase } from './app/correction'
import { isMemeError, MemeError } from './app/errors'
import { AnalysisOrchestrator, type BatchHandle, type TaskItem } from './app/orchestrator'
import {
  queryCloud as queryCloudCase,
  queryCell as queryCellCase,
  queryLifecycle as queryLifecycleCase,
  queryMine as queryMineCase,
} from './app/queries'
import { MemeStore } from './store/memeStore'
import type { StorePort } from './store/port'
import type {
  BatchCause,
  CellOutput,
  CellQueryInput,
  CloudOutput,
  CloudQueryInput,
  CorrectionInput,
  CorrectionOutput,
  LifecycleOutput,
  LifecycleQueryInput,
  MineOutput,
  MineQueryInput,
  ScopeFilter,
} from './types'

// ---------------------------------------------------------------------------
// 装配（依赖全部由组合根注入；本文件不建连、不读配置文件）
// ---------------------------------------------------------------------------

/** 模块装配选项（存储网关必填；其余为可注入点，缺省值在 `app/context.ts` 集中给出）。 */
export interface MemeModuleOptions extends Omit<MemeDepsOptions, 'store'> {
  /** `MOD-002` 门面（`API-003` / `API-004`）；结构化满足 `StorePort`，模块内不打开数据库。 */
  store: StorePort
}

/** 模块出口（`MOD-004` 只依赖这些成员；签名与 mod-005 §3.3 一致）。 */
export interface MemeModule {
  /** `API-009` 查询梗词云（大结果集按 §3.6 下沉 worker / 主线程分批）。 */
  queryCloud(input: CloudQueryInput): Promise<CloudOutput>
  /** `API-010` 查询梗单元（`NOT_FOUND` 覆盖删除 / 合并 / 不是梗三类，AC-045）。 */
  queryCell(input: CellQueryInput): Promise<CellOutput>
  /** `API-011` 查询生命周期视图。 */
  queryLifecycle(input: LifecycleQueryInput): Promise<LifecycleOutput>
  /** `API-012` 提交纠正改判（成功后立即影响后续查询，REQ-008）。 */
  applyCorrection(input: CorrectionInput): Promise<CorrectionOutput>
  /** `API-013` 查询「我相关」梗（两视角不互斥，AC-017）。 */
  queryMine(input: MineQueryInput): Promise<MineOutput>
  /** 进程内编排入口（非 HTTP、非 `API-###`）：采集完成后触发；重复触发按缺块判定（§3.6、决策 5）。 */
  startBatch(cause: BatchCause, scope?: ScopeFilter): BatchHandle
  /** 手动重试失败分项（`API-008`）；成功后立即落库（§3.5 状态机 A）。 */
  retryItem(item: TaskItem, taskRef: string): Promise<void>
  /** 编排器实例（注册 warmup / 观测批次用）。 */
  readonly orchestrator: AnalysisOrchestrator
}

/** 装配模块：存储经 `MemeStore` 适配，模型经 `AnalysisGateway`（缺省绑定 MOD-003 引擎）。 */
export function createMemeModule(options: MemeModuleOptions): MemeModule {
  const { store, ...rest } = options
  const deps: MemeDeps = resolveDeps({ ...rest, store: new MemeStore(store) })
  const orchestrator = new AnalysisOrchestrator(deps)
  return {
    queryCloud: (input) => queryCloudCase(deps, input),
    queryCell: (input) => queryCellCase(deps, input),
    queryLifecycle: (input) => queryLifecycleCase(deps, input),
    applyCorrection: (input) => applyCorrectionCase(deps, input),
    queryMine: (input) => queryMineCase(deps, input),
    startBatch: (cause, scope) => orchestrator.startBatch(cause, scope),
    retryItem: (item, taskRef) => orchestrator.retryItem(item, taskRef),
    orchestrator,
  }
}

// ---------------------------------------------------------------------------
// 再导出（mod-005 §3.3 签名级声明面；实现细节不外泄）
// ---------------------------------------------------------------------------

// 编排（进程内入口）
export { AnalysisOrchestrator }
export type { BatchHandle, BatchResult, BatchItemState, TaskItem, BatchStatus, BatchItemStatus } from './app/orchestrator'

// 域纯函数（§3.3：Metrics / Visibility / Correction）
export { computeCloudTerms, computeCellMetrics, computeLifecycle, pickHighlights } from './domain/metrics'
export { resolveVisibility, normalize } from './domain/visibility'
export { checkMerge } from './domain/correction'

// 存储适配（只经 API-003 / API-004）与读写端口
export { MemeStore }
export type { MemeStoreOptions } from './store/memeStore'
export type { StorePort, StoreWriteOptions } from './store/port'

// 引擎网关（只经 API-007 / API-008）
export type { AnalysisGateway } from './engine/analysisGateway'

// 错误形态（§6：信封原样上抛，code 只取契约层既有标识）
export { MemeError, isMemeError }

// 装配类型（组合根按需引用；不导出内部实现）
export type { MemeDeps, MemeDepsOptions, MemeLimits, MemeLogger, RetryPolicy } from './app/context'
export type { AggregateOptions } from './worker/aggregate'
export type { MemeTaskKind, RecognitionDraft, VariantClusterDraft, EssencePickDraft, UnitRef, DraftResult } from './domain/tasks'
export type { VisibilityEntry, VisibilityIndex, VisibilityState } from './domain/visibility'
export type { MergeCheck, MergeRejectReason } from './domain/correction'
export type { CellMetrics, CloudTermSource, FoldedMeme, LifecycleSource, LifecycleViewRow } from './domain/metrics'

// 契约出入参（模块侧视图类型；外壳直接透传）
export type {
  BatchCause,
  CellOutput,
  CellQueryInput,
  CloudOutput,
  CloudQueryInput,
  CloudTermView,
  CorrectionInput,
  CorrectionOutput,
  LifecycleOutput,
  LifecycleQueryInput,
  MineOutput,
  MineQueryInput,
  ScopeFilter,
} from './types'
