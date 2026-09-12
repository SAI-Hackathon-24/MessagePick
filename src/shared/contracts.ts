/**
 * 接口契约：`docs/design/api-contract.md` 的 API-001 ~ API-034 入参 / 出参类型。
 *
 * 阅读约定：
 * - 每个接口一组，命名 `ApiNNNRequest` / `ApiNNNResponse` / `ApiNNNErrorCode`；组注释写明所属模块与用途。
 * - `Response` = 出参（成功）的载荷；外壳（MOD-004）统一响应为 `{ data, epoch, requestId }`
 *   （mod-004 §4.1），本文件的类型对应其中的 `data`，另见 `ShellResponseMeta`。
 * - 失败一律用统一错误信封 `ErrorEnvelope`（errors.ts）表达；各接口的 `ApiNNNErrorCode` 给出该接口
 *   可能出现的错误标识联合（来源 = api-contract.md 各接口「错误」表；模块设计补充的闭集标识已就地注明）。
 * - `过滤`类入参一律使用 `SharedFilter`（filter.ts，空 = 不限）。
 * - 字段名用英文驼峰；注释给出文档中的中文字段名，字段集严格对应各接口的入参 / 出参表。
 */

import type { ErrorEnvelope } from './errors'
import type {
  ArtifactRef,
  Dimension,
  DimensionDiffs,
  DimensionScores,
  DurationMs,
  EntityRecord,
  EntityType,
  ExtractedItem,
  GenerationKind,
  GenerationRecord,
  Id,
  IdentityCandidateStatus,
  IngestSource,
  IngestSourceStatus,
  MaterialTier,
  MediaRef,
  Meme,
  MemeCandidate,
  MemeCandidateStatus,
  MemeHeat,
  MemeKind,
  MemeLifecycle,
  MemeKingEntry,
  MessageKind,
  Month,
  MonthlyCounts,
  PersonalityDimension,
  Priority,
  RawMessage,
  RecognitionType,
  Timestamp,
  TodoStatus,
} from './entities'
import type { SharedFilter, TimeRange } from './filter'

/** 外壳统一响应里附带的元信息（mod-004 §4.1 / 详设 §3.3）：`epoch` 用于丢弃过期响应，`requestId` 用于日志检索。 */
export interface ShellResponseMeta {
  /** dataEpoch（详设 §3.3；随采集完成 / 删除完成 / 改判落库 / 迁移完成递增） */
  epoch: number
  /** 请求标识（外壳在入口生成，透传到任务、worker 与日志） */
  requestId: string
}

// ===========================================================================
// MOD-001 数据接入与更新 —— API-001、API-002
// ===========================================================================

/** API-001 触发更新（MOD-001）：按来源采集 / 导入数据并返回分来源结果。 */
export interface Api001Request {
  /** 目标来源：省略 / 空 = 全部来源；指定 = 只采集 / 重试该来源（阶段 3 提问 2/9 裁定） */
  targetSource?: IngestSource | null
}

/** 单条失败明细（分项展示与分项重试按 scope 聚合；不阻塞其他分项）。 */
export interface IngestFailureDetail {
  /** 失败边界（群 / 分页 / 来源……） */
  scope: string
  code: ErrorEnvelope['code']
  reason: string
}

/** 来源结果：按来源各一条（成功条数 + 失败明细 + 完成时间 + 来源状态）。 */
export interface IngestSourceResult {
  source: IngestSource
  /** 来源状态：成功 / 失败 / 无授权 / 超时（部分失败不阻塞其余来源） */
  status: IngestSourceStatus
  /** 成功写入条数 */
  written: number
  /** 失败明细（单群 / 单分页级） */
  failures: IngestFailureDetail[]
  /** 完成时间：本次该来源完成的时刻；仅成功来源给出（群消息来源成功时同时刷新「记录更新至 X」） */
  completedAt: Timestamp | null
}

export interface Api001Response {
  /** 来源结果（出参表的「来源结果 + 来源状态 + 完成时间」按来源合并表达） */
  sources: IngestSourceResult[]
}
export type Api001ErrorCode = 'NO_AUTH' | 'TIMEOUT' | 'PARTIAL_FAILURE'

