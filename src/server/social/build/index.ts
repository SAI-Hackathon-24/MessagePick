/**
 * 构建流水线（mod-007 §3.1「build/」、§3.4、§8 决策 7；`API-007` / `API-008` 的唯一调用面）。
 *
 * - **单飞**：同一时刻最多一个构建在跑（进程内互斥）；构建中重复触发**合并为一次补跑**（决策 7）；
 * - **幂等、可重入**：写操作按记录身份去重；同一输入重复执行结果一致（§4「可重入」）；
 * - **阶段隔离**：任一阶段失败只影响其下游；已落库阶段结果照常可读，状态置 `partial` 并给重试入口
 *   （`REQ-016`、`AC-138`）；有失败的任务引用留在 `pendingTaskRefs`，下次构建先经 `API-008` 重试；
 * - 触发（§3.4）：查询发现索引缺失 / epoch 过期 → `'lazy'` / `'epoch'`；写操作后 → `'after-write'`；
 *   手动重试 → `'retry'`（由外壳或查询方发起，构建本身不引入定时器）。
 */

import type { ErrorEnvelope, TaskRef } from '@shared'

import { socialError, toErrorEnvelope, type SocialLogger } from '../errors'

import { createEngineTaskGateway, type SocialTaskGateway } from './gateway'
import { SocialIndex } from './index-store'
import {
  createWorkspace,
  runStage0,
  runStage1,
  runStage2,
  runStage3,
  runStage4,
  runStage5,
  runStage6,
  runStage7,
  runStage8,
  type StageEnv,
  type StageFailure,
  type StageOutcome,
} from './stages'
import { createWorkerBridge, type WorkerBridge } from './worker-bridge'
import type { SocialStorePort } from '../store'

/** 构建状态机（§5.3）：`idle → building → ready | partial | failed`。 */
export type BuildState = 'idle' | 'building' | 'ready' | 'partial' | 'failed'

/** 触发原因（§3.4：惰性 / epoch / 写后 / 重试）。 */
export type BuildReason = 'lazy' | 'epoch' | 'after-write' | 'retry'

/** 单阶段报告。 */
export interface StageReport {
  stage: number
  name: string
  status: 'ok' | 'failed' | 'skipped'
  /** 失败信封（阶段失败时；`skipped` 无） */
  error?: ErrorEnvelope
  /** 失败任务的任务引用（供 `API-008` 重试） */
  taskRef?: TaskRef
  /** 计数（成功或部分成功时；排障与测试用） */
  counts?: Record<string, number>
}

/** 一次构建的报告。 */
export interface BuildReport {
  state: Exclude<BuildState, 'building'>
  reason: BuildReason
  /** 本次构建开始时的 `dataEpoch` */
  epoch: number
  startedAt: number
  finishedAt: number
  stages: StageReport[]
}

/** 设计声明的构建流水线面（§3.3）。 */
export interface ProfileBuildPipeline {
  readonly state: BuildState
  /** 幂等、可重入；构建中重复触发合并为一次补跑 */
  run(reason: BuildReason): Promise<BuildReport>
}

/** 流水线装配（依赖全部注入；不建连、不读配置文件）。 */
export interface ProfileBuildPipelineOptions {
  store: SocialStorePort
  /** `API-007` / `API-008` 网关；缺省 = 懒加载 MOD-003 进程级引擎 */
  gateway?: SocialTaskGateway
  /** worker 桥；缺省 = 主线程内联 */
  bridge?: WorkerBridge
  /** 与查询层共用的索引实例；缺省新建（应与 `http/` 共用同一实例） */
  index?: SocialIndex
  clock?: () => number
  logger?: SocialLogger
  /** 自然日判定注入点（测试用；缺省按本机时区） */
  dayKey?: (at: number) => string
}

/** 阶段定义（依赖不满足 → `skipped`；失败只影响其下游）。 */
interface StageDef {
  stage: number
  name: string
  deps: readonly number[]
  run(env: StageEnv, index: SocialIndex): Promise<StageOutcome>
}

const STAGE_DEFS: readonly StageDef[] = [
  { stage: 0, name: '人在同步', deps: [], run: (env) => runStage0(env) },
  { stage: 1, name: '互动扫描', deps: [], run: (env) => runStage1(env) },
  { stage: 2, name: '活跃度与回复时长', deps: [1], run: (env) => runStage2(env) },
  { stage: 3, name: '兴趣抽取', deps: [0, 2], run: (env) => runStage3(env) },
  { stage: 4, name: '同义归并', deps: [3], run: (env) => runStage4(env) },
  { stage: 5, name: '维度分与热度分', deps: [4], run: (env) => runStage5(env) },
  { stage: 6, name: '性格推断', deps: [0, 2], run: (env) => runStage6(env) },
  { stage: 7, name: '身份候选', deps: [0], run: (env) => runStage7(env) },
  { stage: 8, name: '索引物化', deps: [0], run: (env, index) => runStage8(env, index) },
]

/** 构建流水线实现（单飞 + 阶段隔离 + 任务重试）。 */
export class SocialBuildPipeline implements ProfileBuildPipeline {
  /** 进程内索引（查询层共用；阶段 8 物化）。 */
  readonly index: SocialIndex

