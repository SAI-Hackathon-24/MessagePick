/**
 * MOD-006 取值与阈值的唯一来源（mod-006 §3.1、§3.3「constants.ts」）。
 *
 * - 识别类型基线九类与优先级 / 待办状态闭集引用 `@shared` 的既有定义，不复制第二份。
 * - 分页与上限参数（`PAGE_SIZE_DEFAULT` / `PAGE_SIZE_MAX` / `LIST_CAP`）是详设 §5.3 / §5.4
 *   护栏的实现层落点（mod-006 §8 决策 4）。
 * - 其余为管线扫描 / 模型输入 / 详情组装的实现层护栏：给显式上限，禁止无界读取（详设 §5.4）。
 * - 本文件不 import 任何 IO 依赖；模块内禁止就地写魔法数。
 */

import {
  KNOWN_RECOGNITION_TYPES,
  PRIORITIES as SHARED_PRIORITIES,
  TODO_STATUSES as SHARED_TODO_STATUSES,
  type Priority,
  type TodoStatus,
} from '@shared'

// ---------------------------------------------------------------------------
// §3.3 闭集与分页 / 上限（契约级口径）
// ---------------------------------------------------------------------------

/** 识别类型基线九类（可加项扩展；闭集外的新值透传落库、通用样式展示，§8 决策 7）。 */
export const RECOGNITION_TYPES: readonly string[] = KNOWN_RECOGNITION_TYPES

/** 优先级三档闭集（模型不可判定时取「中」）。 */
export const PRIORITIES: readonly Priority[] = SHARED_PRIORITIES

/** 待办状态闭集（未处理 / 完成 / 忽略）；`API-017` 只接受「完成 / 忽略」。 */
export const TODO_STATUSES: readonly TodoStatus[] = SHARED_TODO_STATUSES

/** UI 默认页（详设 §5.3）：时间轴 / 归档默认每页条数。 */
export const PAGE_SIZE_DEFAULT = 100
/** 通知总览组内默认页（§4 API-015）。 */
export const NOTIFY_GROUP_PAGE_SIZE = 50
/** 单页上限；页码 < 1 或每页 > 本值 → `INVALID_INPUT`（决策 4）。 */
export const PAGE_SIZE_MAX = 500
/** 单次响应条目总数显式上限（通知总览跨组合计；详设 §5.4）。 */
export const LIST_CAP = 2000

/** 到期待办单次响应上限（§4 API-018）。 */
export const DUE_TODO_CAP = 200
/** 提醒窗口：距到期 ≤ 1 天（含已过期；REQ-046）。 */
export const DUE_TODO_WINDOW_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// §5.2 增量水位（推导 + 重叠，不持久化；§8 决策 1）
// ---------------------------------------------------------------------------

/** 扫描窗口的重叠长度（水位 − 7 天，当前]）。 */
export const OVERLAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// 读路径与管线护栏（详设 §5.4：任何对外读取必须分页或给显式上限）
// ---------------------------------------------------------------------------

/** `API-004` 单页条数上限（mod-002 分页护栏，读路径按此拼接分页）。 */
export const READ_PAGE_SIZE = 1000
/** 单次读取条目的硬上限（超过即截断并标注 `truncated`）。 */
export const ENTRY_SCAN_HARD_CAP = 20_000
/** 单次消息扫描的硬上限（来源引用解析 / 详情取回共用）。 */
export const MESSAGE_SCAN_HARD_CAP = 20_000
/** 单个模型任务的输入单元上限（对齐 mod-003 `maxUnitsPerTask`；超出由管线分片）。 */
export const MAX_UNITS_PER_TASK = 2_000

// ---------------------------------------------------------------------------
// 聚类（§8 决策 2：批内聚类 + 既有主题名清单 + 粒度参数；mod-003 不可分块上限）
// ---------------------------------------------------------------------------

/** 聚类任务单次调用的单元数 / 字符数上限（对齐 mod-003 `singleCallMaxUnits` / `singleCallMaxChars`）。 */
export const CLUSTER_CALL_MAX_UNITS = 200
export const CLUSTER_CALL_MAX_CHARS = 120_000
/** 同批主题粒度（主题数 3 ~ 12、主题名 2 ~ 6 字）。 */
export const CLUSTER_MIN_TOPICS = 3
export const CLUSTER_MAX_TOPICS = 12
export const TOPIC_MIN_CHARS = 2
export const TOPIC_MAX_CHARS = 6
/** 聚类未覆盖条目的兜底主题（保证「主题非空」；正常路径不产生，出现即记 warn）。 */
export const FALLBACK_TOPIC = '其他'

// ---------------------------------------------------------------------------
// 详情组装（§3.4 / §4 API-019：超过阈值改由 worker 组装）
// ---------------------------------------------------------------------------

/** 主线程组装 / worker 组装的分界（来源消息条数）。 */
export const DETAIL_WORKER_THRESHOLD = 200
