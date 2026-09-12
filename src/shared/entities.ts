/**
 * 实体类型：`docs/design/data-model.md` 的 DM-001 ~ DM-022。
 *
 * 契约口径：
 * - **字段与可空性**照抄 data-model.md 的字段表；文档没定的字段一律不造（需要补时先在 docs 走变更流程）。
 * - **枚举取值**使用文档原文的中文词（如 类型 = '文字' | '图片' | '表情包'）；详见各枚举注释。
 * - 字段名用英文驼峰（实现约定）；注释里给出文档中的中文字段名。
 * - 时间统一为 UTC epoch 毫秒（mod-002 §5.2 存储口径）；「时长」同为毫秒数。
 * - `可空 = 否` 的字段在类型上必填；`可空（…）` 的字段为 `… | null`。
 * - 派生字段（来源 = 计算）也在实体类型内，由持有模块在写入前算好（写库后即权威值）。
 *
 * 模块设计里出现的英文枚举字面量（如 mod-005 的 'used' / 'participated'、mod-008 的 'groupImage' / 'hotMeme'）
 * **以本文件的取值为准**；模块可在自身目录内做一层到内部命名的映射。
 */

// ---------------------------------------------------------------------------
// 基础标量
// ---------------------------------------------------------------------------

/** 通用标识（消息 / 梗 / 成员 / 群 / 条目 / 标签……实现内为字符串，语义由字段决定）。 */
export type Id = string
/** 时间点：UTC epoch 毫秒（mod-002 §5.2）。 */
export type Timestamp = number
/** 时长：毫秒。 */
export type DurationMs = number
/** 月份：`YYYY-MM`（如 '2026-09'）。 */
export type Month = string
/** 媒体引用：应用数据目录内的相对路径（mod-002 §5.2；不接受绝对路径）。 */
export type MediaRef = string
/** 生成物引用：不透明标识（形如 `gen/<记录标识>/<变体序号>`；mod-008 §5）。 */
export type ArtifactRef = string
/** 素材引用：群内图片 / 成员头像 / 照片 / 原话等素材的引用（DM-022）。 */
export type MaterialRef = string

// ---------------------------------------------------------------------------
// 枚举（取值 = data-model.md 原文）
// ---------------------------------------------------------------------------

/** DM-001 采集来源：群消息 / 通讯录与好友列表（各一条）。 */
export const INGEST_SOURCES = ['群消息', '通讯录与好友列表'] as const
export type IngestSource = (typeof INGEST_SOURCES)[number]

/** DM-001 状态：成功 / 失败 / 无授权 / 超时（REQ-016）。 */
export const INGEST_SOURCE_STATUSES = ['成功', '失败', '无授权', '超时'] as const
export type IngestSourceStatus = (typeof INGEST_SOURCE_STATUSES)[number]

/** DM-003 消息类型：文字 / 图片 / 表情包（默认「文字」）。 */
export const MESSAGE_KINDS = ['文字', '图片', '表情包'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

/** DM-005 来源：通讯录 / 好友列表。 */
export const CONTACT_SOURCES = ['通讯录', '好友列表'] as const
export type ContactSource = (typeof CONTACT_SOURCES)[number]

/** DM-006 类型：口头禅 / 内部梗 / 表情包梗（≤ 3 类，REQ-020）。 */
export const MEME_KINDS = ['口头禅', '内部梗', '表情包梗'] as const
export type MemeKind = (typeof MEME_KINDS)[number]

/** DM-006 纠正标记：无 / 不是梗 / 不感兴趣 / 已合并至 / 梗王标注有误（REQ-035；默认「无」）。 */
export const MEME_CORRECTIONS = ['无', '不是梗', '不感兴趣', '已合并至', '梗王标注有误'] as const
export type MemeCorrection = (typeof MEME_CORRECTIONS)[number]

/** DM-006 热度状态：活跃（≤7 天）/ 衰减中（8–30 天）/ 已沉寂（>30 天）。 */
export const MEME_HEATS = ['活跃', '衰减中', '已沉寂'] as const
export type MemeHeat = (typeof MEME_HEATS)[number]

/** DM-008 关系状态：生效 / 已失效（默认「生效」）。 */
export const VARIANT_LINK_STATUSES = ['生效', '已失效'] as const
export type VariantLinkStatus = (typeof VARIANT_LINK_STATUSES)[number]

/** DM-010 识别类型基线九类（可扩展；扩展项直接使用新中文词，不新增 DM 字段）。 */
export const KNOWN_RECOGNITION_TYPES = [
  '群公告',
  '@所有人',
  '接龙',
  '投票',
  '报名',
  '缴费',
  '会议',
  '活动',
  '截止日期',
] as const
/**
 * DM-010 识别类型：至少覆盖基线九类、**可扩展**（阶段 4 提问 4/10 裁定）。
 * `(string & {})` 保留字面量提示，同时允许后续新增中文类别。
 */
export type RecognitionType = (typeof KNOWN_RECOGNITION_TYPES)[number] | (string & {})

/** DM-010 优先级：高 / 中 / 低（三档闭集；默认「中」）。 */
export const PRIORITIES = ['高', '中', '低'] as const
export type Priority = (typeof PRIORITIES)[number]

/** DM-010 待办状态：未处理 / 完成 / 忽略（默认「未处理」）。 */
export const TODO_STATUSES = ['未处理', '完成', '忽略'] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]

