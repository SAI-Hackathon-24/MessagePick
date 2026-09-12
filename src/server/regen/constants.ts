/**
 * MOD-008 模块常数（mod-008 §3.1「constants.ts —— 单一取值来源」）。
 *
 * 口径来源：
 * - §5.3 / §8 决策 2：素材判定口径（原话阈值、三档位、素材类别）。
 * - §7.3：性能基线与桩口径（G1 编排 < 200 ms、模板库加载 < 100 ms）。
 * - 详设 §2.3：自动重试退避 `1 s → 2 s → 4 s`、上限 30 s、±20% 抖动、最多 3 次。
 * - 详设 §5.4：查询护栏（显式上限，不一次拉全量）。
 *
 * 其它文件不写字面量；测试可通过模块装配项局部覆盖个别取值（见 `app/deps.ts`）。
 */

import { availableParallelism } from 'node:os'

// ---------------------------------------------------------------------------
// 生成口径（REQ-036 ~ REQ-038）
// ---------------------------------------------------------------------------

/** G1 表情包：同一模板下的文案变体数（REQ-036）。 */
export const G1_VARIANT_COUNT = 4

/** G2 文字变体默认条数（REQ-037）。 */
export const G2_VARIANT_COUNT = 5

/** G3 候选条数上限（mod-008 §4.3「条数上限 1–2，本模块定义」）。 */
export const CANDIDATE_MAX_COUNT = 2

/** 成员原话判定阈值：与来源消息文本逐字一致的片段长度下限（§5.3）。 */
export const QUOTE_MIN_CHARS = 6

/** 「创作」标注文案（REQ-013；生成物与出参均为固定标注）。 */
export const CREATION_BADGE_LABEL = '创作'

// ---------------------------------------------------------------------------
// 自动重试与超时（详设 §2.3；不随配置文件变化）
// ---------------------------------------------------------------------------

/** 自动重试次数上限（详设 §2.3：最多 3 次自动重试）。 */
export const AUTO_RETRY_MAX_ATTEMPTS = 3

/** 退避基数（1 s → 2 s → 4 s）。 */
export const RETRY_BASE_DELAY_MS = 1_000

/** 退避上限（30 s）。 */
export const RETRY_MAX_DELAY_MS = 30_000

/** 退避抖动（±20%）。 */
export const RETRY_JITTER_RATIO = 0.2

/** 逐变体渲染超时默认值 = `timeouts.renderMs`（详设 §7）。 */
export const RENDER_TIMEOUT_MS = 30_000

/** 渲染 worker 池上限 `min(4, CPU-1)`（详设 §1.2、§决策 2；单核时退化为 1）。 */
export const RENDER_POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1))

// ---------------------------------------------------------------------------
// 读取护栏（详设 §5.4：显式上限，不一次拉全量）
// ---------------------------------------------------------------------------

/** 素材解析扫描（DM-003）每页条数。 */
export const MATERIAL_SCAN_PAGE_SIZE = 500

/** 素材解析扫描（DM-003）页数上限。 */
export const MATERIAL_SCAN_MAX_PAGES = 4

/** 档位②「热门表情包」的近期窗口（天；§8 决策 8「本群近期高频」）。 */
export const HOT_MEME_WINDOW_DAYS = 30

/** 档位②装入候选清单的高频表情包条数上限（使用者可换选，见 §8 决策 8）。 */
export const HOT_MEME_MAX_ITEMS = 3

/** G3 近期消息扫描每页条数。 */
export const RECENT_SCAN_PAGE_SIZE = 200

/** G3 近期消息扫描页数上限。 */
export const RECENT_SCAN_MAX_PAGES = 4

/** G3 送入任务的消息单元数上限（≤ 引擎单次调用上限 200，详设 §5.4）。 */
export const RECENT_MESSAGE_LIMIT = 200

/** 候选回看 / 确认时的按标识定位扫描页数上限。 */
export const LOOKUP_SCAN_MAX_PAGES = 10

/** 按标识定位 / 批量装配每页条数。 */
export const LOOKUP_SCAN_PAGE_SIZE = 1000

/** 生成历史读取记录上限（API-034 无分页入参 → 显式结果上限，详设 §5.4）。 */
export const HISTORY_MAX_RECORDS = 1_000

/** 生成历史读取每页条数。 */
export const HISTORY_PAGE_SIZE = 1_000

/** 生成历史读取页数上限。 */
export const HISTORY_MAX_PAGES = 5

/** 素材确认（DM-022）读取每页条数 / 页数上限。 */
export const CONSENT_SCAN_PAGE_SIZE = 1_000

/** 素材确认（DM-022）读取页数上限。 */
export const CONSENT_SCAN_MAX_PAGES = 5

/** 固定一天毫秒数（派生字段计算用）。 */
export const DAY_MS = 24 * 60 * 60 * 1_000

/** 画布尺寸上限（§4.1 性能假设：单张画布 ≤ 1080×1080）。 */
export const MAX_CANVAS_SIDE = 1_080
