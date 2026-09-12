/**
 * 共享入参：全局筛选条件。
 *
 * 来源：`docs/design/api-contract.md` §1.3（全应用唯一筛选控件，由 MOD-004 统一产生并作为入参传给各模块）。
 *
 * 语义约定：
 * - 四项均为**选填**；省略、`null`、空数组 / 空串均视为「不限」（空 = 不限，AC-014）。
 * - 关键词的匹配对象随模块：模块一 = 梗名与解读；模块二 = 消息文本与 AI 总结；模块三 = 标签名与成员昵称（REQ-005）。
 * - 身份 = 「我」的成员标识（取自 API-002 的当前用户，无需手工设置，REQ-006）；只对模块一 / 三生效，模块二不使用。
 * - 各模块不得自建第二组同类筛选控件（REQ-049）。
 */

import type { Id, Timestamp } from './entities'

/** 时间范围（起止时间点；时间口径 = UTC epoch 毫秒，与 DM 存储口径一致）。 */
export interface TimeRange {
  from: Timestamp
  to: Timestamp
}

/** 全局筛选条件结构（api-contract.md §1.3）。 */
export interface SharedFilter {
  /** 群标识列表（多选）；空 = 不限 */
  groupIds?: readonly Id[] | null
  /** 时间范围；空 = 不限 */
  timeRange?: TimeRange | null
  /** 关键词；空 = 不限（匹配对象随模块，见文件头注释） */
  keyword?: string | null
  /** 身份：「我」的成员标识；空 = 不限（模块二不使用该项） */
  identity?: Id | null
}

/** 别名：模块设计文档中出现的 `GlobalFilter` / `FilterCondition` 与 `SharedFilter` 为同一份定义。 */
export type GlobalFilter = SharedFilter
/** 别名（mod-002 用名）。 */
export type FilterCondition = SharedFilter

/**
 * G3「近期消息范围」的默认窗口（近 30 天）。
 *
 * 来源：mod-004 §4.7 / 决策 8 —— 全局筛选的时间范围为空时取此常量，不新增第二组时间控件（REQ-049、AC-012）。
 * 单位：天。
 */
export const DEFAULT_RECENT_WINDOW_DAYS = 30
