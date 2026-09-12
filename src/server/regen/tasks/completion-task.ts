/**
 * 确认入库的补全任务（mod-008 §3.1「tasks/completion-task」、§8 决策 5）。
 *
 * - 触发时机：`API-033` 确认一个尚未入库的候选时（重复确认不重跑任务）；
 * - 经 `API-007`（任务类型「推断」）；输入 = 候选三字段 + 出处消息；
 * - 输出 = 梗名 / 类型（三分闭集）/ 解读；失败 / 超时 → `ANALYSIS_FAILED` / `TIMEOUT`（状态与库内不变）；
 * - 归属群 = 出处消息所属群（确定性，不由任务给出）。
 */

import type { RawMessage, TaskParams, TaskUnit } from '@shared'
import { MEME_KINDS } from '@shared'

import { completionFromTaskItems, type CompletionResult } from '../domain/validate'
import { runTask, type TaskGateway, type TaskRunOptions, type TaskSuccess } from './gateway'

/** 补全任务入参（候选三字段 + 出处消息）。 */
export interface CompletionTaskInput {
  meaningGuess: string
  usageExample: string
  messages: readonly RawMessage[]
}

/** 任务参数：梗名 / 类型（闭集）/ 解读。 */
export function completionParams(): TaskParams {
  return {
    instruction: [
      '为这条候选梗补全入库字段，只输出一条结果。',
      `name = 梗名（群里对它的叫法，简短）；kind = 类型，只能取：${MEME_KINDS.join(' / ')}；`,
      'interpretation = 一句话解读（什么意思、从哪来、现在怎么用）。',
      '只依据给出的候选与出处消息，不编造。',
    ].join(''),
    outputSchema: {
      type: 'object',
      required: ['name', 'kind', 'interpretation'],
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: [...MEME_KINDS] },
        interpretation: { type: 'string' },
      },
    },
    options: { language: 'zh' },
  }
}

/** 任务输入：候选字段 + 出处消息（`id` = 消息标识）。 */
export function completionUnits(input: CompletionTaskInput): TaskUnit[] {
  const units: TaskUnit[] = [
    { id: 'candidate#meaning', text: `含义推测：${input.meaningGuess}` },
    { id: 'candidate#usage', text: `使用示例：${input.usageExample}` },
  ]
  for (const message of input.messages) {
    units.push({
      id: message.messageId,
      text: message.text !== null && message.text !== '' ? `[${message.kind}] ${message.text}` : `[${message.kind}]`,
    })
  }
  return units
}

/** 执行补全任务并返回已校验的结果。 */
export async function runCompletionTask(
  gateway: TaskGateway,
  input: CompletionTaskInput,
  options: TaskRunOptions = {},
): Promise<{ completion: CompletionResult; task: TaskSuccess }> {
  const task = await runTask(
    gateway,
    {
      taskType: '推断',
      input: { kind: '上下文', units: completionUnits(input) },
      params: completionParams(),
    },
    options,
  )
  return { completion: completionFromTaskItems(task.result.items), task }
}
