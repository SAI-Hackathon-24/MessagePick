/**
 * 组局建议编排（mod-007 §3.1「suggest/」、§4 `API-024`、§6；`REQ-063`、`AC-108` / `AC-109`）。
 *
 * - **只出文字**：不含待办、不含可直接发送给群成员的文案（`REQ-063`）；
 * - **不落库、不生成待办、不执行任何社交动作**：本模块没有写路径（`REQ-083` ~ `REQ-085`）；
 * - 单次生成任务（`API-007`），每次调用都是一次新的生成（无幂等要求）；超时按 `TIMEOUT` 透传；
 * - 候选为空 → `EMPTY_RESULT`（`AC-109`）——由 `http/` 在进入任务前判定。
 */

import type { Api007Request, Id, TaskParams, TaskResult, TaskResultItem } from '@shared'

/** 组局建议的候选人（成员标识 + 展示名；展示名只进任务输入，不写日志）。 */
export interface GroupActivityCandidate {
  memberId: Id
  displayName: string
}

/** 一次组局建议的输入。 */
export interface GroupActivityInput {
  /** 选定兴趣（兴趣 → 人结果中选定） */
  interest: string
  /** 候选人集合（由调用方给出；空集不进入本编排，`AC-109`） */
  candidates: readonly GroupActivityCandidate[]
}

/** 生成任务的输出约束：单个 `text` 字段（引擎据此浅校验）。 */
export const GROUP_ACTIVITY_OUTPUT_SCHEMA: TaskParams['outputSchema'] = {
  type: 'object',
  required: ['text'],
  properties: {
    text: { type: 'string' },
  },
}

/** 任务口径：只写建议文字，不生成待办、不生成可直接发送的文案（负向边界写进指令）。 */
export const GROUP_ACTIVITY_INSTRUCTION =
  '围绕选定兴趣与候选人，生成一段面向使用者的组局建议（活动点子、组局方式、注意事项）。' +
  '只输出建议文字本身：不要生成待办事项，不要生成可以直接发送给群成员的聊天文案，不要输出多余解释。'

/** 「选定兴趣 + 候选人」→ 生成任务入参（`API-007`）。 */
export function buildGroupActivityRequest(input: GroupActivityInput): Api007Request {
  return {
    taskType: '生成',
    input: {
      kind: '上下文',
      units: [
        { id: 'interest', text: `选定兴趣：${input.interest}` },
        ...input.candidates.map((candidate) => ({
          id: `candidate:${candidate.memberId}`,
          text: `候选人：${candidate.displayName}`,
        })),
      ],
    },
    params: {
      instruction: GROUP_ACTIVITY_INSTRUCTION,
      outputSchema: GROUP_ACTIVITY_OUTPUT_SCHEMA,
      options: { format: '纯文字', language: 'zh' },
    },
  }
}

/** 解析生成任务产出的文字（只认第一条非空文字；无 → `null`，由调用方转 `EMPTY_RESULT`）。 */
export function parseGroupActivityText(result: TaskResult): string | null {
  for (const item of result.items) {
    const text = textOf(item)
    if (text !== null && text.trim() !== '') return text.trim()
  }
  return null
}

function textOf(item: TaskResultItem): string | null {
  for (const key of ['text', 'suggestion'] as const) {
    const value = item[key]
    if (typeof value === 'string') return value
  }
  return null
}
