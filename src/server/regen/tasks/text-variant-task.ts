/**
 * G1 / G2 文案变体任务（mod-008 §3.1「tasks/text-variant-task」、§4.1 步骤 3、§4.2）。
 *
 * - 经 `API-007`（任务类型「生成」）；输入 = 梗上下文（解读 / 变体）+ 使用者文案；
 * - 输出结构约束 = 每条一个 `text` 字段；条数与结构校验在 `domain/validate`（失败 → `ANALYSIS_FAILED`）；
 * - G1 = 4 条（同一模板的 4 张变体图），G2 = 默认 5 条（§3.4 / §4.2）。
 */

import type { TaskParams, TaskUnit } from '@shared'

import { G1_VARIANT_COUNT, G2_VARIANT_COUNT } from '../constants'
import { textsFromTaskItems } from '../domain/validate'
import { runTask, type TaskGateway, type TaskRunOptions, type TaskSuccess } from './gateway'
import type { MemeGenerationContext } from '@shared'

/** 文案变体任务的入参（G1 带使用者文案；G2 只用梗上下文）。 */
export interface TextVariantTaskInput {
  /** 用途：G1 表情包文案 / G2 文字变体 */
  purpose: 'G1' | 'G2'
  ctx: MemeGenerationContext
  /** 使用者编辑的文案（仅 G1） */
  text?: string
  /** 期望条数（默认按用途取常数） */
  count?: number
}

/** 任务参数（语义与判定口径由本模块给出；`options` 只做调优旋钮）。 */
export function textVariantParams(input: TextVariantTaskInput): TaskParams {
  const count = input.count ?? (input.purpose === 'G1' ? G1_VARIANT_COUNT : G2_VARIANT_COUNT)
  const instruction =
    input.purpose === 'G1'
      ? [
          `为同一张表情包生成 ${count} 条文案变体。`,
          '每条是一个可直接写进图片的短句，基于梗的解读与使用者文案，风格互不相同（口语 / 反问 / 夸张等）。',
          '不得复述原文；不得包含真实聊天记录的呈现方式；每条只输出一个 text 字段，不输出解释。',
        ].join('')
      : [
          `基于该梗的用法生成 ${count} 条文字变体（可直接在群里使用的说法 / 句式）。`,
          '每条角度不同、语气自然；不得复述原文；每条只输出一个 text 字段，不输出解释。',
        ].join('')
  return {
    instruction,
    outputSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    options: { count, language: 'zh' },
  }
}

/** 任务输入：梗解读 + 相关变体 + 使用者文案（`id` 供来源回溯）。 */
export function textVariantUnits(input: TextVariantTaskInput): TaskUnit[] {
  const units: TaskUnit[] = [
    { id: input.ctx.memeId, text: `梗的解读：${input.ctx.interpretation}` },
  ]
  for (const [index, variantId] of (input.ctx.variantMemeIds ?? []).entries()) {
    units.push({ id: variantId, text: `相关变体 ${index + 1}` })
  }
  if (input.purpose === 'G1') {
    units.push({ id: `${input.ctx.memeId}#使用者文案`, text: `使用者文案：${input.text ?? ''}` })
  }
  return units
}

/** 执行文案变体任务并返回已校验的文案（条数 / 结构 / 互异）。 */
export async function runTextVariantTask(
  gateway: TaskGateway,
  input: TextVariantTaskInput,
  options: TaskRunOptions = {},
): Promise<{ texts: string[]; task: TaskSuccess }> {
  const count = input.count ?? (input.purpose === 'G1' ? G1_VARIANT_COUNT : G2_VARIANT_COUNT)
  const task = await runTask(
    gateway,
    {
      taskType: '生成',
      input: { kind: '上下文', units: textVariantUnits(input) },
      params: textVariantParams({ ...input, count }),
    },
    options,
  )
  return { texts: textsFromTaskItems(task.result.items, count), task }
}