/** API-002 查询更新状态（MOD-001）：首屏引导 / 「记录更新至 X」/ 来源状态 / 当前用户。 */
export interface SourceStatusEntry {
  source: IngestSource
  /** 最近一次状态 */
  status: IngestSourceStatus
  /** 最近一次状态的时间 */
  at: Timestamp | null
}

export interface Api002Response {
  /** 是否有数据（以群消息来源是否已有记录为准；为「否」时触发首屏引导） */
  hasData: boolean
  /** 记录更新至 X（群消息来源最近一次成功完成时间；从未成功时为空） */
  updatedUntilX: Timestamp | null
  /** 来源状态（通讯录 / 好友列表分项记录、分项展示） */
  sourceStatuses: SourceStatusEntry[]
  /** 当前用户：「我」的成员标识（Me），采集时解析、由 MOD-002 持有；尚未解析出时为 null（模块一 / 三遇 null 按 IDENTITY_NOT_READY 处理） */
  meMemberId: Id | null
}
export type Api002ErrorCode = 'STORAGE_UNAVAILABLE'

/** 别名（模块设计用名）：API-002 出参。 */
export type UpdateStatus = Api002Response

// ===========================================================================
// MOD-002 数据存储与隐私 —— API-003 ~ API-006
// ===========================================================================

/** 单条写入失败明细（记录身份 + 原因；单条失败不影响同批其余记录）。 */
export interface WriteFailureDetail {
  /** 记录身份键（复合键时逐段给出，如 [群标识, 成员标识]） */
  identity: string[]
  reason: string
}

/** 写入结果（API-003 出参）。 */
export interface WriteResult {
  /** 成功条数 */
  written: number
  /** 失败明细 */
  failures: WriteFailureDetail[]
}

/** API-003 写入记录（MOD-002）：持久化原始记录与派生结果（按记录身份去重）。 */
export interface Api003Request<T extends EntityType = EntityType> {
  /** 实体类型（取值集合 = ENTITY_TYPES，见 entities.ts 的 EntityTypeMap） */
  entityType: T
  /** 记录内容（与实体类型对应；结论必须带来源消息引用） */
  records: EntityRecord<T>[]
}
export type Api003Response = WriteResult
export type Api003ErrorCode = 'STORAGE_UNAVAILABLE'

/** 分页入参（页码默认 1、每页条数默认 50；每页条数上限 1000，越界由实现返回 INVALID_INPUT）。 */
export interface PageRequest {
  page?: number | null
  pageSize?: number | null
}
/** 别名（mod-006 用名）。 */
export type PageInput = PageRequest

/** 分页信息（当前页码、每页条数、命中总条数）。 */
export interface PageInfo {
  page: number
  pageSize: number
  total: number
}

/** 读取结果（API-004 出参）：命中记录 + 分页信息。 */
export interface ReadResult<T extends EntityType = EntityType> {
  records: EntityRecord<T>[]
  pageInfo: PageInfo
}

/** API-004 按条件读取（MOD-002）。 */
export interface Api004Request<T extends EntityType = EntityType> {
  /** 实体类型；实体类型 = 群（'DM-002'）时用于读取群清单（群标识 + 群名），供全局筛选的群多选与按群删除的群选择项（CHG-026） */
  entityType: T
  /** 筛选条件（群 / 时间范围 / 关键词 / 身份；空 = 不限） */
  filter?: SharedFilter | null
  /** 页码 / 每页条数（见 PageRequest） */
  page?: PageRequest | null
}
export type Api004Response<T extends EntityType = EntityType> = ReadResult<T>
export type Api004ErrorCode = 'STORAGE_UNAVAILABLE' | 'INVALID_INPUT'

/** 群引用（实体类型 = 群时的记录项 = 群标识 + 群名；= DM-002 记录）。 */
export type GroupRef = EntityRecord<'DM-002'>

/** 删除范围（按群 / 全量两种）。 */
export type DeletionScope = { kind: 'group'; groupId: Id } | { kind: 'all' }

/** 按实体类型列出的计数（删除预检 / 删除结果共用）。 */
export interface EntityCount {
  entityType: EntityType
  count: number
}

/** 删除预检结果（受影响实体清单与计数：原始 + 派生，含生成历史）。 */
export interface PreflightResult {
  items: EntityCount[]
}

/** 删除结果（各实体实际删除计数）。 */
export interface DeletionResult {
  items: EntityCount[]
}

