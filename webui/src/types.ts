/**
 * 聊斋 MessagePick — 前端数据契约（Data Contract）
 * =============================================================================
 * 设计原则（raw_design.md / PRD 尚未定稿，故本文件以「可扩展」为第一约束）：
 *
 * 1. 每个领域对象都带 `ext?: Record<string, unknown>` 逃生舱字段。
 *    后端 core 新增字段时，前端无需改类型即可透传，UI 也可按需消费。
 * 2. 所有「分析结果」统一包在 `AnalysisEnvelope` 中，
 *    这样后续接入真实 LLM 输出 / MCP 工具时，只换 adapter 不换组件。
 * 3. 底层字段命名尽量对齐 wechat-cli 的真实 JSON 输出
 *    （sessions / history / contacts / members / stats / media），
 *    避免二次翻译造成口径漂移。
 * 4. 消息类型枚举取自 wechat-cli `MSG_TYPE_FILTERS`，保持一一对应。
 *
 * TODO(接口待定): 标注处为 raw_design.md 定稿后需要与后端确认的字段。
 */

/* ========================================================================== *
 * 0. 通用
 * ========================================================================== */

/** 任意领域对象都可挂载的扩展位 —— 后端新增字段无需改前端类型 */
export interface Extensible {
  ext?: Record<string, unknown>;
}

/** 后端统一响应信封（与 utils/core 的返回约定对齐） */
export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  /** 人类可读的说明，用于 UI 顶部提示条 */
  notice?: string;
  /** 数据来源：mock | wechat-cli | llm | mcp —— 便于在界面上诚实标注 */
  source?: DataSource;
  /** 分析耗时（ms），LLM 链路用 */
  elapsed_ms?: number;
  /** 失败/降级原因，UI 需渲染为异常分支 */
  error?: ApiError;
  ext?: Record<string, unknown>;
}

export type DataSource = 'mock' | 'wechat-cli' | 'llm' | 'mcp' | 'cache';