/** DM-010 提醒状态：待提醒 / 不提醒（计算：未处理且距 DDL ≤1 天；默认「不提醒」）。 */
export const REMIND_STATES = ['待提醒', '不提醒'] as const
export type RemindState = (typeof REMIND_STATES)[number]

/** DM-011 / DM-013 一级维度：运动 / 艺术 / 游戏 / 娱乐 / 社交（固定五类，不增不减）。 */
export const DIMENSIONS = ['运动', '艺术', '游戏', '娱乐', '社交'] as const
export type Dimension = (typeof DIMENSIONS)[number]

/** DM-011 / DM-016 性格六维闭集：领导式 / 活泼 / 幽默 / 冷静 / 理性 / 判断。 */
export const PERSONALITY_DIMENSIONS = ['领导式', '活泼', '幽默', '冷静', '理性', '判断'] as const
export type PersonalityDimension = (typeof PERSONALITY_DIMENSIONS)[number]

/** DM-012 状态：未确认 / 已确认 / 已否定（默认「未确认」；未确认与已否定均不生效）。 */
export const IDENTITY_CANDIDATE_STATUSES = ['未确认', '已确认', '已否定'] as const
export type IdentityCandidateStatus = (typeof IDENTITY_CANDIDATE_STATUSES)[number]

/** DM-014 来源方式：模型抽取 / 同义归并 / 人工增改（默认「模型抽取」）。 */
export const TAG_ORIGINS = ['模型抽取', '同义归并', '人工增改'] as const
export type TagOrigin = (typeof TAG_ORIGINS)[number]

/** DM-016 状态：候选 / 已确认（默认「候选」；未确认候选不得出现在任何产物与视图）。 */
export const PERSONALITY_TAG_STATUSES = ['候选', '已确认'] as const
export type PersonalityTagStatus = (typeof PERSONALITY_TAG_STATUSES)[number]

/** DM-016 来源方式：模型推断 / 人工增改（默认「模型推断」）。 */
export const PERSONALITY_TAG_ORIGINS = ['模型推断', '人工增改'] as const
export type PersonalityTagOrigin = (typeof PERSONALITY_TAG_ORIGINS)[number]

/** DM-017 互动类型：@ 提及 / 引用回复 / 紧随接话。 */
export const INTERACTION_KINDS = ['@提及', '引用回复', '紧随接话'] as const
export type InteractionKind = (typeof INTERACTION_KINDS)[number]

/** DM-020 生成类型：G1 表情包 / G2 文字变体 / G3 新梗候选。 */
export const GENERATION_KINDS = ['G1', 'G2', 'G3'] as const
export type GenerationKind = (typeof GENERATION_KINDS)[number]

/** DM-020 素材档位：参考群内图片 / 改编热门表情包 / 纯模板生成（三档单选其一，不可多选）。 */
export const MATERIAL_TIERS = ['参考群内图片', '改编热门表情包', '纯模板生成'] as const
export type MaterialTier = (typeof MATERIAL_TIERS)[number]

/** DM-021 状态：候选 / 已确认入库 / 已废弃（默认「候选」；确认前不进入词云等视图）。 */
export const MEME_CANDIDATE_STATUSES = ['候选', '已确认入库', '已废弃'] as const
export type MemeCandidateStatus = (typeof MEME_CANDIDATE_STATUSES)[number]

/** DM-022 确认状态：未确认 / 已确认（默认「未确认」；未确认时 G1 生成被拒）。 */
export const MATERIAL_CONSENT_STATUSES = ['未确认', '已确认'] as const
export type MaterialConsentStatus = (typeof MATERIAL_CONSENT_STATUSES)[number]