/** API-005 删除预检（MOD-002）。 */
export interface Api005Request {
  scope: DeletionScope
}
export type Api005Response = PreflightResult
export type Api005ErrorCode = 'STORAGE_UNAVAILABLE'

/** API-006 执行删除（MOD-002）：凭二次确认执行按群 / 全量删除。 */
export interface Api006Request {
  scope: DeletionScope
  /** 二次确认标记；缺失时拒绝执行（CONFIRMATION_REQUIRED） */
  confirmed: boolean
}
export type Api006Response = DeletionResult
export type Api006ErrorCode = 'CONFIRMATION_REQUIRED' | 'DELETION_INTERRUPTED' | 'STORAGE_UNAVAILABLE'

// ===========================================================================
// MOD-003 智能分析引擎 —— API-007、API-008
// ===========================================================================

/** 任务类型：五类（识别 / 抽取 / 聚类 / 生成 / 推断）。 */
export const TASK_TYPES = ['识别', '抽取', '聚类', '生成', '推断'] as const
export type TaskType = (typeof TASK_TYPES)[number]

/** 任务输入单元：`id` 即来源引用回传的标识（引擎不解释其语义，原样带回）。 */
export interface TaskUnit {
  id: Id
  text: string
}

/** 输入内容：消息集合 / 文本 / 上下文（对应三张形状）。 */
export type TaskInput =
  | { kind: '消息集合'; units: TaskUnit[] }
  | { kind: '文本'; unit: TaskUnit }
  | { kind: '上下文'; units: TaskUnit[] }

/** 输出条目的字段片段（浅校验用：type / required / properties / enum 子集；多余字段忽略）。 */
export interface TaskOutputSchema {
  type: string
  required?: string[]
  properties?: Record<string, { type: string; enum?: string[] }>
}

/** 任务参数：本次任务的语义与判定口径，由调用方给出（阶段 3 提问 6/9 裁定）。 */
export interface TaskParams {
  /** 任务语义与判定口径（含词表 / 阈值等业务规则） */
  instruction: string
  /** 结果条目的字段约束（引擎据此浅校验） */
  outputSchema: TaskOutputSchema
  /** 调优旋钮（期望数量、语言等）；不改变判定口径 */
  options?: Record<string, unknown>
}

/** 任务结果条目（形态由调用方 outputSchema 约束）。 */
export type TaskResultItem = Record<string, unknown>

/** 任务结果（结构化结果；形态随任务类型与调用方给出的口径而定）。 */
export interface TaskResult {
  items: TaskResultItem[]
}

/** 来源引用：每条结果可回溯到具体输入消息的标识（引擎原样回传的 TaskUnit.id）。 */
export type SourceRef = string

/** 任务引用：供 API-008 重试使用（阶段 3 提问 7/9 裁定；失败 / 超时的结果同样携带）。 */
export type TaskRef = string

/** API-007 执行任务（MOD-003）。 */
export interface Api007Request {
  taskType: TaskType
  input: TaskInput
  params: TaskParams
}
export interface Api007Response {
  result: TaskResult
  sourceRefs: SourceRef[]
  taskRef: TaskRef
}
export type Api007ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'INVALID_INPUT'

/** API-008 重试任务（MOD-003）：按任务引用重试失败 / 超时的任务。 */
export interface Api008Request {
  taskRef: TaskRef
}
export type Api008Response = Api007Response
export type Api008ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'INVALID_INPUT'

/**
 * 引擎返回形态（mod-003 §3.3 的实现约定，供四个调用方模块统一处理成功 / 失败）：
 * 失败 / 超时的「任务引用」在 `error.scope` 内，调用方凭它调用 `API-008` 重试。
 */
export type TaskOutcome =
  | { ok: true; result: TaskResult; sourceRefs: SourceRef[]; taskRef: TaskRef }
  | { ok: false; error: ErrorEnvelope }

// ===========================================================================
// MOD-005 梗分析（模块一）—— API-009 ~ API-013
// ===========================================================================

/** 字号口径：累计出现次数 / 指定时间窗内出现频次（时间窗取全局筛选的时间范围）。 */
export const CLOUD_SIZE_BASES = ['累计出现次数', '指定时间窗内出现频次'] as const
export type CloudSizeBasis = (typeof CLOUD_SIZE_BASES)[number]