export interface ApiError {
  code:
    | 'NOT_INITIALIZED' // 未执行 wechat-cli init，取不到密钥
    | 'CHAT_NOT_FOUND' // 找不到该聊天对象
    | 'NO_MESSAGES' // 时间范围内无消息
    | 'LLM_TIMEOUT' // 大模型超时
    | 'LLM_FAILED' // 大模型失败
    | 'MEDIA_MISSING' // 媒体文件缺失/未解密
    | 'PERMISSION_DENIED'
    | 'UNKNOWN';
  message: string;
  /** 可执行的修复建议，直接展示给用户 */
  hint?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

/* ========================================================================== *
 * 1. 会话 / 群 / 成员（对齐 wechat-cli `sessions` / `members`）
 * ========================================================================== */

export type ChatMessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'sticker'
  | 'location'
  | 'link'
  | 'file'
  | 'call'
  | 'system';

export interface ChatSession extends Extensible {
  /** 展示名（群名 / 好友昵称） */
  chat: string;
  /** wxid，群聊形如 xxxx@chatroom */
  username: string;
  is_group: boolean;
  unread: number;
  last_message: string;
  msg_type: string;
  /** 群聊时为本条消息发送者显示名 */
  sender: string;
  timestamp: number;
  /** 已格式化的 'MM-DD HH:mm' */
  time: string;
  /** 前端补充：头像 URL（wechat-cli contacts 的 avatar 字段） */
  avatar?: string;
  /** 前端补充：成员数，群聊才有 */
  member_count?: number;
}

export interface ChatMember extends Extensible {
  display_name: string;
  username: string;
  remark?: string;
  avatar?: string;
  /** 发言条数（由 stats.top_senders 回填，用于画像页） */
  message_count?: number;
  is_owner?: boolean;
}

/* ========================================================================== *
 * 2. 原始消息（对齐 wechat-cli `history`）
 * ========================================================================== */

/**
 * wechat-cli 的 history 目前返回的是「已格式化的行文本」：
 *   `[2026-04-01 09:12] 张三: 明天下午三点开会`
 * 为了让前端能做结构化展示（通知卡片、梗上下文、时间轴），
 * 这里定义 NormalizedMessage：由 adapter 解析得到，adapter 未升级时
 * 至少能保证 raw_line 可用（降级显示，不阻塞 UI）。
 */
export interface NormalizedMessage extends Extensible {
  id: string;
  chat: string;
  username: string;
  is_group: boolean;
  sender: string;
  /** 发送者 wxid（若 adapter 能从 Name2Id 还原） */
  sender_username?: string;
  /** 是否是当前用户自己发的 */
  is_self?: boolean;
  type: ChatMessageType;
  /** 展示文本（已剥离类型标签） */
  text: string;
  /** 原始行，保底显示 */
  raw_line: string;
  timestamp: number;
  time: string;
  /** --media 解析出的本地文件路径（图片/表情/文件/视频/语音） */
  media_path?: string;
  media_exists?: boolean;
  /** 语音时长（秒），TODO(接口待定) */
  voice_duration?: number;
  /** 图片/表情宽高，用于瀑布流占位 */
  width?: number;
  height?: number;
}

/* ========================================================================== *
 * 3. 功能一：热梗提炼与再创作（MemeRadar）
 * ========================================================================== */

/** 梗卡片 */
export interface MemeCard extends Extensible {
  id: string;
  /** 梗的主体词，如「已阅」「摸鱼」 */
  term: string;
  /** 词云字号权重用的出现次数 */
  count: number;
  /** LLM 给的一句话解释：这个梗在群里指什么 */
  meaning: string;
  /** 群内专属黑话 / 网络热梗 / 表情 / 事件 —— 用于分类筛选 */
  category: MemeCategory;
  /** 来源群（跨群汇总时使用） */
  chats: string[];
  first_seen: string; // ISO
  last_seen: string; // ISO
  /** 活跃天数：首次出现 → 最近一次调用 */
  lifespan_days: number;
  /** 热度趋势：按天聚合，用于卡片内 mini 面积图 */
  trend: TrendPoint[];
  /** 按时间划分的分布图（目标.md 明确要求） */
  timeline: MemeTimelineBucket[];
  /** 使用该梗最频繁的成员 */
  top_contributors: { name: string; count: number }[];
  /** 代表性原始消息，点击卡片右侧抽屉展示 */
  samples: MemeSample[];
  /** 语境描述：什么场景下会被用 */
  context?: string;
  /** LLM 置信度 0~1，低置信度 UI 需弱化展示 */
  confidence?: number;
  /** 关联梗 id，用于「梗之间的关系」 */
  related_ids?: string[];
}

export type MemeCategory = 'catchphrase' | 'slang' | 'sticker' | 'event' | 'nickname';

export const MEME_CATEGORY_LABEL: Record<MemeCategory, string> = {
  catchphrase: '口头禅',
  slang: '群内黑话',
  sticker: '表情梗',
  event: '共同事件',
  nickname: '专属称呼',
};

export interface TrendPoint {
  /** 'MM-DD' */
  date: string;
  count: number;
}

/** 梗的时间分布桶（目标.md：按时间划分的分布图） */
export interface MemeTimelineBucket {
  /** 'YYYY-MM-DD' or 'YYYY-MM' */
  bucket: string;
  count: number;
  /** 首次使用时间 */
  first_used_at: string;
  /** 最近一次调用时间 */
  last_used_at: string;
  /** 该桶内的热度等级，用于时间轴色阶 */
  intensity: number; // 0~1
}

export interface MemeSample extends Extensible {
  sender: string;
  text: string;
  time: string;
  chat: string;
  /** 关联到的原始消息 id，用于「跳转原消息」 */
  message_id?: string;
}

/* ---- 词云 ---- */

export interface WordCloudItem {
  term: string;
  count: number;
  /** 归一化权重 0~1，由 count 映射 */
  weight: number;
  meme_id?: string;
  category?: MemeCategory;
  /** 'MM-DD'：首次出现时间，供「按出现时间排序」视图展示 */
  first_seen?: string;
  /** 'MM-DD'：最近一次使用 */
  last_seen?: string;
}

export type WordCloudLayout = 'cloud' | 'rank' | 'time';
/** cloud=可点击词云  rank=热度排行  time=按出现时间排序（目标.md 要求可切换） */

/* ---- 再创作（目标.md：1. 生成表情包 2. ……） ---- */

export type RemixKind = 'sticker' | 'caption' | 'poster' | 'tucao' | 'summary_card';

export const REMIX_KIND_LABEL: Record<RemixKind, string> = {
  sticker: '表情包',
  caption: '配文图',
  poster: '群文化海报',
  tucao: '吐槽卡片',
  summary_card: '月度梗总结卡',
};

export interface MemeRemixJob extends Extensible {
  id: string;
  meme_id: string;
  kind: RemixKind;
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  /** 生成结果图 URL / dataURL；表情包为多张（多帧） */
  results: { url: string; label?: string }[];
  /** 生成用的 prompt，便于调试与「换一种风格」 */
  prompt?: string;
  /** 生成风格，前端提供可选项 */
  style?: string;
  created_at: string;
  error?: ApiError;
}

/* ========================================================================== *
 * 4. 功能二：群聊信息提取与通知总览（Inbox）
 * ========================================================================== */

export type NoticeCategory =
  | 'announcement' // 群公告
  | 'at_all' // @所有人
  | 'rollcall' // 接龙
  | 'vote' // 投票
  | 'signup' // 报名
  | 'payment' // 缴费
  | 'meeting' // 会议
  | 'activity' // 活动
  | 'deadline' // 截止日期
  | 'summary' // 普通聊天内容总结（目标.md 里的「聊天内容」）
  | 'other';

export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  announcement: '群公告',
  at_all: '@所有人',
  rollcall: '接龙',
  vote: '投票',
  signup: '报名',
  payment: '缴费',
  meeting: '会议',
  activity: '活动',
  deadline: '截止日期',
  summary: '内容摘要',
  other: '其他',
};

