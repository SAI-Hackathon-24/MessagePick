/**
 * MOD-005 模块级视图类型：契约出参（`src/shared/contracts.ts`）的模块侧直接使用与少量
 * **截断标记 / 标注字段**扩展。
 *
 * 说明（mod-005 §4、§5.4 的硬要求）：契约出参表未列「截断标记与总数」「不完整月份标注」
 * 「精华图片引用」等字段，但模块设计明确要求在响应中随数据返回（词云/生命周期/我相关的截断
 * 标记与总数、月度分布的不完整月份、生成上下文的精华图片引用）。为避免改动 `src/shared/`，
 * 这些字段以「契约出参 + 模内扩展」的形式表达；契约字段集不受影响，外壳可直接透传。
 */

import type {
  Api011Response,
  CloudLayout,
  CloudLegendItem,
  CloudSizeBasis,
  CloudTerm,
  CorrectionType,
  Id,
  MediaRef,
  Meme,
  MemeCellView,
  MineView,
  Month,
  MonthRange,
  SharedFilter,
} from '@shared'

// ---------------------------------------------------------------------------
// API-009 查询梗词云
// ---------------------------------------------------------------------------

export interface CloudQueryInput {
  filter?: SharedFilter | null
  /** 字号口径（默认「累计出现次数」）。 */
  sizeBasis?: CloudSizeBasis | null
  /** 布局（必填）。 */
  layout: CloudLayout
}

/** 词云条目 = 契约条目 + 字号像素值（§5.4：字号 = 频率的单调映射，由 Metrics 计算）。 */
export interface CloudTermView extends CloudTerm {
  fontSize: number
}

export interface CloudOutput {
  terms: CloudTermView[]
  legend: CloudLegendItem[]
  /** 来源消息引用（条目可回溯到原始消息，REQ-007）。 */
  sourceMessageIds: Id[]
  /** 词云渲染截断标记（条目数 > `WORDCLOUD_MAX_TERMS` 或读取触达硬上限）。 */
  truncated: boolean
  /** 截断前总数（= 可见条目总数）。 */
  total: number
}

// ---------------------------------------------------------------------------
// API-010 查询梗单元
// ---------------------------------------------------------------------------

export interface CellQueryInput {
  memeId: Id
  filter?: SharedFilter | null
}

export interface CellOutput extends MemeCellView {
  /** 不完整月份标注（REQ-029，§5.4 判定口径）。 */
  incompleteMonths: Month[]
  /** 精华消息截断标记（超过 `ESSENCE_MAX` 时 true）。 */
  highlightsTruncated: boolean
  /** 精华消息中的图片 / 表情包媒体引用（供外壳组装生成上下文）。 */
  highlightMediaRefs: MediaRef[]
}

// ---------------------------------------------------------------------------
// API-011 查询生命周期视图
// ---------------------------------------------------------------------------

export interface LifecycleQueryInput {
  filter?: SharedFilter | null
  months: MonthRange
}

export interface LifecycleOutput extends Api011Response {
  /** 条带行截断标记（行数 > `LIFECYCLE_MAX_ROWS`）。 */
  truncated: boolean
  /** 截断前行总数。 */
  total: number
}

// ---------------------------------------------------------------------------
// API-012 提交纠正改判
// ---------------------------------------------------------------------------

export interface CorrectionInput {
  memeId: Id
  correction: CorrectionType
  /** 合并目标（仅「合并到其他梗」时必填）。 */
  mergeTargetId?: Id | null
}

export type CorrectionOutput = Meme

// ---------------------------------------------------------------------------
// API-013 查询「我相关」梗
// ---------------------------------------------------------------------------

export interface MineQueryInput {
  filter?: SharedFilter | null
  view: MineView
}

export interface MineOutput {
  /** 梗条目（口径与词云条目一致，附来源引用）。 */
  terms: CloudTermView[]
  sourceMessageIds: Id[]
  /** 结果截断标记（词条数 > `MINE_MAX_TERMS`）。 */
  truncated: boolean
  total: number
}

// ---------------------------------------------------------------------------
// 批次编排（进程内，非 HTTP 契约；mod-005 §3.3、§3.5、决策 5）
// ---------------------------------------------------------------------------

/** 编排范围（空 = 不限；见 mod-004 §4.5 的 `startBatch('ingestDone', scope)` 口径）。 */
export type ScopeFilter = SharedFilter

/** 批次触发原因。 */
export type BatchCause = 'ingestDone' | 'manualRetry'