/** 词云布局：按热度 / 按首次出现时间（后者词序按首现时间排列并标注首现日期）。 */
export const CLOUD_LAYOUTS = ['按热度', '按首次出现时间'] as const
export type CloudLayout = (typeof CLOUD_LAYOUTS)[number]

/** 词云条目（悬停展示四项：频率值、出现次数、首现时间、最近调用时间）。 */
export interface CloudTerm {
  memeId: Id
  name: string
  /** 频率值（按入参「字号口径」口径） */
  frequency: number
  occurrenceCount: number
  kind: MemeKind
  firstSeenAt: Timestamp
  lastUsedAt: Timestamp
}

/** 图例项：类型 → 颜色 + 文字标签（类型 ≤ 3 类）。 */
export interface CloudLegendItem {
  kind: MemeKind
  color: string
  label: string
}

/** API-009 查询梗词云（MOD-005）。 */
export interface Api009Request {
  filter?: SharedFilter | null
  /** 字号口径（默认「累计出现次数」） */
  sizeBasis?: CloudSizeBasis | null
  /** 布局（必填） */
  layout: CloudLayout
}
export interface Api009Response {
  terms: CloudTerm[]
  legend: CloudLegendItem[]
  /** 来源消息引用（条目可回溯到原始消息） */
  sourceMessageIds: Id[]
}
export type Api009ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'NO_DATA' | 'EMPTY_RESULT'

/** 精华消息条目（默认 3 条、可展开更多；每条可查看上下文）。 */
export interface MemeHighlightView {
  messageId: Id
  kind: MessageKind
  displayOrder: number
}

/** 梗单元内容（API-010 出参）。梗名 / 类型不在该出参字段表中，视图如需展示从词云条目带入（口径由 MOD-005 定）。 */
export interface MemeCellView {
  /** 入参梗标识回带，便于调用方关联 */
  memeId: Id
  /** 解读：什么意思 / 从哪来 / 现在怎么用 */
  interpretation: string
  /** 首现时间与来源群 */
  firstSeenAt: Timestamp
  firstSeenGroupId: Id
  /** 最近调用时间与距今 */
  lastUsedAt: Timestamp
  elapsed: DurationMs
  /** 累计出现次数（按消息计数） */
  occurrenceCount: number
  heat: MemeHeat
  /** 周环比趋势（与上周比较） */
  weekOverWeek: number
  /** 月度分布（柱状图可切表格、悬停显数值、标注不完整月份） */
  monthlyCounts: MonthlyCounts
  lifecycle: MemeLifecycle
  /** 梗王（成员 + 次数 + 占比 + 主要使用者；并列时全部列出） */
  memeKing: MemeKingEntry[]
  /** 精华消息（默认 3 条、可展开更多） */
  highlights: MemeHighlightView[]
  /** 相关变体（可点击切换） */
  variantMemeIds: Id[]
  /** 来源消息引用（每条结论可回溯到原始消息） */
  sourceMessageIds: Id[]
}

/** API-010 查询梗单元（MOD-005）。 */
export interface Api010Request {
  memeId: Id
  filter?: SharedFilter | null
}
export type Api010Response = MemeCellView
export type Api010ErrorCode = 'NOT_FOUND' | 'ANALYSIS_FAILED' | 'TIMEOUT'

/** 月份范围（起止月份）。 */
export interface MonthRange {
  from: Month
  to: Month
}

/** 生命周期条带行：每梗一行（首现 / 峰值 / 沉寂点 / 活跃天数 / 按月强度）。 */
export interface LifecycleRow {
  memeId: Id
  /** 梗名回显（源 DM-006.梗名，便于渲染） */
  name: string
  firstSeenAt: Timestamp
  /** 峰值 = 出现次数最多的月份 */
  peakMonth: Month
  /** 沉寂点 = 最近一次出现的时间点 */
  silentAt: Timestamp
  /** 活跃天数 = 首现到最近调用时间的自然日跨度 */
  activeDays: number
  /** 按月强度（当月次数 ÷ 峰值月次数，0–1）：驱动色阶 */
  monthlyStrength: MonthlyCounts
  /** 按月真实出现次数（与 `monthlyStrength` 同窗口；条带标签 / 悬停展示） */
  monthlyCounts: MonthlyCounts
}

/** 当月领跑梗标注。 */
export interface LeadingMeme {
  month: Month
  memeIds: Id[]
}