export type NoticePriority = 'urgent' | 'high' | 'normal' | 'low';
export const NOTICE_PRIORITY_LABEL: Record<NoticePriority, string> = {
  urgent: '紧急',
  high: '重要',
  normal: '普通',
  low: '低',
};

export type NoticeStatus = 'todo' | 'doing' | 'done' | 'ignored' | 'expired';
export const NOTICE_STATUS_LABEL: Record<NoticeStatus, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  ignored: '已忽略',
  expired: '已过期',
};

/** LLM 抽取出的关键要素（登记表：时间、地点、人物、事项、DDL） */
export interface NoticeEntities extends Extensible {
  /** 事项/主题 */
  subject?: string;
  /** 发生时间，ISO */
  event_time?: string;
  /** 截止时间 DDL，ISO —— 用于「到期不忘」 */
  deadline?: string;
  location?: string;
  /** 相关人物 */
  people?: string[];
  /** 金额等其它要素，键值对形式便于扩展 */
  [key: string]: unknown;
}

export interface NoticeItem extends Extensible {
  id: string;
  /** 卡片 heading 第一行：AI 一句话总结（目标.md 明确要求） */
  headline: string;
  /** 正文：AI 总结 */
  summary: string;
  /** 来源群 */
  chat: string;
  chat_username: string;
  category: NoticeCategory;
  priority: NoticePriority;
  status: NoticeStatus;
  /** 通知本身的发布时间（Unix 秒） */
  timestamp: number;
  /** 展示用时间，'MM-DD HH:mm'（wechat-cli 的口径） */
  time: string;
  /** 归属日期 'YYYY-MM-DD' —— 时间范围筛选按它比较，避免与展示格式耦合 */
  date: string;
  /** 所有群消息来源（目标.md：详情页要能看到全部来源） */
  sources: NoticeSource[];
  entities: NoticeEntities;
  /** 标签，用于关键词筛选 */
  tags: string[];
  /** 提醒设置，TODO(接口待定)：是否落到 wechat-cli / 系统日历 */
  remind_at?: string;
  reminded?: boolean;
  confidence?: number;
}

export interface NoticeSource extends Extensible {
  id: string;
  chat: string;
  sender: string;
  time: string;
  timestamp: number;
  text: string;
  type: ChatMessageType;
  message_id?: string;
}

/** Inbox 查询条件 —— 目标.md：时间筛选 / 关键词筛选 / 多群排序 */
export interface NoticeQuery {
  /** 多选群；空数组 = 全部群 */
  chats: string[];
  categories: NoticeCategory[];
  priorities: NoticePriority[];
  statuses: NoticeStatus[];
  /** 语义/关键词搜索 */
  keyword: string;
  /** 时间范围 */
  start?: string;
  end?: string;
  /** 排序维度 */
  sort: NoticeSortKey;
  /** 只看有 DDL 的 */
  only_with_deadline?: boolean;
}

