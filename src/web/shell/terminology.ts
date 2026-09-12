/**
 * 术语与文案常量、禁用词扫描（`REQ-017`、`docs/design/impl/mod-004-app-shell.md` §8 决策 9）。
 *
 * 口径：
 * - 使用者可见文案不出现英文术语名；`api-contract.md` §1.2 的 14 个英文错误标识属契约层内部标识，
 *   只作数据属性与日志检索（`AC-039` 的阶段 6 裁定），不进界面文案。
 * - 两对专名各自专用：「梗词云」≠「个人标签词云」、「梗生命周期」≠「消息时间轴」。
 * - 本文件是扫描规则的唯一定义处；单测按它扫描 `src/web/**` 的字符串字面量（本文件与 `__tests__/` 除外）。
 */

import { ERROR_CODES } from '@shared'

/** 关键术语文案（组件从这里取词，避免术语散落硬编码）。 */
export const TERMS = {
  /** 应用标题（产品名，非术语名） */
  appName: 'MessagePick',
  /** 四个模块入口名（与 `modules.md` 的模块一 ~ 三、再创作生成一一对应） */
  moduleNames: {
    meme: '梗分析',
    extract: '信息提取',
    social: '社交画像',
    regen: '再创作生成',
  },
  /** 专名（两对专名不得混用、不得互换） */
  viewNames: {
    memeCloud: '梗词云',
    memeLifecycle: '梗生命周期',
    extractTimeline: '消息时间轴',
    socialTagCloud: '个人标签词云',
  },
  /** 通用动作 */
  actions: {
    updateData: '更新数据',
    retry: '重试',
    clearFilter: '一键清除筛选',
    settings: '设置',
    backToMain: '返回主界面',
  },
  /** 数据状态与外壳状态文案 */
  dataStatus: {
    updatedUntilLabel: '记录更新至',
    updatedNever: '尚未更新',
    storageUnavailable: '本地存储不可用',
    readOnly: '只读模式',
    readOnlyHint: '请从应用入口重新打开页面',
  },
  /** 未映射异常的兜底标题（映射常量之外的通用提示） */
  unknownFailureTitle: '未知失败',
  /** 生成物的必备标注（`REQ-013`） */
  creationMark: '创作',
} as const

/** 文案违规类型。 */
export type CopyViolationRule =
  | 'contract-id'
  | 'error-code'
  | 'english-term'
  | 'mixed-term'

/** 单条文案违规（扫描结果）。 */
export interface CopyViolation {
  rule: CopyViolationRule
  message: string
  /** 违规片段（截断到 60 字符，便于断言与展示） */
  text: string
}

/** 契约层编号（API-001 / REQ-017 / MOD-004 / DM-003 / AC-039 / CHG-024）不得出现在界面文案里。 */
const CONTRACT_ID_PATTERN = /\b(?:API|REQ|MOD|DM|AC|CHG)[-_]\d{2,3}\b/

/** 错误标识（由闭集常量生成，闭集变化时扫描口径同步变化）。 */
const ERROR_CODE_PATTERN = new RegExp(`\\b(?:${ERROR_CODES.join('|')})\\b`)

/** 英文技术词（只查大写形态，避免误伤 `/api/...`、`application/json` 这类传输层字面量）。 */
const ENGLISH_TERM_PATTERN = /(?:^|[^A-Za-z])(?:SSE|JSON|HTTP|HTTPS|URL|URI|XHR|CORS|CSRF|UI|UX)(?![A-Za-z])/

/** 含中日韩文字（用来识别「面向使用者的中文文案」）。 */
const CJK_PATTERN = /[\u3400-\u9fff]/

/** 成对专名规则：命中 `pattern` 时，要么必须整体写成 `allowed`，要么不得同时出现 `forbidden`。 */
const MIXED_TERM_RULES: readonly {
  pattern: RegExp
  allowed?: RegExp
  forbidden?: RegExp
  message: string
}[] = [
  {
    pattern: /标签词云/,
    allowed: /个人标签词云/,
    message: '「标签词云」必须写作「个人标签词云」',
  },
  {
    pattern: /梗词云/,
    forbidden: /标签/,
    message: '「梗词云」与「个人标签词云」不得混用',
  },
  {
    pattern: /时间轴/,
    forbidden: /生命周期/,
    message: '「梗生命周期」与「消息时间轴」不得混用',
  },
]

/** 字符串字面量（单引号 / 双引号 / 模板串）。 */
const STRING_LITERAL_PATTERN = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g

/** 进程内持久化痕迹（页面侧状态全部运行期，不落任何持久化位置 —— mod-004 §5.1）。 */
const PERSISTENCE_PATTERN = /\b(?:localStorage|sessionStorage|indexedDB)\b/

function primitiveText(literal: string): string {
  const quote = literal[0]
  const body = literal.slice(1, -1)
  return body.replace(/\\(.)/g, '$1').replace(/\$\{[^}]*\}/g, quote === '`' ? '·' : '$')
}

function truncate(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/**
 * 扫描一段源码里的使用者可见文案违规。
 *
 * 只扫字符串字面量（注释与标识符不参与）：契约编号、错误标识、英文技术词、成对专名混用四类规则。
 */
export function scanUserVisibleCopy(source: string): CopyViolation[] {
  const violations: CopyViolation[] = []
  for (const literal of source.match(STRING_LITERAL_PATTERN) ?? []) {
    const text = primitiveText(literal)
    if (CONTRACT_ID_PATTERN.test(text)) {
      violations.push({ rule: 'contract-id', message: '契约编号不得出现在界面文案', text: truncate(text) })
      continue
    }
    if (ERROR_CODE_PATTERN.test(text)) {
      violations.push({ rule: 'error-code', message: '错误标识不得出现在界面文案', text: truncate(text) })
      continue
    }
    if (ENGLISH_TERM_PATTERN.test(text)) {
      violations.push({ rule: 'english-term', message: '英文技术词不得出现在界面文案', text: truncate(text) })
      continue
    }
    if (!CJK_PATTERN.test(text)) continue
    for (const rule of MIXED_TERM_RULES) {
      if (!rule.pattern.test(text)) continue
      if (rule.allowed && rule.allowed.test(text)) continue
      if (rule.forbidden && !rule.forbidden.test(text)) continue
      violations.push({ rule: 'mixed-term', message: rule.message, text: truncate(text) })
    }
  }
  return violations
}

/** 扫描一段源码是否引入进程外持久化（页面状态只应存在于内存）。 */
export function scanPersistence(source: string): boolean {
  return PERSISTENCE_PATTERN.test(source)
}
