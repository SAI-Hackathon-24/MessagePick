/**
 * 模型任务网关（mod-007 §3.1「build/」的任务重试、§2「模型任务经 API-007 / API-008」）。
 *
 * - `execute` = `API-007`；`retry` = `API-008`（失败 / 超时的任务按任务引用重试；重试成功后结果由本模块落库）；
 * - 默认绑定 MOD-003 的进程级引擎（动态 import：测试注入替身时不加载引擎；先例见 `meme/engine/analysisGateway.ts`）；
 * - 失败 / 超时的任务引用按 mod-003 约定从 `error.scope`（`task:<ref>`）取回（`taskRefOf`）。
 */

import type { Api007Request, ErrorEnvelope, TaskOutcome, TaskRef } from '@shared'

/** 任务执行与重试的最小面（测试注入 mock，不真调模型）。 */
export interface SocialTaskGateway {
  /** `API-007`：执行任务。 */
  execute(req: Api007Request): Promise<TaskOutcome>
  /** `API-008`：按任务引用重试失败 / 超时的任务。 */
  retry(taskRef: TaskRef): Promise<TaskOutcome>
}

const TASK_SCOPE_PREFIX = 'task:'

/** 从失败 / 超时的错误信封取回任务引用；无引用（非任务类失败）返回 `null`。 */
export function taskRefOf(error: ErrorEnvelope): TaskRef | null {
  if (typeof error.scope !== 'string' || !error.scope.startsWith(TASK_SCOPE_PREFIX)) return null
  const ref = error.scope.slice(TASK_SCOPE_PREFIX.length)
  return ref.length > 0 ? ref : null
}

let engineModule: Promise<typeof import('@server/engine')> | null = null

/** 绑定 MOD-003 进程级引擎的默认网关（懒加载；模块内不出现模型地址与凭据）。 */
export function createEngineTaskGateway(): SocialTaskGateway {
  return {
    execute: async (req) => {
      engineModule ??= import('@server/engine')
      const engine = await engineModule
      return engine.executeTask(req)
    },
    retry: async (taskRef) => {
      engineModule ??= import('@server/engine')
      const engine = await engineModule
      return engine.retryTask(taskRef)
    },
  }
}