export type NoticeSortKey = 'time_desc' | 'time_asc' | 'priority' | 'deadline';

export const NOTICE_SORT_LABEL: Record<NoticeSortKey, string> = {
  time_desc: '按时间倒序',
  time_asc: '按时间正序（时间轴）',
  priority: '按优先级',
  deadline: '按 DDL 紧急度',
};

/* ========================================================================== *
 * 5. 功能三：正向社交与反向社交（目标.md 该节尚未编写）
 * ========================================================================== */

/**
 * TODO(目标.md 未完成): 本节字段为「按登记表功能点二 + 占位」推导的草案，
 * 定稿后需要替换。占位不写死布局，只保证页面与卡片容器存在。
 *
 * 登记表口径：语言风格、情绪倾向、话题偏好、互动频率、表情使用、回复习惯
 *            → 性格展示卡片 + 趣味人格标签 + 契合度匹配
 */

export interface PersonalityProfile extends Extensible {
  id: string;
  /** 被分析对象（好友或群成员） */
  name: string;
  username: string;
  avatar?: string;
  /** 趣味人格标签，如「群内定海神针」「深夜废话诗人」 */
  persona_tags: string[];
  /** 一句话人设总结 */
  one_liner: string;
  /** 多维雷达图数据（0~100），维度可扩展 */
  dimensions: { key: string; label: string; score: number; comment?: string }[];
  /** 语言风格关键词 */
  style_keywords: string[];
  /** 高频表情 / 口癖 */
  catchphrases: string[];
  /** 统计 */
  stats: {
    message_count: number;
    /** 平均回复间隔（分钟） */
    avg_reply_minutes?: number;
    /** 最活跃时段 '22:00-24:00' */
    active_hours?: string;
    /** 主动开启话题占比 0~1 */
    initiator_ratio?: number;
    emoji_ratio?: number;
  };
  confidence?: number;
}

export type SocialMode = 'forward' | 'reverse';

/** 正向社交：找到同频的人（契合度匹配） */
export interface MatchResult extends Extensible {
  id: string;
  /** 匹配的两人 */
  a: { name: string; username: string };
  b: { name: string; username: string };
  /** 契合度 0~100 */
  score: number;
  /** 契合点，如「都爱在深夜聊技术」 */
  reasons: string[];
  /** 破冰建议 / 互动建议 */
  icebreakers: string[];
  /** 共同话题关键词 */
  shared_topics: string[];
}

/** 反向社交：避雷 / 沟通成本提示（占位，语义待定稿） */
export interface ReverseSignal extends Extensible {
  id: string;
  name: string;
  username: string;
  kind: 'low_response' | 'topic_mismatch' | 'style_clash' | 'cold_thread' | 'other';
  label: string;
  detail: string;
  /** 0~1，越高越需要注意 */
  severity: number;
  suggestion?: string;
}

/* ========================================================================== *
 * 6. 总览 / 全局状态
 * ========================================================================== */

export interface OverviewStats extends Extensible {
  /** 选中范围内消息总数 */
  total_messages: number;
  group_count: number;
  member_count: number;
  /** 提炼出的梗数量 */
  meme_count: number;
  /** 提取出的通知数量 */
  notice_count: number;
  /** 待办未完成数 */
  todo_count: number;
  /** 最近的 DDL */
  next_deadline?: { notice_id: string; headline: string; deadline: string; chat: string };
  /** 24 小时活跃分布（wechat-cli stats.hourly 原样透传） */
  hourly: Record<string, number>;
  /** 消息类型分布（wechat-cli stats.type_breakdown 原样透传） */
  type_breakdown: Record<string, number>;
  /** 发言排行榜（wechat-cli stats.top_senders） */
  top_senders: { name: string; count: number }[];
  /** 数据时间范围 */
  range: { start: string; end: string };
}

export interface AnalyzeRequest {
  chats: string[];
  start?: string;
  end?: string;
  /** 是否强制重新分析（忽略缓存） */
  force?: boolean;
}

export interface AnalyzeProgress {
  stage: 'reading' | 'segmenting' | 'extracting' | 'summarizing' | 'matching' | 'done' | 'failed';
  percent: number;
  message: string;
}