/** API-011 查询生命周期视图（MOD-005）。 */
export interface Api011Request {
  filter?: SharedFilter | null
  months: MonthRange
}
export interface Api011Response {
  rows: LifecycleRow[]
  leadingMemes: LeadingMeme[]
}
export type Api011ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'NO_DATA'

/** 改判类型：四类（不是梗 / 不感兴趣 / 合并到其他梗 / 梗王标注有误）。 */
export const CORRECTION_TYPES = ['不是梗', '不感兴趣', '合并到其他梗', '梗王标注有误'] as const
export type CorrectionType = (typeof CORRECTION_TYPES)[number]

/** API-012 提交纠正改判（MOD-005）。 */
export interface Api012Request {
  memeId: Id
  correction: CorrectionType
  /** 合并目标（仅「合并到其他梗」时必填） */
  mergeTargetId?: Id | null
}
/** 出参：改判后的最新梗数据（改判立即影响后续结果）。 */
export type Api012Response = Meme
export type Api012ErrorCode = 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'

/** 「我相关」视角：我用过的 / 我参与消息里的。 */
export const MINE_VIEWS = ['我用过的', '我参与消息里的'] as const
export type MineView = (typeof MINE_VIEWS)[number]

/** API-013 查询「我相关」梗（MOD-005）。 */
export interface Api013Request {
  filter?: SharedFilter | null
  view: MineView
}
export interface Api013Response {
  /** 梗条目（口径与词云条目一致，附来源引用） */
  terms: CloudTerm[]
  sourceMessageIds: Id[]
}
export type Api013ErrorCode = 'IDENTITY_NOT_READY' | 'EMPTY_RESULT'

// ===========================================================================
// MOD-006 信息提取（模块二）—— API-014 ~ API-019
// ===========================================================================

/** 提取条目列表项（供时间轴 / 归档使用；关键词匹配对象 = 消息文本与 AI 总结）。 */
export interface ExtractEntryView {
  entryId: Id
  recognitionType: RecognitionType
  /** 要素：时间 / 地点 / 人物 / 事项 / DDL（未提取到为空 / 空数组） */
  timeElement: Timestamp | null
  locationElement: string | null
  personElementMemberIds: Id[]
  subjectElement: string | null
  deadline: Timestamp | null
  /** 来源群（时间轴与群多选按此） */
  groupId: Id
  /** 时间（时间轴排序用；口径由 MOD-006 定） */
  time: Timestamp | null
  topic: string
  sourceMessageIds: Id[]
}

/** API-014 查询提取条目（MOD-006）。 */
export interface Api014Request {
  filter?: SharedFilter | null
}
export interface Api014Response {
  items: ExtractEntryView[]
}
export type Api014ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'NO_DATA' | 'EMPTY_RESULT'

/** 通知浏览维度：来源 / 类型 / 优先级 / 待办。 */
export const NOTIFICATION_DIMENSIONS = ['来源', '类型', '优先级', '待办'] as const
export type NotificationDimension = (typeof NOTIFICATION_DIMENSIONS)[number]

/** 通知条目。 */
export interface NotificationEntry {
  entryId: Id
  /** 来源（来源群） */
  groupId: Id
  recognitionType: RecognitionType
  priority: Priority
  todoStatus: TodoStatus
  sourceMessageIds: Id[]
}

/** 分组的通知列表：一组（key / 展示标签 + 条目）。 */
export interface NotificationGroup {
  key: string
  label: string
  notifications: NotificationEntry[]
}

/** API-015 查询通知总览（MOD-006）。 */
export interface Api015Request {
  filter?: SharedFilter | null
  dimension: NotificationDimension
}
export interface Api015Response {
  groups: NotificationGroup[]
}
export type Api015ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'NO_DATA' | 'EMPTY_RESULT'

/** API-016 修改主题 / 优先级（MOD-006）：主题与优先级至少给出一项。 */
export interface Api016Request {
  entryId: Id
  topic?: string | null
  priority?: Priority | null
}
export interface Api016Response {
  /** 更新后的条目（DM-010） */
  item: ExtractedItem
}
export type Api016ErrorCode = 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'

/** 待办标记：完成 / 忽略（未处理为初始状态）。 */
export const TODO_MARKS = ['完成', '忽略'] as const
export type TodoMark = (typeof TODO_MARKS)[number]

