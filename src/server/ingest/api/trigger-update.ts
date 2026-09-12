/**
 * `API-001` 触发更新 —— 契约薄层（mod-001 §3.1「api/trigger-update.ts」、§4.1、§6.2）。
 *
 * - 调用链：校验入参（`targetSource` 只接受两个来源枚举，非法值防御性返回 `INVALID_INPUT`）
 *   → `executor.submit()` → 组装出参（分来源结果）与批次级错误信封（§6.2 的三条规则）；
 * - 不含业务逻辑；运行结束（挂接时 = 被挂接运行的结束）后才组装出参；
 * - 出参与运行报告一并返回：`report` 供组合根登记 / 分项呈现，`data` / `error` 对应契约出参与信封。
 */

import type {
  Api001Request,
  Api001Response,
  ErrorEnvelope,
  IngestFailureDetail,
  IngestSourceResult,
} from '@shared'
import { INGEST_SOURCES } from '@shared'

import { invalidInputEnvelope, overallEnvelope } from '../errors'
import type { IngestExecutor, RunReport } from '../run/executor'
import { contractStatusOf, type CollectOutcome } from '../sources/source'

/** `API-001` 实现结果：成功给出出参，批次级失败给出统一错误信封；两种情况都带运行报告。 */
export type TriggerUpdateOutcome =
  | { ok: true; data: Api001Response; report: RunReport }
  | { ok: false; error: ErrorEnvelope; report: RunReport }

/** 创建 `API-001` 实现（绑定到给定执行器；装配见 `index.ts`）。 */
export function createTriggerUpdate(options: { executor: IngestExecutor }): (req: Api001Request) => Promise<TriggerUpdateOutcome> {
  const { executor } = options

  return async (req) => {
    const target = req.targetSource ?? undefined
    if (target !== undefined && !(INGEST_SOURCES as readonly string[]).includes(target)) {
      // 防御性入参校验（值不在闭集内 → `INVALID_INPUT`，不进入运行）
      return {
        ok: false,
        error: invalidInputEnvelope(`目标来源非法：${String(target)}（取值集合见 DM-001）`, {
          targetSource: String(target),
        }),
        report: { sources: [] },
      }
    }

    const report = await executor.submit(target === undefined ? {} : { targetSource: target })
    const data: Api001Response = { sources: report.sources.map(toSourceResult) }
    if (report.overallCode === undefined) {
      // §6.2 规则 1：全部来源成功 → 不产生错误标识
      return { ok: true, data, report }
    }
    // §6.2 规则 2 / 3：部分失败 / 全失败 → 批次级标识 + 未成功来源明细（`context.sources`）
    return { ok: false, error: overallEnvelope(report.overallCode, failureDetails(report.sources)), report }
  }
}

/** `CollectOutcome` → 契约出参的「来源结果」（状态转契约枚举；完成时间仅成功来源给出）。 */
function toSourceResult(outcome: CollectOutcome): IngestSourceResult {
  return {
    source: outcome.source,
    status: contractStatusOf(outcome.status),
    written: outcome.written,
    failures: outcome.subFailures.map(
      (item): IngestFailureDetail => ({ scope: item.scope, code: item.code, reason: item.reason }),
    ),
    completedAt: outcome.completedAt ?? null,
  }
}

/** §6.2 规则 2 / 3 的明细：只列未成功来源（来源 + 状态 + 标识 + 原因）。 */
function failureDetails(
  outcomes: readonly CollectOutcome[],
): { source: string; status: string; code?: ErrorEnvelope['code']; reason?: string }[] {
  return outcomes
    .filter((outcome) => outcome.status !== 'succeeded')
    .map((outcome) => ({
      source: outcome.source,
      status: contractStatusOf(outcome.status),
      ...(outcome.failure === undefined ? {} : { code: outcome.failure.code, reason: outcome.failure.reason }),
    }))
}