// ---------------------------------------------------------------------------
// 组合结构（DM 字段中「结构 / 数值序列」的落点）
// ---------------------------------------------------------------------------

/** 月度分布：月 → 出现次数（DM-006）。 */
export type MonthlyCounts = Record<Month, number>

/** 一级维度分：五轴数值（DM-011 / DM-013 / DM-018）。 */
export type DimensionScores = Record<Dimension, number>

/** 性格维度分：六维数值（DM-011）。 */
export type PersonalityScores = Record<PersonalityDimension, number>

/** 逐维度差值：五轴差值（DM-018）。 */
export type DimensionDiffs = Record<Dimension, number>

/** DM-006 生命周期结构：首现 / 峰值（出现最多的月份）/ 沉寂点（最近一次出现）/ 活跃天数（自然日跨度）。 */
export interface MemeLifecycle {
  firstSeenAt: Timestamp
  peakMonth: Month
  silentAt: Timestamp
  activeDays: number
}

/** DM-006 梗王条目：成员 + 次数 + 占比（并列时全部列出）。 */
export interface MemeKingEntry {
  memberId: Id
  count: number
  /** 占比 = 该成员次数 ÷ 累计出现次数 */
  share: number
}

/** DM-013 事件流点：时间点 → 强度（不参与任何权重计算，REQ-087）。 */
export interface InterestEventPoint {
  at: Timestamp
  strength: number
}

// ---------------------------------------------------------------------------
// DM-001 ~ DM-022
// ---------------------------------------------------------------------------

/** DM-001 采集来源状态（MOD-001）：按来源记录采集 / 导入状态；派生「记录更新至 X」与「是否有数据」。 */
export interface CollectSourceStatus {
  /** 采集来源（实体身份；两个来源各一条） */
  source: IngestSource
  status: IngestSourceStatus
  /** 最近成功时间（从未成功时为空）；仅群消息来源推进「记录更新至 X」 */
  lastSuccessAt: Timestamp | null
  /** 失败原因（成功时为空；无授权 / 超时必须给出原因） */
  failureReason: string | null
  /** 记录更新至 X（计算）= 群消息来源的最近成功时间 */
  updatedUntilX: Timestamp | null
  /** 是否有数据（计算）= 群消息来源存在至少一条 DM-003 记录 */
  hasData: boolean
}

/** DM-002 群（MOD-002）：群标识与群名；群多选筛选与按群删除的单位。 */
export interface Group {
  groupId: Id
  groupName: string
}

/** DM-003 原始消息记录（MOD-002）：全部结论的来源事实；可回跳原文的终点。 */
export interface RawMessage {
  /** 消息标识（记录身份键；重复写入按身份去重） */
  messageId: Id
  groupId: Id
  /** 发送者（→ DM-004） */
  senderMemberId: Id
  /** 发送时间（全部时间口径的基准） */
  sentAt: Timestamp
  /** 类型（默认「文字」）；九类系统 / 活动消息记为 DM-010 的识别类型，不进入本字段 */
  kind: MessageKind
  /** 文本内容（图片 / 表情包消息为空） */
  text: string | null
  /** 媒体引用（图片 / 表情包素材；文字消息为空） */
  mediaRef: MediaRef | null
  /** 提及成员（→ DM-004；无提及为空） */
  mentionedMemberIds: Id[] | null
  /** 引用消息（→ DM-003；非引用回复为空） */
  quotedMessageId: Id | null
}

/** DM-004 群成员身份（MOD-002）：群内身份（群昵称 / 群名片、Me 标识）；跨群合并的入口。 */
export interface GroupMember {
  /** 成员标识（群内唯一；记录身份键 = 所属群 + 成员标识） */
  memberId: Id
  groupId: Id
  /** 群昵称 / 群名片 */
  displayName: string
  /** 是否「我」（Me 标识；全库至多一条为真，默认 false） */
  isMe: boolean
  /** 归属的人（→ DM-011；默认指向仅含本成员的人，存在已确认映射时按映射合并） */
  personId: Id
}

/** DM-005 通讯录 / 好友列表记录（MOD-002）：仅用于生成身份对齐候选。 */
export interface ContactRecord {
  contactId: Id
  displayName: string
  source: ContactSource
}