/** API-017 标记待办状态（MOD-006）。 */
export interface Api017Request {
  entryId: Id
  todoStatus: TodoMark
}
export interface Api017Response {
  /** 标记立即生效后的状态 */
  todoStatus: TodoStatus
}
export type Api017ErrorCode = 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'

/** 到期待办项。 */
export interface DueTodo {
  entryId: Id
  topic: string
  groupId: Id
  /** 到期时间（DDL） */
  deadline: Timestamp
  sourceMessageIds: Id[]
}

/** API-018 查询到期待办（MOD-006）：距到期 ≤1 天且未完成的待办。 */
export interface Api018Request {
  /** 当前时间（由调用方给出，用于计算距到期天数） */
  now: Timestamp
}
export interface Api018Response {
  todos: DueTodo[]
}
export type Api018ErrorCode = 'STORAGE_UNAVAILABLE'

/** 消息详情 heading：一句话总结 + 来源群 + 时间。 */
export interface MessageDetailHeading {
  headline: string
  groupId: Id
  time: Timestamp | null
}

/** 消息详情正文：AI 总结 + 所有来源群消息。 */
export interface MessageDetailBody {
  aiSummary: string
  sourceMessages: RawMessage[]
}

/** 消息详情（API-019 出参）。兴趣提示不在此返回，由外壳经 API-029 另行组装。 */
export interface MessageDetail {
  heading: MessageDetailHeading
  body: MessageDetailBody
}

/** API-019 查询消息详情（MOD-006）。 */
export interface Api019Request {
  entryId: Id
}
export type Api019Response = MessageDetail
export type Api019ErrorCode = 'NOT_FOUND' | 'ANALYSIS_FAILED' | 'TIMEOUT'

// ===========================================================================
// MOD-007 社交画像（模块三）—— API-020 ~ API-029
// ===========================================================================

/** 二级标签（含置信度与证据引用；无证据的标签不进入画像）。 */
export interface ProfileTagView {
  tagId: Id
  name: string
  dimension: Dimension
  confidence: number
  evidenceMessageIds: Id[]
}

/** 个人标签词云条目（与「梗词云」区分的独立视图数据）。 */
export interface TagCloudEntry {
  tagId: Id
  name: string
  weight: number
}

/** 性格标签（仅已确认的标签；仅使用者本人可见）。 */
export interface PersonalityTagView {
  tagId: Id
  dimension: PersonalityDimension
  score: number
}

/** 人物画像（API-020 出参）。 */
export interface ProfileView {
  /** 二级标签 */
  secondaryTags: ProfileTagView[]
  /** 一级维度分（每个维度分 = 该维度下全部二级标签置信度之和） */
  dimensionScores: DimensionScores
  /** 爱好雷达（五轴：运动 / 艺术 / 游戏 / 娱乐 / 社交） */
  radar: DimensionScores
  /** 个人标签词云数据 */
  tagCloud: TagCloudEntry[]
  /** 性格标签（仅已确认） */
  personalityTags: PersonalityTagView[]
}

/** API-020 查询人物画像（MOD-007）。 */
export interface Api020Request {
  memberId: Id
  filter?: SharedFilter | null
}
export type Api020Response = ProfileView
export type Api020ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'NO_DATA' | 'EMPTY_RESULT'

/** 检索入口：按一级维度 / 按二级标签。 */
export const PEOPLE_SEARCH_ENTRIES = ['按一级维度', '按二级标签'] as const
export type PeopleSearchEntry = (typeof PEOPLE_SEARCH_ENTRIES)[number]

/** 人选条目（含回复时长与活跃度；发言不足者标「未知」但仍列出）。 */
export interface PeopleEntry {
  personId: Id
  /** 展示名（源 = 群成员昵称 / 群名片，mod-007 §3.3；便于渲染） */
  displayName: string
  /** 回复时长（中位数；无可统计样本时为空） */
  replyMedianMs: DurationMs | null
  activity: number
  /** 未知标记（发言不足） */
  unknown: boolean
}

/** API-021 查询兴趣 → 人（MOD-007）：匹配范围跨全部已采集的历史群。 */
export interface Api021Request {
  entry: PeopleSearchEntry
  /** 检索值（与检索入口对应：一级维度取值 / 二级标签名或标识） */
  value: string
  filter?: SharedFilter | null
}
export interface Api021Response {
  people: PeopleEntry[]
}
export type Api021ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'NO_DATA' | 'EMPTY_RESULT'

