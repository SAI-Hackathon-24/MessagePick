/**
 * 模型任务参数（mod-005 §3.1「engine/taskParams.ts」、§6）。
 *
 * 任务语义与判定口径（词表 / 闭集 / 来源引用要求）由本模块给出，经 `API-007` 传给 MOD-003；
 * 引擎只做协议层浅校验（mod-003 决策 2）。本文件不 import 模型 SDK、不含地址与凭据。
 */

import type { TaskOutputSchema, TaskParams } from '@shared'

import { ESSENCE_CANDIDATE_MESSAGES, TYPE_CLOSED_SET, WORDCLOUD_MAX_TERMS } from '../constants'
import type { MemeTaskKind } from '../domain/tasks'

/** 输出条目字段约束（浅校验子集：type / required / properties / enum）。 */
const RECOGNIZE_SCHEMA: TaskOutputSchema = {
  type: 'object',
  required: ['name', 'kind', 'interpretation', 'sourceRefs'],
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: [...TYPE_CLOSED_SET] },
    interpretation: { type: 'string' },
    sourceRefs: { type: 'array' },
  },
}

const VARIANT_SCHEMA: TaskOutputSchema = {
  type: 'object',
  required: ['representative', 'members', 'sourceRefs'],
  properties: {
    representative: { type: 'string' },
    members: { type: 'array' },
    sourceRefs: { type: 'array' },
  },
}

const ESSENCE_SCHEMA: TaskOutputSchema = {
  type: 'object',
  required: ['sourceRefs'],
  properties: {
    note: { type: 'string' },
    sourceRefs: { type: 'array' },
  },
}

const INSTRUCTIONS: Readonly<Record<MemeTaskKind, string>> = {
  识别: [
    '从输入消息中识别群聊里的梗。',
    '每个结果条目给出一条梗：name = 梗名（出现在消息里的说法）；kind = 类型，只能取：口头禅 / 内部梗 / 表情包梗；',
    'interpretation = 一句话解读，必须覆盖「什么意思、从哪来、现在怎么用」三要素；',
    'sourceRefs = 这条梗被实际使用的每条消息编号（1 起）或输入标识数组：该消息本身要含有这条梗的文本形式或其直接变体（省写、加字、等价说法）；',
    '只在讨论 / 解释 / 给梗起名、而消息里没用到这条梗的上下文消息，不要计入；表情包梗计实际发送该表情包的消息；',
    '没有实际使用消息时可输出空数组，不要用讨论消息凑数；只依据输入消息，不编造；同一梗名只输出一条。',
  ].join(''),
  变体: [
    '把输入列表里属于同一梗的衍生说法聚成簇。',
    '每个结果条目一个簇：representative = 该簇的代表说法（取自输入中的说法）；',
    'members = 该簇全部成员的输入单元编号（1 起）或输入标识数组，至少两个；sourceRefs 同 members；',
    '只允许把同一群里的说法聚为一簇，不做跨群归并；没有衍生关系的说法不要凑簇。',
  ].join(''),
  精华: [
    '从输入消息中选出最能代表该梗的精华消息，按推荐顺序输出。',
    '每个结果条目一条精华消息：sourceRefs = 该消息的输入单元编号（1 起）或输入标识数组；',
    `最多输出 ${ESSENCE_CANDIDATE_MESSAGES} 条以内的消息，按推荐展示顺序排列；只依据输入消息，不编造。`,
  ].join(''),
}

/** 构造某类分项的任务参数（`options` 只做调优旋钮，不改变判定口径）。 */
export function buildTaskParams(kind: MemeTaskKind, options: Record<string, unknown> = {}): TaskParams {
  switch (kind) {
    case '识别':
      return {
        instruction: INSTRUCTIONS.识别,
        outputSchema: RECOGNIZE_SCHEMA,
        options: { lang: 'zh', maxTerms: WORDCLOUD_MAX_TERMS, ...options },
      }
    case '变体':
      return {
        instruction: INSTRUCTIONS.变体,
        outputSchema: VARIANT_SCHEMA,
        options: { lang: 'zh', ...options },
      }
    case '精华':
      return {
        instruction: INSTRUCTIONS.精华,
        outputSchema: ESSENCE_SCHEMA,
        options: { lang: 'zh', maxPicks: ESSENCE_CANDIDATE_MESSAGES, ...options },
      }
  }
}
