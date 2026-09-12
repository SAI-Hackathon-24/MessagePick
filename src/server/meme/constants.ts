/**
 * MOD-005 全部阈值与取值的唯一来源（mod-005 §5.4 的一张表 + 读路径护栏取值）。
 *
 * 约定：服务端与浏览器侧都从本文件取值，禁止就地写魔法数；本文件不 import 任何 IO 依赖，
 * 浏览器侧可安全 import（vite 会把常量内联进页面包）。
 */

import { MEME_KINDS, type MemeKind } from '@shared'

// ---------------------------------------------------------------------------
// §5.4 表内常量
// ---------------------------------------------------------------------------

/** 热度三档分界（DM-006、REQ-028）：≤7 天活跃 / 8–30 天衰减中 / >30 天已沉寂。 */
export const HEAT_ACTIVE_DAYS = 7
export const HEAT_DECAY_DAYS = 30

/** 周环比窗口（REQ-028）：最近 7 天对上一 7 天。 */
export const TREND_WINDOW_DAYS = 7

/**
 * 周环比零基处理（§5.4）：上期 0 且本期 > 0 → 「新增」；两期都 0 → 0（前端显示「—」）。
 *
 * `weekOverWeek` 是数值字段且正常环比取值域为有限小数，故「新增」编码为一个不可能与正常值
 * 冲突的哨兵值；前端经 `isTrendNew` 判定并显示「新增」。
 */
export const TREND_NEW = Number.MAX_SAFE_INTEGER

/** 是否为零基「新增」（上期 0、本期 > 0）。 */
export function isTrendNew(value: number): boolean {
  return value === TREND_NEW
}

/** 峰值月并列时取最早月份（§5.4）。 */
export const PEAK_TIE_BREAK = 'earliest' as const

/** 主要使用者 = 次数前 5（并列按成员标识稳定排序，§5.4）。 */
export const TOP_USERS = 5

/** 词云渲染上限（§5.4、决策 4）：超出返回截断标记与总数；表格视图仍为全量（分页 100 / 上限 500）。 */
export const WORDCLOUD_MAX_TERMS = 200
/** 字号区间（px）与 `sqrt` 压缩（§5.4：字号 = 频率的单调映射）。 */
export const WORDCLOUD_SIZE_RANGE = { min: 14, max: 72 } as const
/** 等价表格分页默认 / 上限（详设 §5.3）。 */
export const TABLE_PAGE_SIZE = 100
export const TABLE_PAGE_MAX = 500

/** 生命周期条带行上限（§5.4）。 */
export const LIFECYCLE_MAX_ROWS = 100

/** 精华消息默认展示与展开上限（REQ-032）。 */
export const ESSENCE_DEFAULT = 3
export const ESSENCE_MAX = 20

/** 单请求读取硬上限（§5.4：超过即截断并给截断标记）。 */
export const READ_HARD_CAP = 20_000
/** 大结果集聚合的 worker 阈值（§3.6：预估记录数 > 该值派 `worker_threads`）。 */
export const AGG_WORKER_THRESHOLD = 20_000

/** 生命周期月份范围上限（schema 护栏，§5.4）。 */
export const MONTH_RANGE_MAX = 60

/** 「我相关」结果截断上限（§4 API-013：结果截断 ≤ 200 条）。 */
export const MINE_MAX_TERMS = 200

/** 类型闭集（REQ-020；越界输出按任务失败处理，§6）。 */
export const TYPE_CLOSED_SET: readonly MemeKind[] = MEME_KINDS

/** 类型 → 颜色（图例与词云共用；每类另有文字标签，REQ-020）。 */
export const KIND_COLORS: Readonly<Record<MemeKind, string>> = {
  口头禅: '#3b82f6',
  内部梗: '#f59e0b',
  表情包梗: '#10b981',
}

// ---------------------------------------------------------------------------
// 读路径护栏与引用回读（§8 决策 1、§3.6）
// ---------------------------------------------------------------------------

/** 合并链跳跃上限（§5.3：防御性截断并记 warn）。 */
export const VISIBILITY_JUMP_LIMIT = 32

/** 单时间点窄窗的半窗宽（窗宽 ≤ 2 s）与一次容错扩窗的半窗宽（§4 API-010、§8 决策 1）。 */
export const REF_READ_WINDOW_MS = 1_000
export const REF_READ_EXPAND_MS = 15_000
/** 窄窗读取的单页条数（窗内命中极少，取小页）。 */
export const REF_READ_PAGE_SIZE = 200
/** 窄窗读取的页数上限（防御性护栏）。 */
export const REF_READ_MAX_PAGES = 4

/** 主线程分批大小（§3.6：≤ 2 000 行 / 批，批间让出事件循环）。 */
export const SCAN_BATCH_ROWS = 2_000
/** 写批拆分（详设 §3.2：1 000 行 / 2 MB 先到者为限）。 */
export const WRITE_BATCH_ROWS = 1_000
export const WRITE_BATCH_BYTES = 2 * 1024 * 1024

// ---------------------------------------------------------------------------
// 后台分项自动重试（详设 §2.3：1 s → 2 s → 4 s，上限 30 s，±20% 抖动，最多 3 次）
// ---------------------------------------------------------------------------

export const AUTO_RETRY_MAX_ATTEMPTS = 3
export const AUTO_RETRY_BASE_DELAY_MS = 1_000
export const AUTO_RETRY_MAX_DELAY_MS = 30_000
export const AUTO_RETRY_JITTER_RATIO = 0.2

// ---------------------------------------------------------------------------
// 批次分批窗口（§3.5：批次按「任务类型 × 分批窗口」切成分项）
// ---------------------------------------------------------------------------

/** 识别分项每条消息窗口的消息数上限。 */
export const RECOGNIZE_WINDOW_MESSAGES = 400
/** 精华分项每梗候选消息数上限。 */
export const ESSENCE_CANDIDATE_MESSAGES = 60
/** 精华分项单批上限（防止一次触发发起过多模型调用；未覆盖的梗在下一次触发继续）。 */
export const ESSENCE_ITEMS_PER_BATCH_MAX = 24
