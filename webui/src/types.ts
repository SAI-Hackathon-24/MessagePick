/**
 * 聊斋 MessagePick —— 前端类型定义（严格对齐契约层）
 * =============================================================================
 * 唯一依据（本文件不得自行发明字段，改字段必须先改上游契约）：
 *   · 接口契约：docs/design/api-contract.md（API-001 ~ API-034）
 *   · 数据模型：docs/design/data-model.md（DM-001 ~ DM-022）
 *   · 产品需求：docs/product/prd.md（US-001 ~ US-015、REQ-001 ~ REQ-088）
 *   · 原始设计：docs/raw/raw_design.md（§2 全局约定、§3~§5 三模块）
 *
 * 命名口径（REQ-017：不引入英文术语，且两个「词云」不混用）：
 *   · 梗单元 —— 梗的唯一展示与操作单元（原「梗卡片」不再使用）
 *   · 梗词云（模块一） vs 个人标签词云（模块三）
 *   · 梗生命周期（模块一） vs 消息时间轴（模块二）
 *
 * 类型名保留英文以便代码可读，界面文案一律用中文（见各 *_LABEL 常量）。
 */

/* ========================================================================== *
 * 0. 错误标识（api-contract.md §1.2 —— 稳定英文常量，一经分配不复用）
 * ========================================================================== */

