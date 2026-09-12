/**
 * G3 新梗候选任务（mod-008 §3.1「tasks/candidate-task」、§4.3）。
 *
 * - 经 `API-007`（任务类型「生成」）；输入 = 消息集合 + 分析结果引用；
 * - 任务参数给出候选结构（含义推测 / 出处消息引用 / 使用示例）与条数上限 1–2（本模块定义）；
 * - 校验（`domain/validate`）失败的候选逐条丢弃并记日志，不落半成品；
 * - 确认前不进词云等视图（REQ-038）；历史记录与候选一并落库（§4.3）。
 */

import type { RawMessage, TaskParams, TaskResultItem, TaskUnit } from '@shared'

import { CANDIDATE_MAX_COUNT } from '../constants'
import { runTask, type TaskGateway, type TaskRunOptions, type TaskSuccess } from './gateway'

/** 候选任务入参（消息来自「近期消息范围」的读取护栏内）。 */
export interface CandidateTaskInput {
  messages: readonly RawMessage[]
  /** 调用方已有的分析结果引用（选填） */
  analysisRefs?: readonly string[] | null
}

/** 任务参数：候选结构与条数上限。 */
export function candidateParams(input: CandidateTaskInput): TaskParams {
  return {
    instruction: [
      `从输入消息中识别潜在的「新梗」候选，最多 ${CANDIDATE_MAX_COUNT} 条。`,
      '每条候选：meaningGuess = 一句话含义推测；usageExample = 一个使用示例（可在群里照做的用法）；',
      'sourceRefs = 出处消息的输入单元编号（1 起）或输入标识数组，至少一个，且必须来自输入消息；',
      '没有把握的不要输出；只依据输入消息，不编造。',
    ].join(''),
    outputSchema: {
      type: 'object',
      required: ['meaningGuess', 'sourceRefs', 'usageExample'],
      properties: {
        meaningGuess: { type: 'string' },
        sourceRefs: { type: 'array' },
        usageExample: { type: 'string' },
      },
    },
    options: { maxCandidates: CANDIDATE_MAX_COUNT, language: 'zh' },
  }
}

/** 任务输入：消息集合（`id` = 消息标识，供出处回溯）+ 分析结果引用。 */
export function candidateUnits(input: CandidateTaskInput): TaskUnit[] {
  const units: TaskUnit[] = input.messages.map((message) => ({
    id: message.messageId,
    text: message.text !== null && message.text !== '' ? `[${message.kind}] ${message.text}` : `[${message.kind}]`,
  }))
  for (const ref of input.analysisRefs ?? []) {
    units.push({ id: `analysis:${ref}`, text: `已有分析结果引用：${ref}` })
  }
  return units
}

/** 执行候选任务（返回原始条目与输入单元；校验在用例层按 `domain/validate` 完成）。 */
export async function runCandidateTask(
  gateway: TaskGateway,
  input: CandidateTaskInput,
  options: TaskRunOptions = {},
): Promise<{ items: TaskResultItem[]; units: TaskUnit[]; task: TaskSuccess }> {
  const units = candidateUnits(input)
  const task = await runTask(
    gateway,
    {
      taskType: '生成',
      input: { kind: '消息集合', units },
      params: candidateParams(input),
    },
    options,
  )
  return { items: task.result.items, units, task }
}
