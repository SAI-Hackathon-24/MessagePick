/**
 * 经 `API-007` / `API-008` 的任务执行与重试（mod-005 §3.1「engine/AnalysisGateway」）。
 *
 * - 一切模型调用经本网关；模块内不出现模型地址、凭据与 SDK 调用点（§2 实现侧硬边界）。
 * - 默认实现绑定 MOD-003 的进程级引擎（动态 import：测试注入替身时不会加载引擎）。
 * - `taskRefFromEnvelope`：按 mod-003 §6.1 的既有约定从 `scope`（`task:<ref>`）取回任务引用。
 */

import type { Api007Request, ErrorEnvelope, TaskOutcome, TaskRef } from '@shared'

/** 任务执行与重试的最小接口（测试注入 mock，不真调云端）。 */
export interface AnalysisGateway {
  /** `API-007`：执行任务。 */
  execute(req: Api007Request): Promise<TaskOutcome>
  /** `API-008`：按任务引用重试失败 / 超时的任务。 */
  retry(taskRef: TaskRef): Promise<TaskOutcome>
}

const TASK_SCOPE_PREFIX = 'task:'

/** 从失败 / 超时的错误信封取回任务引用（mod-003 约定的 `scope = task:<ref>`）。 */
export function taskRefFromEnvelope(error: ErrorEnvelope): TaskRef | null {
  if (typeof error.scope !== 'string' || !error.scope.startsWith(TASK_SCOPE_PREFIX)) return null
  const ref = error.scope.slice(TASK_SCOPE_PREFIX.length)
  return ref.length > 0 ? ref : null
}

/** 构造失败 / 超时信封（供编排层与测试使用；`scope` 携带任务引用）。 */
export function taskErrorEnvelope(code: ErrorEnvelope['code'], message: string, taskRef: TaskRef): ErrorEnvelope {
  return { code, message, retryable: true, scope: `${TASK_SCOPE_PREFIX}${taskRef}`, context: { taskRef } }
}

let engineModule: Promise<typeof import('@server/engine')> | null = null

function loadEngine(): Promise<typeof import('@server/engine')> {
  engineModule ??= import('@server/engine')
  return engineModule
}

/** 绑定 MOD-003 进程级引擎的默认网关（动态 import，保持模块边界清晰）。 */
export function createEngineGateway(): AnalysisGateway {
  return {
    execute: async (req) => {
      const engine = await loadEngine()
      return engine.executeTask(req)
    },
    retry: async (taskRef) => {
      const engine = await loadEngine()
      return engine.retryTask(taskRef)
    },
  }
}