export const ERROR_CODES = [
  'NO_AUTH',
  'TIMEOUT',
  'PARTIAL_FAILURE',
  'ANALYSIS_FAILED',
  'STORAGE_UNAVAILABLE',
  'NOT_FOUND',
  'INVALID_INPUT',
  'CONFIRMATION_REQUIRED',
  'DELETION_INTERRUPTED',
  'IDENTITY_NOT_READY',
  'NO_DATA',
  'EMPTY_RESULT',
  'MATERIAL_NOT_CONFIRMED',
  'SOURCE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** 错误标识 → 界面呈现口径（REQ-016：不静默失败、空态给一键清除、无授权给原因） */
export interface ErrorPresentation {
  /** 界面标题 */
  title: string;
  /** 处置类型：决定渲染哪种交互 */
  kind: 'retry' | 'clear-filter' | 'guide-update' | 'back' | 'inline' | 'confirm';
  /** 主操作按钮文案（无则为 null） */
  action: string | null;
}

export const ERROR_PRESENTATION: Record<ErrorCode, ErrorPresentation> = {
  NO_AUTH: { title: '数据来源未授权', kind: 'retry', action: '重试' },
  TIMEOUT: { title: '处理超时', kind: 'retry', action: '重试' },
  PARTIAL_FAILURE: { title: '部分来源失败', kind: 'retry', action: '重试失败来源' },
  ANALYSIS_FAILED: { title: '分析失败', kind: 'retry', action: '重试' },
  STORAGE_UNAVAILABLE: { title: '存储不可用', kind: 'retry', action: '重试' },
  NOT_FOUND: { title: '目标不存在', kind: 'back', action: '返回上一视图' },
  INVALID_INPUT: { title: '输入不合法', kind: 'inline', action: null },
  CONFIRMATION_REQUIRED: { title: '缺少二次确认', kind: 'confirm', action: '去确认' },
  DELETION_INTERRUPTED: { title: '删除中断', kind: 'retry', action: '按剩余范围重新发起' },
  IDENTITY_NOT_READY: { title: '「我」的身份未就绪', kind: 'retry', action: '手动重试' },
  NO_DATA: { title: '尚无可用数据', kind: 'guide-update', action: '更新数据' },
  EMPTY_RESULT: { title: '没有符合条件的结果', kind: 'clear-filter', action: '清除筛选' },
  MATERIAL_NOT_CONFIRMED: { title: '成员素材未确认', kind: 'confirm', action: '先确认素材' },
  SOURCE_UNAVAILABLE: { title: '来源不可用', kind: 'retry', action: '重试' },
};

/** 统一响应信封：失败时 data 为空、error 必填（REQ-016） */
export interface ApiEnvelope<T> {
  ok: boolean;
  data: T | null;
  error?: ApiError;
  /** 已缓存内容仍可浏览时，UI 需同时渲染内容与错误提示（REQ-016） */
  stale?: boolean;
}

export interface ApiError {
  code: ErrorCode;
  /** 原因说明（NO_AUTH / SOURCE_UNAVAILABLE / ANALYSIS_FAILED 必须给出） */
  message: string;
  /** 终端操作指引等补充说明（如 wechat-cli 未初始化时） */
  hint?: string;
}

/* ========================================================================== *
 * 1. 全局（raw_design §2.2、api-contract §1.3、REQ-004 ~ REQ-006）
 * ========================================================================== */

/**
 * 全局筛选条件 —— 全应用唯一筛选控件的值。
 * 作用于三个模块的所有视图；各模块不得自建同类筛选控件（REQ-004、REQ-049）。
 */
export interface GlobalFilter {
  /** 群多选；空 = 不限（REQ-004） */
  groupIds: string[];
  /** 时间范围；空 = 不限（REQ-004） */
  timeRange: { start?: string; end?: string };
  /** 关键词；匹配对象随模块而定（REQ-005）；空 = 不限 */
  keyword: string;
  /**
   * 身份：「我」的成员标识，取自 Me 标识、无需手工设置（REQ-006）。
   * 模块一 / 三生效；模块二不使用（模块二界面无身份维度）。
   * 界面不提供手工输入，仅展示与开关「我相关」视角。
   */
  meId?: string;
  /** 当前所在模块，用于决定关键词的匹配对象（REQ-005） */
  module: ModuleKey;
}

export type ModuleKey = 'meme' | 'extract' | 'social';

export const MODULE_LABEL: Record<ModuleKey, string> = {
  meme: '群聊梗分析',
  extract: '群聊信息提取',
  social: '正向 / 反向社交',
};

/** 更新状态（API-002 / DM-001）：首屏引导与「记录更新至 X」的数据来源 */
export interface UpdateStatus {
  /** = 群消息来源存在至少一条记录；为否时触发首屏引导（REQ-003） */
  hasData: boolean;
  /** 记录更新至 X = 群消息来源的最近成功时间；始终可见（REQ-002） */
  updatedTo: string | null;
  /** 按来源分别记录（API-002、REQ-002） */
  sources: SourceStatus[];
}

export interface SourceStatus {
  source: DataSource;
  status: 'success' | 'failed' | 'no_auth' | 'timeout';
  /** 最近成功时间；从未成功时为空 */
  lastSuccessAt?: string;
  /** 无授权 / 超时必须给出原因（DM-001） */
  failureReason?: string;
}

export type DataSource = 'group_messages' | 'contacts';

export const SOURCE_LABEL: Record<DataSource, string> = {
  group_messages: '群消息',
  contacts: '通讯录与好友列表',
};

export const SOURCE_STATUS_LABEL: Record<SourceStatus['status'], string> = {
  success: '成功',
  failed: '失败',
  no_auth: '无授权',
  timeout: '超时',
};

/** 触发更新（API-001）：分来源结果；部分失败不阻塞（REQ-016） */
export interface UpdateResult {
  results: { source: DataSource; status: SourceStatus['status']; imported?: number; failed?: { message: string; count: number }[]; failureReason?: string }[];
  finishedAt: string;
}

/* ========================================================================== *
 * 2. 底层实体（DM-002 ~ DM-005）
 * ========================================================================== */

/** DM-002 群 */
export interface Group {
  id: string;
  name: string;
}

/** DM-003 原始消息记录：全部结论的来源事实，可回跳原文的终点（REQ-007） */
export interface RawMessage {
  id: string;
  groupId: string;
  /** 发送者（→ DM-004） */
  senderId: string;
  senderName: string;
  /** 发送时间：全部时间口径的基准 */
  sentAt: string;
  /** 类型（DM-003）：九类系统 / 活动消息不进入本字段，记为 DM-010 的识别类型 */
  kind: MessageKind;
  /** 文本内容；图片 / 表情包消息为空 */
  text?: string;
  /** 媒体引用（图片 / 表情包），支持预览 */
  mediaUrl?: string;
  /** 提及成员（「被 @」判定依据） */
  mentionedIds?: string[];
  /** 引用消息（「直接接话」判定依据之一） */
  quotedMessageId?: string;
}

export type MessageKind = 'text' | 'image' | 'sticker';

export const MESSAGE_KIND_LABEL: Record<MessageKind, string> = {
  text: '文字',
  image: '图片',
  sticker: '表情包',
};

/** DM-004 群成员身份 */
export interface MemberIdentity {
  id: string;
  groupId: string;
  /** 群昵称 / 群名片（REQ-005 模块三关键词匹配对象） */
  displayName: string;
  /** 是否「我」：全库至多一条为真（REQ-006） */
  isMe: boolean;
  /** 归属的人（→ DM-011）：跨群合并后指向同一人 */
  personId: string;
}

/* ========================================================================== *
 * 3. 模块一：群聊梗分析（DM-006 ~ DM-009、API-009 ~ API-013）
 * ========================================================================== */

/** 梗类型：≤3 类，带图例且每类另有文字标签（REQ-020） */
export type MemeType = 'catchphrase' | 'inner' | 'sticker';

export const MEME_TYPE_LABEL: Record<MemeType, string> = {
  catchphrase: '口头禅',
  inner: '内部梗',
  sticker: '表情包梗',
};

/** 梗类型 → 颜色（图例同源）；颜色不单独承载信息（REQ-020） */
export const MEME_TYPE_COLOR: Record<MemeType, string> = {
  catchphrase: '#07C160',
  inner: '#0ea5e9',
  sticker: '#f59e0b',
};

/** 热度状态：按距今 ≤7 活跃 / 8–30 衰减中 / >30 已沉寂（REQ-028） */
export type HeatState = 'active' | 'fading' | 'silent';

export const HEAT_STATE_LABEL: Record<HeatState, string> = {
  active: '活跃',
  fading: '衰减中',
  silent: '已沉寂',
};

/** 词云字号口径（REQ-020 / REQ-042 对应 AC-042） */
export type FontScaleMode = 'cumulative' | 'window';

export const FONT_SCALE_LABEL: Record<FontScaleMode, string> = {
  cumulative: '累计出现次数',
  window: '指定时间窗内出现频次',
};

/** 词云布局（REQ-023） */
export type CloudLayout = 'heat' | 'firstSeen';

export const CLOUD_LAYOUT_LABEL: Record<CloudLayout, string> = {
  heat: '按热度',
  firstSeen: '按首次出现时间',
};

/** 梗词云条目（API-009 出参：梗名、频率值、出现次数、类型、首现时间、最近调用时间） */
export interface MemeCloudEntry {
  memeId: string;
  name: string;
  /** 频率值：按入参口径（累计 / 时间窗） */
  frequency: number;
  occurrences: number;
  type: MemeType;
  firstSeenAt: string;
  lastUsedAt: string;
  /** 「我相关」标记（REQ-006 视角） */
  mine?: boolean;

  /* ---- 以下为梗速览条展示所需（与梗单元同源，避免卡片内容比单元还空） ---- */
  /** 解读：什么意思 / 从哪来 / 现在怎么用（REQ-026） */
  interpretation?: string;
  /** 热度状态三档（REQ-028） */
  heatState?: HeatState;
  /** 活跃天数（首现 → 最近调用） */
  activeDays?: number;
  /** 周环比（REQ-028） */
  weekOverWeek?: number;
  /** 月度分布（REQ-029），卡片内用迷你柱呈现 */
  monthly?: MonthlyBucket[];
  /** 梗王与主要使用者（REQ-031） */
  king?: MemeKing;
  /** 精华消息：文字与梗图都支持（REQ-032） */
  highlights?: HighlightMessage[];
  /** 按月强度，卡片内画生命周期条（REQ-030） */
  intensity?: { month: string; intensity: number; count: number }[];
}

export interface MemeCloudResult {
  entries: MemeCloudEntry[];
  /** 图例：类型 → 颜色 + 文字标签 */
  legend: { type: MemeType; color: string; label: string }[];
  /** 来源消息引用（REQ-007） */
  sourceRefs: SourceRef[];
}

/** 来源消息引用：每条结论都能回到原始消息（REQ-007） */
export interface SourceRef {
  messageId: string;
  groupId: string;
  groupName: string;
  senderName: string;
  sentAt: string;
  excerpt: string;
}

/* -------------------------------------------------------------------------- */
/* 梗王榜（模块一的排行榜；展示用派生值）                                        */
/* -------------------------------------------------------------------------- */

/**
 * 榜单里每个人的三项指标与综合评分。
 *
 * 口径（均为可由对话记录统计的事实，不做性格判断 —— REQ-031、REQ-041）：
 *   · 参与度 = 该成员使用梗的总次数（说了多少次）
 *   · 创造力 = 由该成员**首次带火**的梗数量
 *     （该梗的首现消息出自他，且这个梗被全群反复使用 —— 对应「梗王」的判定）
 *   · 综合分 = 参与度 40% + 覆盖广度 20% + 带火贡献 40%，
 *     三项各自除以群内最大值归一化到 0–100 后加权求和
 */
export interface MemeKingRow {
  memberId: string;
  name: string;
  /** 参与度：使用梗的总次数 */
  participations: number;
  /** 覆盖广度：用过的不同梗数量 */
  distinctMemes: number;
  /** 创造力：由该成员首次带火、且被全群反复使用的梗数量 */
  authoredHits: number;
  /** 由该成员带火的梗（用于展开查看） */
  authoredMemeNames: string[];
  /** 三项归一化后的分值 */
  normalized: { participations: number; distinctMemes: number; authoredHits: number };
  /** 综合评分 0–100 */
  score: number;
  /** 综合榜第一名 = 梗王 */
  isKing: boolean;
  rank: number;
}

export interface MemeKingBoard {
  rows: MemeKingRow[];
  /** 梗王（综合分第一；并列时取参与度更高者） */
  king?: MemeKingRow;
  /** 计算该榜所用的总提及次数，便于界面说明口径 */
  totalParticipations: number;
}

/* -------------------------------------------------------------------------- */
/* 梗年鉴（全屏翻页回顾；模块一的展示形态之一）                                   */
/* -------------------------------------------------------------------------- */

/** 年鉴里「一个凉掉的梗」：火过又凉了（出现次数多、但最近基本不再出现） */
export interface FadedMeme {
  memeId: string;
  name: string;
  occurrences: number;
  /** 峰值时间（ISO） */
  peakAt: string;
  /** 峰值所在月份，文案里用「X 月 X 日」 */
  peakLabel: string;
  /** 沉寂时间（最近一次出现） */
  silentAt: string;
  /** 距最近一次出现的天数 */
  silentDays: number;
}

/** 年鉴所需的全部数据（一次取回，翻页不再请求） */
export interface MemeYearbook {
  groupName: string;
  /** 数据时间范围（用于封面与文案） */
  range: { start: string; end: string };
  /** 这段时间的消息总数 */
  totalMessages: number;
  /** 其中「玩梗消息」数 = 全部梗出现记录之和 */
  memeMessages: number;
  /** 最热的梗 */
  topMeme?: { memeId: string; name: string; occurrences: number };
  /** 最热梗的诞生：第一条使用它的消息 */
  topMemeBirth?: {
    memeName: string;
    senderName: string;
    text: string;
    sentAt: string;
    groupName: string;
  };
  /** 自动挑选的「火过又凉了」的梗 */
  fadedMeme?: FadedMeme;
  /** Top10 梗（供生成群称号用） */
  topMemes: { memeId: string; name: string; occurrences: number }[];
  /**
   * 群称号（LLM 依据 Top10 梗生成）。
   * 由前端按「群 + 时间范围」缓存，避免每次翻页都重新生成。
   */
  title?: string;
  /** 数据是否足以写年鉴（不足时界面显示「数据还不够写年鉴」） */
  enough: boolean;
}

/** 月度分布项（REQ-029 / AC-054：标注不完整月份） */
export interface MonthlyBucket {
  /** 'YYYY-MM' */
  month: string;
  count: number;
  /** 不完整月份 = 当月或数据未覆盖整月的边界月 */
  incomplete: boolean;
}

/** 生命周期（REQ-030）：首现 → 峰值 → 沉寂，活跃天数 */
export interface Lifecycle {
  firstSeenAt: string;
  /** 峰值 = 出现次数最多的月份 */
  peakAt: string;
  /** 沉寂点 = 最近一次出现的时间点 */
  silentAt: string;
  /** 活跃天数 = 首现到最近调用时间的自然日跨度 */
  activeDays: number;
}

/** 梗王（REQ-031 / AC-056、AC-057）：只呈现可统计事实 */
export interface MemeKing {
  /** 并列时全部列出 */
  members: { memberId: string; name: string; count: number; ratio: number }[];
  /** 主要使用者 */
  topUsers: { memberId: string; name: string; count: number }[];
}

/** 精华消息（REQ-032 / AC-058、AC-059）：文字与梗图都支持 */
export interface HighlightMessage {
  messageId: string;
  senderName: string;
  sentAt: string;
  kind: MessageKind;
  text?: string;
  mediaUrl?: string;
  /** 查看上下文 */
  groupId: string;
  groupName: string;
}

/** 梗单元（API-010 出参）—— 梗的唯一展示与操作单元（REQ-017） */
export interface MemeUnit {
  memeId: string;
  name: string;
  type: MemeType;
  /** 归属群：一个梗只属一个群（DM-006） */
  groupId: string;
  groupName: string;
  /** 解读：什么意思、从哪来、现在怎么用（REQ-026） */
  interpretation: string;
  firstSeenAt: string;
  firstSeenGroupName: string;
  lastUsedAt: string;
  /** 距今（人话描述，如「3 天前」） */
  sinceLastUse: string;
  occurrences: number;
  /** 周环比（REQ-028） */
  weekOverWeek: number;
  heatState: HeatState;
  monthly: MonthlyBucket[];
  lifecycle: Lifecycle;
  king: MemeKing;
  /** 默认 3 条，可展开更多（AC-059：不足 3 条时按实际条数） */
  highlights: HighlightMessage[];
  /** 相关变体（REQ-033） */
  variants: { memeId: string; name: string }[];
  /** 纠正标记（REQ-035） */
  correction: CorrectionMark;
  sourceRefs: SourceRef[];
  /** 「我相关」（REQ-006） */
  mine: boolean;
}

/** 纠正改判四类（REQ-035 / API-012） */
export type CorrectionMark = 'none' | 'not_meme' | 'not_interested' | 'merged' | 'king_wrong';

/**
 * 本地纠正记录（模块一）
 * =============================================================================
 * 与兴趣标签的增删改一致：纠正结果先写本地状态、**立即生效并刷新词云**，
 * 同时把记录回传后端（`API-012`）。之所以要「本地优先」，是因为后端是模型
 * 周期总结出来的，可能与使用者的纠正冲突 —— 本地记录即**黑名单**：
 * 再次拿到后端结果时，这些条目仍按本地口径处理，不会被模型重新「纠正回去」。
 *
 * 四类动作的语义（均可撤销）：
 *   · not_meme       这不是梗      → 从梗库移除（不参与词云与统计）
 *   · not_interested 不感兴趣      → 隐藏但保留数据（不参与呈现，仍可统计与撤销）
 *   · merged         合并到其他梗  → 出现记录并入目标梗，自身不再单独呈现
 *   · king_wrong     梗王标注有误  → 用人工指定的成员覆盖模型给出的梗王
 */
export interface LocalCorrection {
  memeId: string;
  /** 梗名快照：列表移除后仍能显示改判记录 */
  memeName: string;
  mark: CorrectionMark;
  /** merged 时的目标梗 */
  mergeTargetId?: string;
  mergeTargetName?: string;
  /** king_wrong 时人工指定的成员 */
  kingOverride?: { memberId: string; name: string };
  correctedAt: string;
}

export const CORRECTION_LABEL: Record<CorrectionMark, string> = {
  none: '无',
  not_meme: '这不是梗',
  not_interested: '不感兴趣',
  merged: '已合并至',
  king_wrong: '梗王标注有误',
};

/** 生命周期视图的一行（API-011 出参：REQ-025） */
export interface LifecycleRow {
  memeId: string;
  name: string;
  type: MemeType;
  firstSeenAt: string;
  peakAt: string;
  silentAt: string;
  activeDays: number;
  /** 按月强度（顺序色阶） */
  monthlyIntensity: { month: string; intensity: number; count: number }[];
}

export interface LifecycleView {
  rows: LifecycleRow[];
  /** 当月领跑梗（REQ-025） */
  monthlyLeaders: { month: string; memeId: string; name: string; count: number }[];
  legend: { type: MemeType; color: string; label: string }[];
}

/* ========================================================================== *
 * 4. 模块二：群聊信息提取（DM-010、API-014 ~ API-019）
 * ========================================================================== */

/** 识别类型：至少九类，可扩展（REQ-043） */
export type ExtractType =
  | 'announcement'
  | 'at_all'
  | 'relay'
  | 'vote'
  | 'signup'
  | 'payment'
  | 'meeting'
  | 'activity'
  | 'deadline'
  | 'other';

export const EXTRACT_TYPE_LABEL: Record<ExtractType, string> = {
  announcement: '群公告',
  at_all: '@所有人',
  relay: '接龙',
  vote: '投票',
  signup: '报名',
  payment: '缴费',
  meeting: '会议',
  activity: '活动',
  deadline: '截止日期',
  other: '其他',
};

/** 优先级：三档闭集（REQ-045、DM-010） */
export type Priority = 'high' | 'medium' | 'low';

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/** 待办状态：未处理为初始状态（REQ-046） */
export type TodoState = 'pending' | 'done' | 'ignored';

export const TODO_STATE_LABEL: Record<TodoState, string> = {
  pending: '未处理',
  done: '完成',
  ignored: '忽略',
};

/** 通知总览浏览维度（REQ-045 / API-015） */
export type NoticeDimension = 'source' | 'type' | 'priority' | 'todo';

export const NOTICE_DIMENSION_LABEL: Record<NoticeDimension, string> = {
  source: '按来源',
  type: '按类型',
  priority: '按优先级',
  todo: '按待办',
};

/** 提取条目（DM-010；API-014 出参） */
export interface ExtractItem {
  id: string;
  type: ExtractType;
  /** 要素：时间 / 地点 / 人物 / 事项 / DDL（REQ-043） */
  elements: {
    time?: string;
    location?: string;
    people?: { memberId: string; name: string }[];
    subject?: string;
    deadline?: string;
  };
  /** 主题：由聚类命名、可改（REQ-044） */
  subject: string;
  /** 缺省取「事项要素」，两者同源展示 */
  groupId: string;
  groupName: string;
  sentAt: string;
  /** 一句话总结（详情 heading，REQ-048） */
  summaryLine: string;
  /** AI 总结（详情正文） */
  aiSummary: string;
  priority: Priority;
  todoState: TodoState;
  /** = 待办状态为「未处理」且当前时间距 DDL ≤ 1 天（DM-010、REQ-046） */
  remindState: 'remind' | 'no_remind';
  sourceRefs: SourceRef[];
}

/** 消息详情（API-019 出参）：heading + 正文（REQ-048） */
export interface MessageDetail {
  id: string;
  /** heading：AI 一句话总结 + 来源群 + 时间 */
  heading: {
    summaryLine: string;
    groupName: string;
    sentAt: string;
  };
  /** 正文：AI 总结 + 所有来源群消息 */
  body: {
    aiSummary: string;
    messages: RawMessage[];
  };
  /** 内联兴趣提示（REQ-070，由 MOD-004 经 API-029 另行组装） */
  interestHints?: MemberInterestHint[];
}

/** 成员兴趣提示（API-029 出参）：仅含已确认数据（REQ-070、REQ-075） */
export interface MemberInterestHint {
  memberId: string;
  memberName: string;
  /** 已确认的兴趣提示；无数据时不显示提示（不弹错误） */
  interests: string[];
  /** 发言不足、不足以推断（REQ-081） */
  unknown?: boolean;
}

/* ========================================================================== *
 * 5. 模块三：正向 / 反向社交（DM-011 ~ DM-019、API-020 ~ API-029）
 * ========================================================================== */

/**
 * 查询方向（REQ-050）：同一份「人 ↔ 兴趣」数据的两个方向
 *   forward 正向 = 人 → 兴趣（人物兴趣画像）
 *   reverse 反向 = 兴趣 → 人（找搭子）
 */
/**
 * 活跃度综合分（**仅用于展示的派生值，不属于契约字段**）
 * =============================================================================
 * 口径（由提出者给定）：
 *   · 消息条数          权重 50%
 *   · 平均回复时长      权重 30%（越短得分越高）
 *   · 活跃新鲜度        权重 20%（距最近一次发言的天数，越近越高）
 *   每项先除以群内最大值归一化到 0–100，再加权求和。
 *
 * 与契约的关系（务必注意，不要混淆）：
 *   · `DM-011` 的「活跃度」= **数值（发言量）**，口径为跨群发言量，用于契合度因子
 *     （`REQ-057`、`REQ-058`）——本类型**不替换**它，`PersonProfile.activity` 仍是发言量。
 *   · 本类型只是雷达图第五轴的展示值（替代「社交」轴的读法），取值与三项原始指标
 *     一并返回，便于悬停时展示明细而不只给一个总分。
 *   · 样本不足（消息条数 < 10）时不做推测，按 `insufficient` 展示「数据不足」。
 */
export interface ActivityBreakdown {
  /** 综合分 0–100（加权求和后的结果） */
  score: number;
  /** 样本不足，不做推测（消息条数 < 10） */
  insufficient: boolean;
  /** 三项原始指标 + 各自归一化后的分值，供悬停明细展示 */
  metrics: {
    key: 'messages' | 'reply' | 'freshness';
    label: string;
    /** 原始值（消息条数 / 分钟 / 天数） */
    raw: number;
    /** 归一化后 0–100；无样本时为 null */
    normalized: number | null;
    /** 参与计算的权重（无样本的维度权重会被按比例摊到其余维度） */
    effectiveWeight: number;
    /** 该项在当前群内的最大值，用于说明归一化基准 */
    groupMax: number;
    /** 无样本时给出来源说明（如「未被 @ 或接话，无样本」） */
    note?: string;
  }[];
}

export type SocialDirection = 'forward' | 'reverse';

/** 一级固定五类，不增不减（REQ-052） */
/**
 * 一级维度：契约层固定五类，**不增不减**（REQ-052、DM-013）。
 * ⚠️ 雷达图的第五根轴在界面上显示为「活跃度」（替代原「社交」轴的可读性），
 * 但数据层仍是这五类，`social` 分类与 `categoryScores.social` 均照常存在，
 * 以保证与 `DM-013`/`DM-020` 的口径一致。
 */
export type InterestCategory = 'sports' | 'art' | 'game' | 'entertainment' | 'social';

export const INTEREST_CATEGORY_LABEL: Record<InterestCategory, string> = {
  sports: '运动',
  art: '艺术',
  game: '游戏',
  entertainment: '娱乐',
  /**
   * 第五类在**界面上的名称**是「活跃度」（按提出者裁定：仅改名称，数据口径不变）。
   * 契约层（DM-013）仍定义为「社交」，分类与 categoryScores 均照常存在，
   * 因此这里只改展示标签，字段名不动。
   */
  social: '活跃度',
};

export const INTEREST_CATEGORIES: InterestCategory[] = ['sports', 'art', 'game', 'entertainment', 'social'];

/** 性格六维闭集固定（REQ-072、REQ-074） */
export type PersonalityTrait = 'leadership' | 'lively' | 'humorous' | 'calm' | 'rational' | 'judgement';

export const PERSONALITY_LABEL: Record<PersonalityTrait, string> = {
  leadership: '领导式',
  lively: '活泼',
  humorous: '幽默',
  calm: '冷静',
  rational: '理性',
  judgement: '判断',
};

export const PERSONALITY_TRAITS: PersonalityTrait[] = ['leadership', 'lively', 'humorous', 'calm', 'rational', 'judgement'];

/** 二级标签（DM-013 / DM-014）：每条必须带证据（REQ-053、REQ-054） */
export interface InterestTag {
  tagId: string;
  name: string;
  category: InterestCategory;
  /** 置信度：用于维度分求和与契合度加权（REQ-080、REQ-058） */
  confidence: number;
  /** 证据消息引用；无证据的标签不进入画像 */
  evidence: SourceRef[];
  /** 来源方式：模型抽取 / 同义归并 / 人工增改（REQ-055、REQ-056） */
  origin: 'extracted' | 'merged' | 'manual';
  /** 归并组代表标签名（同义合并后对外呈现代表标签） */
  mergedFrom?: string[];
}

export const TAG_ORIGIN_LABEL: Record<InterestTag['origin'], string> = {
  extracted: '模型抽取',
  merged: '同义归并',
  manual: '人工增改',
};

/** 人物兴趣画像（API-020 出参、REQ-061、REQ-071、REQ-073） */
export interface PersonProfile {
  personId: string;
  name: string;
  /** 是否「我」（REQ-006） */
  isMe: boolean;
  /** 发言不足、不足以推断兴趣 → 标「未知」但不做推测、仍列出（REQ-081） */
  unknown: boolean;
  tags: InterestTag[];
  /** 一级维度分 = 该维度下全部二级标签置信度之和（REQ-080） */
  categoryScores: Record<InterestCategory, number>;
  /** 个人标签词云（与模块一「梗词云」不同物、不共用名称 —— REQ-017、REQ-073） */
  personalCloud: { name: string; confidence: number; category: InterestCategory }[];
  /** 性格标签（六维分数；不再区分候选/已确认 —— 评审裁定） */
  personality: PersonaTrait[];
  /** 性格六维分（雷达图直接使用；缺项按 0 处理） */
  personalityScores?: Partial<Record<PersonalityTrait, number>>;
  /** 活跃度（**发言量**，DM-011 口径；用于契合度因子，只计一次 —— REQ-057） */
  activity: number;
  /**
   * 活跃度综合分：雷达图第五轴的展示值（消息条数 50% + 回复时长 30% + 新鲜度 20%）。
   * 由前端按三项原始指标计算；后端若直接下发同口径结果则优先使用后端的。
   */
  activityScore?: ActivityBreakdown;
  /** 回复时长中位数（分钟）；无可统计样本时为空（REQ-066） */
  replyMedianMinutes?: number;
  /** 共同群（跨群合并后） */
  groups: { groupId: string; groupName: string }[];
}

/**
 * 性格标签（DM-016）。
 *
 * 口径更新（评审裁定）：**不再区分「候选 / 已确认」，也不做确认交互**，
 * 性格雷达图直接展示六维分数。因此 `status` 变为可选（保留字段以便与
 * `DM-016` 的既有定义兼容，界面不再使用它）。
 */
export interface PersonaTrait {
  traitId: string;
  trait: PersonalityTrait;
  score: number;
  /** 已废弃：界面不再区分候选与已确认 */
  status?: 'candidate' | 'confirmed';
  origin: 'inferred' | 'manual';
}

/**
 * 性格标签面板数据：候选与已确认分开返回，未确认候选不得出现在任何
 * 产物与视图中（REQ-075），因此候选只在确认面板内出现。
 */
export interface PersonaPanel {
  personId: string;
  personName: string;
  candidates: PersonaTrait[];
  confirmed: PersonaTrait[];
}

/** 兴趣 → 人（API-021 出参、REQ-060、REQ-064、REQ-065） */
export interface InterestPeopleResult {
  /** 检索入口：按一级维度 / 按二级标签 */
  entry: 'category' | 'tag';
  entryLabel: string;
  people: {
    personId: string;
    name: string;
    /** 该人在这项兴趣上的置信度 */
    confidence: number;
    /** 回复时长与活跃度（REQ-065） */
    replyMedianMinutes?: number;
    /** 发言量（DM-011 口径） */
    activity: number;
    /** 活跃度综合分：结果里「活跃度」的展示值（消息 50% + 回复时长 30% + 新鲜度 20%） */
    activityScore: ActivityBreakdown;
    /** 未知成员仍列出并注记（REQ-081） */
    unknown: boolean;
    evidence: SourceRef[];
  }[];
}

/** 两人配对（API-022 出参、REQ-058、REQ-059、REQ-062） */
export interface PairMatch {
  personA: { personId: string; name: string };
  personB: { personId: string; name: string };
  /** 共同爱好（REQ-062） */
  sharedInterests: { tagId: string; name: string; category: InterestCategory }[];
  /** 契合度 = 共同标签数 + 置信度加权 + 实际互动 + 活跃度（只计一次）（REQ-058） */
  compatibility: {
    total: number;
    /** 四项因子分解，便于界面给出可解释的理由 */
    factors: { key: string; label: string; value: number }[];
  };
  /** 逐维度差值（雷达叠加对比，REQ-059） */
  categoryDiff: Record<InterestCategory, { a: number; b: number; diff: number }>;
}

/** 我的社交契合度（API-023 出参、REQ-079） */
export interface MyCompatibility {
  /** ①我 vs 每个群友的逐人契合度 */
  perPerson: { personId: string; name: string; score: number; sharedCount: number }[];
  /** ②我在群里的整体融入度（单一分数） */
  integration: number;
}

/** 组局建议（API-024 出参、REQ-063）：仅文字、不含待办、不含可直接发送的文案 */
export interface GatheringSuggestion {
  interest: string;
  candidates: { personId: string; name: string }[];
  /** 纯文字建议，如「可以约 A、B、C 打羽毛球」 */
  text: string;
}

/** 身份对齐候选（DM-012、API-025 / API-026、REQ-082） */
export interface IdentityAlignmentCandidate {
  candidateId: string;
  /** 涉及的群成员（两个及以上） */
  members: { memberId: string; groupName: string; displayName: string }[];
  /** 候选来源：通讯录 / 好友列表（DM-005 的最小字段集） */
  source: DataSource;
  /** 未确认与已否定均不生效 */
  status: 'unconfirmed' | 'confirmed' | 'rejected';
  confirmedAt?: string;
}

export const ALIGNMENT_STATUS_LABEL: Record<IdentityAlignmentCandidate['status'], string> = {
  unconfirmed: '未确认',
  confirmed: '已确认',
  rejected: '已否定',
};

/** 人-人关系图谱（REQ-069）：节点 = 人，连线 = 共同爱好；未知成员零连线（REQ-081） */
export interface RelationGraph {
  nodes: { personId: string; name: string; unknown: boolean; activity: number; isMe: boolean }[];
  links: { source: string; target: string; sharedCount: number; sharedInterests: string[] }[];
}

/** 兴趣时间轴 / 事件流（REQ-067、REQ-087）：仅可视化，不参与权重 */
export interface InterestEventStream {
  tagId: string;
  name: string;
  category: InterestCategory;
  firstSeenAt: string;
  events: { at: string; intensity: number; personName: string }[];
}

/** 兴趣热度分 / 置信度评分卡（REQ-068、REQ-078） */
export interface InterestScoreCard {
  tagId: string;
  name: string;
  category: InterestCategory;
  /** 兴趣热度分 = 该爱好下的人的活跃 / 投入程度 */
  heat: number;
  /** 涉及人数 */
  peopleCount: number;
  /** 该标签下按人给出的置信度 */
  perPerson: { personId: string; name: string; confidence: number }[];
}

/* ========================================================================== *
 * 6. 模块四：再创作生成（DM-020 ~ DM-022、API-030 ~ API-034）
 * ========================================================================== */

/** 生成入口三类（REQ-036 ~ REQ-038） */
export type GenerateKind = 'G1' | 'G2' | 'G3';

export const GENERATE_KIND_LABEL: Record<GenerateKind, string> = {
  G1: '生成表情包',
  G2: '生成更多文字变体',
  G3: '创造新梗',
};

/** 素材档位：三档单选其一，不可多选（REQ-036） */
export type MaterialTier = 'group_image' | 'popular_sticker' | 'pure_template';

export const MATERIAL_TIER_LABEL: Record<MaterialTier, string> = {
  group_image: '参考群内相关图片',
  popular_sticker: '改编热门表情包',
  pure_template: '纯模板生成',
};

/** 梗上下文：由 MOD-004 转交（非模块间直接依赖） */
export interface MemeContext {
  memeId: string;
  name: string;
  interpretation: string;
  variants: string[];
  /** 精华图片引用 */
  highlightImages: { messageId: string; mediaUrl: string }[];
}

/** G1 产出：同一模板下 4 张文案变体（REQ-036、AC-031） */
export interface StickerGeneration {
  images: { url: string; caption: string }[];
  /** 全部生成物必须带「创作」标注（REQ-013） */
  creationMark: true;
}

/** G2 产出：默认 5 条文字变体（REQ-037） */
export interface TextVariantGeneration {
  variants: string[];
  creationMark: true;
}

/** G3 产出：候选梗单元，确认前不进入词云等视图（REQ-038） */
export interface NewMemeCandidate {
  candidateId: string;
  name: string;
  /** 含义推测 */
  meaningGuess: string;
  /** 出处消息（必须给出） */
  sources: SourceRef[];
  /** 使用示例 */
  examples: string[];
  status: 'candidate' | 'confirmed' | 'discarded';
  /** 确认后回填入库梗标识 */
  memeId?: string;
}

/** 生成历史（DM-020、API-034） */
export interface GenerationHistoryItem {
  id: string;
  kind: GenerateKind;
  memeId?: string;
  memeName?: string;
  /** 素材档位（非 G1 为空） */
  tier?: MaterialTier;
  template?: string;
  createdAt: string;
  /** 产出引用：可回看与再次下载 */
  outputs: { url?: string; text?: string }[];
  creationMark: true;
}

/** 素材合规确认（DM-022、REQ-014） */
export interface MaterialConsent {
  consentId: string;
  /** 素材引用（群内图片 / 成员头像 / 照片 / 原话） */
  materialRef: string;
  memberId: string;
  memberName: string;
  status: 'unconfirmed' | 'confirmed';
  confirmedAt?: string;
}

/* ========================================================================== *
 * 7. 删除流程（API-005 / API-006、REQ-011、REQ-012）
 * ========================================================================== */

export type DeleteScope = { kind: 'group'; groupId: string } | { kind: 'all' };

/** 删除预检出参：受影响实体清单与计数（原始 + 派生 + 生成历史） */
export interface DeletePrecheck {
  scope: DeleteScope;
  scopeLabel: string;
  items: { entity: string; label: string; count: number }[];
  total: number;
}

/** 执行删除出参：各实体删除计数 */
export interface DeleteResult {
  items: { entity: string; label: string; count: number }[];
  undone: boolean;
}

/** 数据去向说明（REQ-012、AC-030）：首次使用与设置页各一处 */
export interface DataFlowNotice {
  /** 模型服务地址与凭据可配置 */
  modelEndpoint: string;
  /** 说明数据去向的文案 */
  statements: string[];
}

/* ========================================================================== *
 * 8. 分页（API-004：页码 ≥1、每页条数 ≥1，默认 50）
 * ========================================================================== */

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