/** 两人配对（API-022 出参）：共同爱好 + 契合度 + 逐维度差值。 */
export interface PairView {
  personAId: Id
  personBId: Id
  commonTagIds: Id[]
  /** 契合度（共同标签数 + 强度 / 置信度加权 + 实际互动 + 活跃度（只计一次）） */
  fitScore: number
  dimensionDiffs: DimensionDiffs
}

/** API-022 查询两人配对（MOD-007）。 */
export interface Api022Request {
  memberAId: Id
  memberBId: Id
}
export type Api022Response = PairView
export type Api022ErrorCode = 'NOT_FOUND' | 'ANALYSIS_FAILED' | 'TIMEOUT'

/** 逐人契合度条目（我 vs 每个群友）。 */
export interface MyAffinityPair {
  personId: Id
  /** 契合度（复用 DM-018 的配对结果） */
  score: number
}

/** 「我的社交契合度」（API-023 出参）。 */
export interface MyAffinityView {
  pairs: MyAffinityPair[]
  /** 整体融入度（单一分数；无可统计对象时为空） */
  overallFit: number | null
}

/** API-023 查询「我的社交契合度」（MOD-007）；「我」取 MOD-002 持有的 Me 标识，无入参。 */
export type Api023Response = MyAffinityView
export type Api023ErrorCode = 'IDENTITY_NOT_READY' | 'ANALYSIS_FAILED' | 'TIMEOUT'

/** API-024 生成组局建议（MOD-007）：按选定兴趣与候选人生成纯文字建议。 */
export interface Api024Request {
  /** 选定兴趣（在兴趣 → 人结果中选定；标识或文本） */
  interest: string
  candidateMemberIds: Id[]
}
export interface Api024Response {
  /** 文字建议（仅文字；不含待办、不含可直接发送的文案） */
  text: string
}
export type Api024ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'EMPTY_RESULT'

/** 身份对齐候选（每条含待对齐成员、候选映射关系、来源、状态）。 */
export interface IdentityCandidateView {
  candidateId: Id
  /** 涉及群成员（→ DM-004） */
  memberIds: Id[]
  /** 候选来源（通讯录 / 好友列表） */
  source: EntityRecord<'DM-005'>['source']
  /** 候选来源记录（→ DM-005） */
  sourceContactId: Id
  /** 状态（未确认不生效） */
  status: IdentityCandidateStatus
}

/** API-025 查询身份对齐候选（MOD-007）；入参无。 */
export interface Api025Response {
  candidates: IdentityCandidateView[]
}
export type Api025ErrorCode = 'SOURCE_UNAVAILABLE'

/** 身份对齐结论：确认 / 否定。 */
export const IDENTITY_DECISIONS = ['确认', '否定'] as const
export type IdentityDecision = (typeof IDENTITY_DECISIONS)[number]

/** API-026 提交身份对齐结论（MOD-007）。 */
export interface Api026Request {
  candidateId: Id
  conclusion: IdentityDecision
}
export interface Api026Response {
  /** 映射状态（未确认 / 已确认 / 已否定；未确认与否定均不生效，相关人按独立个体处理） */
  status: IdentityCandidateStatus
}
export type Api026ErrorCode = 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'

/** 性格标签操作：确认 / 增 / 删 / 改。 */
export const PERSONALITY_TAG_ACTIONS = ['确认', '增', '删', '改'] as const
export type PersonalityTagAction = (typeof PERSONALITY_TAG_ACTIONS)[number]

/** API-027 确认与增删改性格标签（MOD-007）。 */
export interface Api027Request {
  memberId: Id
  action: PersonalityTagAction
  /** 六维标签（除「删」以外必填；值必须在六维闭集内） */
  dimension?: PersonalityDimension | null
}
export interface Api027Response {
  /** 标签状态（确认后才进入产物与视图） */
  tags: PersonalityTagView[]
}
export type Api027ErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'

/** 兴趣标签操作：增 / 删 / 改。 */
export const INTEREST_TAG_ACTIONS = ['增', '删', '改'] as const
export type InterestTagAction = (typeof INTEREST_TAG_ACTIONS)[number]

/** 兴趣标签入参：一级维度（固定五类，不增不减）+ 二级标签名。 */
export interface InterestTagInput {
  name: string
  dimension: Dimension
}