/** DM-006 梗（MOD-005）：梗单元主体与全部派生指标（一个梗只属一个群）。 */
export interface Meme {
  memeId: Id
  groupId: Id
  /** 梗名（词云字号载体；关键词匹配对象之一） */
  name: string
  kind: MemeKind
  /** 解读：一句话覆盖「什么意思、从哪来、现在怎么用」 */
  interpretation: string
  /** 纠正标记（默认「无」；改判立即影响后续结果） */
  correction: MemeCorrection
  /** 合并目标（→ DM-006；仅「合并到其他梗」时非空） */
  mergedIntoId: Id | null
  /** 来源候选（→ DM-021；非 G3 入库为空） */
  sourceCandidateId: Id | null
  firstSeenAt: Timestamp
  firstSeenGroupId: Id
  lastUsedAt: Timestamp
  /** 距今 = 当前时间 − 最近调用时间 */
  elapsed: DurationMs
  /** 累计出现次数（= 出现记录条数） */
  occurrenceCount: number
  /** 周环比：最近 7 天对上一 7 天的出现次数环比 */
  weekOverWeek: number
  heat: MemeHeat
  monthlyCounts: MonthlyCounts
  lifecycle: MemeLifecycle
  /** 梗王 / 主要使用者（并列时全部列出） */
  memeKing: MemeKingEntry[]
}

/** DM-007 梗出现记录（MOD-005）：梗 ↔ 来源消息的关联；全部梗统计的基础数据。 */
export interface MemeOccurrence {
  /** 记录标识（记录身份键；重复写入按身份去重） */
  occurrenceId: Id
  memeId: Id
  /** 来源消息（→ DM-003；必须可回跳原文） */
  sourceMessageId: Id
  /** 出现时间 = 来源消息的发送时间 */
  occurredAt: Timestamp
  /** 发言成员（→ DM-004；= 来源消息的发送者） */
  speakerMemberId: Id
  /** 是否「我相关」= 发送者为「我」，或来源消息的提及成员含「我」 */
  mineRelated: boolean
}

/** DM-008 梗变体关系（MOD-005）：衍生说法之间的关系与切换。 */
export interface MemeVariantLink {
  /** 源梗（→ DM-006） */
  sourceMemeId: Id
  /** 衍生梗（→ DM-006；与源梗同属一个群） */
  derivedMemeId: Id
  status: VariantLinkStatus
}

/** DM-009 梗精华消息（MOD-005）：每梗默认 3 条代表性消息。 */
export interface MemeHighlight {
  memeId: Id
  /** 来源消息（→ DM-003；文字 / 图片 / 表情包均支持） */
  sourceMessageId: Id
  /** 展示序号（决定展示顺序；默认展示序号最小的 3 条） */
  displayOrder: number
}

/** DM-010 提取条目（MOD-006）：识别类型 + 要素 + 来源消息；通知总览 / 待办 / 时间轴 / 详情的主体。 */
export interface ExtractedItem {
  /** 条目标识（记录身份键） */
  entryId: Id
  recognitionType: RecognitionType
  /** 时间要素（未提取到为空） */
  timeElement: Timestamp | null
  /** 地点要素（未提取到为空） */
  locationElement: string | null
  /** 人物要素（→ DM-004；未提取到为空） */
  personElementMemberIds: Id[] | null
  /** 事项要素（未提取到为空） */
  subjectElement: string | null
  /** DDL（无截止日期为空；到期提醒的计算基准） */
  deadline: Timestamp | null
  /** 来源群（→ DM-002） */
  groupId: Id
  /** 来源消息（→ DM-003；详情正文必须含全部来源消息） */
  sourceMessageIds: Id[]
  /** 一句话总结（详情 heading） */
  headline: string
  /** AI 总结（详情正文；关键词匹配对象之一） */
  aiSummary: string
  /** 主题（由聚类命名、可改，改后立即生效） */
  topic: string
  /** 优先级（默认「中」） */
  priority: Priority
  /** 待办状态（默认「未处理」） */
  todoStatus: TodoStatus
  /** 提醒状态（默认「不提醒」；= 未处理且距 DDL ≤ 1 天） */
  remindState: RemindState
}

/** DM-011 人（MOD-007）：跨群合并单位；承载活跃度、回复时长与维度分。 */
export interface Person {
  personId: Id
  /** 群成员身份（→ DM-004；经已确认映射合并进来的全部群成员） */
  memberIds: Id[]
  /** 是否「我」（= 包含带 Me 标识的群成员；全库至多一人为真） */
  isMe: boolean
  /** 未知标记（发言不足、不足以推断兴趣时为真；不做推测，仍列出） */
  unknown: boolean
  /** 活跃度（跨全部已采集群合并到人；在契合度中只计一次） */
  activity: number
  /** 回复时长（中位数；无可统计样本时为空） */
  replyMedianMs: DurationMs | null
  /** 一级维度分（每个维度 = 该维度下全部二级标签置信度之和） */
  dimensionScores: DimensionScores
  /** 性格维度分（只统计状态为「已确认」的性格标签） */
  personalityScores: PersonalityScores
}