  #state: BuildState = 'idle'
  #report: BuildReport | null = null
  #running: Promise<BuildReport> | null = null
  #queued: BuildReason | null = null
  readonly #retries = new Map<string, TaskRef>()
  readonly #store: SocialStorePort
  readonly #gateway: SocialTaskGateway
  readonly #bridge: WorkerBridge
  readonly #clock: () => number
  readonly #logger: SocialLogger
  readonly #dayKey: ((at: number) => string) | undefined

  constructor(options: ProfileBuildPipelineOptions) {
    this.#store = options.store
    this.#gateway = options.gateway ?? createEngineTaskGateway()
    this.#bridge = options.bridge ?? createWorkerBridge()
    this.index = options.index ?? new SocialIndex()
    this.#clock = options.clock ?? Date.now
    this.#logger = options.logger ?? {}
    this.#dayKey = options.dayKey
  }

  get state(): BuildState {
    return this.#state
  }

  /** 最近一次构建报告（无则空）。 */
  lastReport(): BuildReport | null {
    return this.#report
  }

  /** 失败 / 超时的任务引用（幂等键 → 任务引用）；下次构建先经 `API-008` 重试（§3.1「任务重试」）。 */
  pendingTaskRefs(): ReadonlyMap<string, TaskRef> {
    return this.#retries
  }

  run(reason: BuildReason): Promise<BuildReport> {
    if (this.#running !== null) {
      // 单飞：构建中重复触发合并为一次补跑（决策 7）。
      this.#queued = reason
      this.#logger.debug?.('social.build.merged', { module: 'MOD-007', reason })
      return this.#running
    }
    const epoch = this.#store.currentEpoch()
    this.#state = 'building'
    const running = this.#execute(reason, epoch).then((report) => {
      this.#report = report
      this.#state = report.state
      this.#running = null
      const queued = this.#queued
      this.#queued = null
      return queued === null ? report : this.run(queued)
    })
    this.#running = running
    return running
  }

  async #execute(reason: BuildReason, epoch: number): Promise<BuildReport> {
    const startedAt = this.#clock()
    this.#logger.info?.('social.build.start', { module: 'MOD-007', reason, epoch })
    const workspace = createWorkspace()
    const env: StageEnv = {
      store: this.#store,
      gateway: this.#gateway,
      bridge: this.#bridge,
      clock: this.#clock,
      logger: this.#logger,
      retries: this.#retries,
      workspace,
      ...(this.#dayKey === undefined ? {} : { dayKey: this.#dayKey }),
    }
    const stages: StageReport[] = []
    const satisfied = new Set<number>()

    for (const def of STAGE_DEFS) {
      if (def.deps.some((dep) => !satisfied.has(dep))) {
        stages.push({ stage: def.stage, name: def.name, status: 'skipped' })
        continue
      }
      let outcome: StageOutcome
      try {
        outcome = await def.run(env, this.index)
      } catch (error) {
        const envelope = toErrorEnvelope(error, `social.build.stage${def.stage}`)
        this.#logger.warn?.('social.build.stage.failed', {
          module: 'MOD-007',
          stage: def.stage,
          code: envelope.code,
          scope: envelope.scope,
          message: envelope.message,
        })
        stages.push({ stage: def.stage, name: def.name, status: 'failed', error: envelope })
        continue
      }
      if (outcome.failures.length > 0) {
        const first = outcome.failures[0] as StageFailure
        const envelope: ErrorEnvelope = {
          code: first.code,
          message: first.message,
          retryable: socialError(first.code, first.message, { scope: first.scope }).retryable,
          scope: first.scope,
        }
        this.#logger.warn?.('social.build.stage.failed', {
          module: 'MOD-007',
          stage: def.stage,
          code: envelope.code,
          scope: envelope.scope,
          message: envelope.message,
          taskRef: first.taskRef,
        })
        stages.push({
          stage: def.stage,
          name: def.name,
          status: 'failed',
          error: envelope,
          counts: outcome.counts,
          ...(first.taskRef === undefined ? {} : { taskRef: first.taskRef }),
        })
        continue
      }
      satisfied.add(def.stage)
      stages.push({ stage: def.stage, name: def.name, status: 'ok', counts: outcome.counts })
    }

    const failed = stages.filter((stage) => stage.status === 'failed').length
    const passed = stages.filter((stage) => stage.status === 'ok').length
    const state: BuildReport['state'] = failed === 0 ? 'ready' : passed === 0 ? 'failed' : 'partial'
    const finishedAt = this.#clock()
    this.#logger.info?.('social.build.done', {
      module: 'MOD-007',
      reason,
      epoch,
      state,
      stages: stages.length,
    })
    return { state, reason, epoch, startedAt, finishedAt, stages }
  }
}

/** 装配构建流水线（组合根 / 测试用法；索引与查询层共用时显式传入同一实例）。 */
export function createProfileBuildPipeline(options: ProfileBuildPipelineOptions): ProfileBuildPipeline {
  return new SocialBuildPipeline(options)
}

// ---------------------------------------------------------------------------
// 查询层与装配方共用的导出（§3.1「build/」、§5.2、§3.4）
// ---------------------------------------------------------------------------

export { SocialIndex, buildIndexSnapshot, joinPersonTagLinks } from './index-store'
export type { SocialIndexSnapshot } from './index-store'
export { createEngineTaskGateway, taskRefOf } from './gateway'
export type { SocialTaskGateway } from './gateway'
export { tagHeatScores } from './stages'