/** API-028 增删改兴趣标签（MOD-007）。 */
export interface Api028Request {
  memberId: Id
  action: InterestTagAction
  /** 标签（增与改时必填） */
  tag?: InterestTagInput | null
}
export interface Api028Response {
  /** 更新后的画像（结构同 API-020）；人工增删改一经提交立即影响后续结果（匹配结果随最新数据重算） */
  profile: ProfileView
}
export type Api028ErrorCode = 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'

/** 成员兴趣提示（仅含已确认数据）。 */
export interface MemberHint {
  memberId: Id
  tags: ProfileTagView[]
}

/** API-029 查询成员兴趣提示（MOD-007）；供外壳组装消息详情的内联提示。 */
export interface Api029Request {
  /** 成员标识集合（消息涉及的成员） */
  memberIds: Id[]
}
export interface Api029Response {
  hints: MemberHint[]
}
export type Api029ErrorCode = 'NO_DATA'

// ===========================================================================
// MOD-008 再创作生成 —— API-030 ~ API-034
// ===========================================================================

/** 梗上下文（外壳从 API-010 结果组装后转交；会话内瞬态，不落库）。 */
export interface MemeGenerationContext {
  memeId: Id
  interpretation: string
  /** 相关变体 */
  variantMemeIds: Id[]
  /** 精华图片引用 */
  highlightMediaRefs: MediaRef[]
}

/** API-030 生成表情包（MOD-008）：同一模板下 4 个文案变体。 */
export interface Api030Request {
  memeContext: MemeGenerationContext
  /** 素材档位（三档单选其一，不可多选） */
  tier: MaterialTier
  /** 模板标识（模板清单由实现层内置，本契约只传递标识） */
  templateId: Id
  /** 文案（使用者编辑的内容；据此生成 4 个文案变体） */
  text: string
}
export interface Api030Response {
  /** 图片引用（4 张：同一模板下的 4 个文案变体图；可复制 / 下载） */
  artifacts: ArtifactRef[]
  /** 「创作」标注（全部生成物必须带标注，恒为 true） */
  creationMark: true
}
export type Api030ErrorCode = 'MATERIAL_NOT_CONFIRMED' | 'SOURCE_UNAVAILABLE' | 'ANALYSIS_FAILED' | 'TIMEOUT'

/** API-031 生成文字变体（MOD-008）：默认 5 条。 */
export interface Api031Request {
  memeContext: MemeGenerationContext
}
export interface Api031Response {
  /** 文字变体（默认 5 条；可一键复制） */
  texts: string[]
  creationMark: true
}
export type Api031ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT'

/** 近期消息范围（时间范围 / 消息集合）。 */
export interface RecentMessageRange {
  timeRange?: TimeRange | null
  messageIds?: Id[] | null
}

/** API-032 生成新梗候选（MOD-008）：确认前不入库、不出现在词云等视图。 */
export interface Api032Request {
  recentRange: RecentMessageRange
  /** 分析结果引用（调用方已有的分析结果；选填） */
  analysisRefs?: SourceRef[] | null
}
export interface Api032Response {
  /** 候选梗单元（含义推测、出处消息引用、使用示例） */
  candidates: MemeCandidate[]
  /** 候选状态（确认前 = 「候选」；单项状态以 candidates[].status 为准） */
  status: MemeCandidateStatus
}
export type Api032ErrorCode = 'ANALYSIS_FAILED' | 'TIMEOUT' | 'EMPTY_RESULT'

/** API-033 确认候选入库（MOD-008）。 */
export interface Api033Request {
  candidateId: Id
  /** 使用者确认（true = 入库；未确认不生效） */
  confirmed: boolean
}
export interface Api033Response {
  /** 入库后的梗标识（进入词云等视图） */
  memeId: Id
}
export type Api033ErrorCode = 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'

/** 生成历史条目（类型 G1 / G2 / G3、时间、梗标识、素材档位、产出引用；可回看与再次下载）。 */
export type GenerationHistoryEntry = GenerationRecord

/** API-034 查询生成历史（MOD-008）。 */
export interface Api034Request {
  filter?: SharedFilter | null
}
export interface Api034Response {
  records: GenerationHistoryEntry[]
}
export type Api034ErrorCode = 'EMPTY_RESULT'