/** DM-012 身份对齐候选映射（MOD-007）：跨群候选映射与确认 / 否定状态。 */
export interface IdentityCandidate {
  candidateId: Id
  /** 候选来源（→ DM-005） */
  sourceContactId: Id
  /** 涉及群成员（→ DM-004；两个及以上） */
  memberIds: Id[]
  status: IdentityCandidateStatus
  /** 确认时间（未确认 / 已否认为空） */
  confirmedAt: Timestamp | null
}

/** DM-013 兴趣标签（MOD-007）：二级标签本体（一级五类）、热度分与事件流。 */
export interface InterestTag {
  tagId: Id
  name: string
  dimension: Dimension
  /** 归并组（→ DM-015；未归并时为空） */
  mergeGroupId: Id | null
  /** 首现时间 = 该标签下最早的证据消息发送时间 */
  firstSeenAt: Timestamp
  /** 事件流（时间点 → 强度；不参与任何权重计算） */
  eventStream: InterestEventPoint[]
  /** 兴趣热度分 */
  heatScore: number
}

/** DM-014 人物兴趣标签（MOD-007）：人 ↔ 兴趣双向索引的唯一数据（含置信度与证据）。 */
export interface PersonInterestTag {
  /** 人物（→ DM-011） */
  personId: Id
  /** 兴趣标签（→ DM-013） */
  tagId: Id
  /** 置信度（用于维度分求和与契合度加权） */
  confidence: number
  /** 证据（→ DM-003；每条标签必须附带证据消息） */
  evidenceMessageIds: Id[]
  /** 来源方式（默认「模型抽取」） */
  origin: TagOrigin
}

/** DM-015 同义标签归并组（MOD-007）：同义二级标签归并为同一条。 */
export interface TagMergeGroup {
  mergeGroupId: Id
  /** 代表标签（→ DM-013；归并后对外呈现的标签） */
  representativeTagId: Id
  /** 已归入标签（→ DM-013） */
  mergedTagIds: Id[]
}

/** DM-016 性格标签（MOD-007）：六维闭集性格标签与分数、确认状态。 */
export interface PersonalityTag {
  tagId: Id
  /** 人物（→ DM-011） */
  personId: Id
  dimension: PersonalityDimension
  /** 分数（仅使用者本人可见，无对外通道） */
  score: number
  /** 状态（默认「候选」；未确认候选不得出现在任何产物与视图） */
  status: PersonalityTagStatus
  /** 来源方式（默认「模型推断」） */
  origin: PersonalityTagOrigin
}

/** DM-017 消息互动记录（MOD-007）：回复时长与「实际互动」的基础数据。 */
export interface InteractionRecord {
  interactionId: Id
  /** 触发消息（→ DM-003；被 @ 或被接话的原消息） */
  triggerMessageId: Id
  /** 触发成员（→ DM-004；原消息的发送者） */
  triggerMemberId: Id
  /** 响应消息（→ DM-003；首条符合条件的回复） */
  responseMessageId: Id
  /** 响应成员（→ DM-004；回复方） */
  responseMemberId: Id
  kind: InteractionKind
  /** 间隔时长 = 响应消息发送时间 − 触发消息发送时间（跨天与纯表情回复不纳入统计） */
  intervalMs: DurationMs
}

/** DM-018 两人契合度（MOD-007）：共同爱好 + 契合度 + 逐维度差值。 */
export interface PairScore {
  /** 配对标识（两人组合，无序对；规范化为 人A < 人B） */
  pairId: Id
  /** 人 A / 人 B（→ DM-011 ×2；两个不同的人） */
  personAId: Id
  personBId: Id
  /** 共同爱好（→ DM-013） */
  commonTagIds: Id[]
  /** 契合度分（因子 = 共同标签数量 + 置信度加权 + 实际互动 + 活跃度（只计一次）；不做时效衰减） */
  fitScore: number
  /** 逐维度差值（五轴差值，用于雷达叠加对比） */
  dimensionDiffs: DimensionDiffs
}

