/**
 * 提示词装配（mod-003 §3.1「prompt/assemble.ts —— 任务参数 + 归一化输入 → 请求 messages」）。
 *
 * 输出 = 系统消息（协议样板）+ 用户消息（任务类型 / 任务说明 / 字段约束 / 调优选项 / 输入单元）。
 * 只装配本次任务所需内容（详设 §4.3：调用方未给的内容不出站）。
 */

import type { TaskParams, TaskType } from '@shared'

import type { NormalizedUnit } from '../registry'
import { protocolPreamble } from './protocol'

/** 模型消息（OpenAI 兼容 chat messages 的最小形态）。 */
export interface ModelMessage {
  role: 'system' | 'user'
  content: string
}

/** 装配一次模型调用的 messages（每个块各装配一次；编号全任务唯一，引用不跨块串错）。 */
export function buildMessages(args: {
  taskType: TaskType
  params: TaskParams
  units: readonly NormalizedUnit[]
}): ModelMessage[] {
  const { taskType, params, units } = args

  const sections: string[] = [
    `# 任务类型\n${taskType}`,
    `# 任务说明\n${params.instruction}`,
    `# 输出条目字段约束\n${JSON.stringify(params.outputSchema, null, 2)}`,
  ]

  if (params.options && Object.keys(params.options).length > 0) {
    sections.push(`# 调优选项\n${JSON.stringify(params.options, null, 2)}`)
  }

  sections.push(`# 输入单元\n${units.map(renderUnit).join('\n\n')}`)
  sections.push('# 输出\n只输出 {"items": [ ... ]} 的 JSON；每个条目携带 sourceRefs（输入单元编号或标识）。')

  return [
    { role: 'system', content: protocolPreamble() },
    { role: 'user', content: sections.join('\n\n') },
  ]
}

function renderUnit(unit: NormalizedUnit): string {
  return `【输入单元 ${unit.marker}】\n标识: ${unit.id}\n内容:\n${unit.text}`
}