/** DM-019 我的社交契合度（MOD-007）：逐人契合度列表 + 整体融入度。 */
export interface MySocialFit {
  /** 逐人契合度（→ DM-018；「我」与每个群友的配对结果） */
  pairIds: Id[]
  /** 整体融入度（单一分数；无可统计对象时为空） */
  overallFit: number | null
}

/** DM-020 生成历史（MOD-008）：生成结果留存（可回看与再次下载）。 */
export interface GenerationRecord {
  /** 记录标识（记录身份键） */
  generationId: Id
  kind: GenerationKind
  /** 梗引用（→ DM-006；G3 由候选入库后回填，非 G1 / G2 时为空的字段见各字段说明） */
  memeId: Id | null
  /** 素材档位（非 G1 为空） */
  materialTier: MaterialTier | null
  /** 模板（非 G1 为空；G1 记录「模板 + 版本」） */
  template: string | null
  /** 产出引用（4 张变体图 / 5 条文字 / 候选） */
  outputRefs: ArtifactRef[]
  /** 创作标注（固定标识，恒为 true；REQ-013） */
  creationMark: true
  /** 生成时间（历史列表排序） */
  generatedAt: Timestamp
}

/** DM-021 候选梗单元（MOD-008）：新梗候选（确认前不生效）。 */
export interface MemeCandidate {
  candidateId: Id
  /** 含义推测 */
  meaningGuess: string
  /** 出处消息（→ DM-003） */
  sourceMessageIds: Id[]
  /** 使用示例 */
  usageExample: string
  /** 状态（默认「候选」；确认前不进入词云等视图） */
  status: MemeCandidateStatus
  /** 入库梗（→ DM-006；未确认为空） */
  memeId: Id | null
}

/** DM-022 素材合规确认（MOD-008）：成员素材的确认状态。 */
export interface MaterialConsent {
  consentId: Id
  /** 素材引用（群内图片 / 成员头像 / 照片 / 原话） */
  materialRef: MaterialRef
  /** 涉及成员（→ DM-004；使用成员素材必须经确认） */
  memberIds: Id[]
  /** 确认状态（默认「未确认」） */
  status: MaterialConsentStatus
  /** 确认时间（未确认为空） */
  confirmedAt: Timestamp | null
}

// ---------------------------------------------------------------------------
// 实体类型枚举（API-003 / API-004 的「实体类型」取值；
// 详见 docs/design/api-contract.md API-003 / API-004「取值集合见 data-model.md」）
// ---------------------------------------------------------------------------

/** 实体类型 → 记录类型映射（DM-001 ~ DM-022）。 */
export interface EntityTypeMap {
  'DM-001': CollectSourceStatus
  'DM-002': Group
  'DM-003': RawMessage
  'DM-004': GroupMember
  'DM-005': ContactRecord
  'DM-006': Meme
  'DM-007': MemeOccurrence
  'DM-008': MemeVariantLink
  'DM-009': MemeHighlight
  'DM-010': ExtractedItem
  'DM-011': Person
  'DM-012': IdentityCandidate
  'DM-013': InterestTag
  'DM-014': PersonInterestTag
  'DM-015': TagMergeGroup
  'DM-016': PersonalityTag
  'DM-017': InteractionRecord
  'DM-018': PairScore
  'DM-019': MySocialFit
  'DM-020': GenerationRecord
  'DM-021': MemeCandidate
  'DM-022': MaterialConsent
}

/** 实体类型（= DM 编号）。 */
export type EntityType = keyof EntityTypeMap

/** 全部实体类型（顺序 = DM-001 ~ DM-022，长度恒为 22）。 */
export const ENTITY_TYPES: readonly EntityType[] = [
  'DM-001',
  'DM-002',
  'DM-003',
  'DM-004',
  'DM-005',
  'DM-006',
  'DM-007',
  'DM-008',
  'DM-009',
  'DM-010',
  'DM-011',
  'DM-012',
  'DM-013',
  'DM-014',
  'DM-015',
  'DM-016',
  'DM-017',
  'DM-018',
  'DM-019',
  'DM-020',
  'DM-021',
  'DM-022',
]

/** 按实体类型取记录类型：`EntityRecord<'DM-006'>` = `Meme`。 */
export type EntityRecord<T extends EntityType = EntityType> = EntityTypeMap[T]

/** 未特指实体类型的记录（mod-005 / mod-008 设计里使用的 `RecordDTO` 等价写法）。 */
export type RecordDTO = EntityRecord<EntityType>
