/**
 * 适配层：契约线格式 ↔ 界面视图模型的换算（`api-contract.md` / `data-model.md` 的字段口径）。
 *
 * 为什么需要本层：`src/types.ts` 是给组件用的**本地化视图模型**（英文枚举、ISO 时间、展示字段），
 * 契约线格式是**中文枚举 + UTC epoch 毫秒 + 契约字段名**。组件只依赖 `@/api` 的方法签名，
 * 换算全部收在这里（组件零改动）。
 *
 * 轻量联表（展示名，不复制权威数据）：
 * - 群名：`/api/filter-options/groups`（一次拉取后缓存）；
 * - 成员昵称：`/api/members?ids=`（按需拉取后缓存）；
 * - 人物展示信息：来自「兴趣 → 人」结果（API-021）；
 * - 标签展示信息：来自画像（API-020）与配对（API-022）；
 * - 词云条目（梗名 / 类型）：来自词云（API-009）与「我相关」（API-013）。
 *
 * 降级口径（后端暂无数据源的字段）：按「可用则填、不可用则空 / 默认」处理，不伪造数据；
 * 缺口清单与后续接线说明见 `webui/README.md`。
 */

import type {
  CorrectionMark,
  DataSource,
  DeletePrecheck,
  DeleteResult,
  DeleteScope,
  ExtractItem,
  ExtractType,
  Group,
  InterestCategory,
  InterestPeopleResult,
  InterestTag,
  LifecycleView,
  MemberInterestHint,
  MessageDetail,
  MyCompatibility,
  PairMatch,
  PersonaPanel,
  PersonaTrait,
  PersonProfile,
  PersonalityTrait,
  SourceRef,
  UpdateResult,
  UpdateStatus,
} from '@/types';
import { INTEREST_CATEGORY_LABEL, MEME_TYPE_COLOR, MEME_TYPE_LABEL } from '@/types';

import { request } from './client';

// ---------------------------------------------------------------------------
// 基础换算
// ---------------------------------------------------------------------------

/** epoch 毫秒 → ISO 字符串（空值 → 空串，界面按空处理）。 */
export const iso = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : '';

/** 日期输入（`YYYY-MM-DD`）→ 当天零点 / 当天最后一毫秒的 epoch 毫秒。 */
export const dayStart = (value: string): number => new Date(`${value}T00:00:00`).getTime();
export const dayEnd = (value: string): number => new Date(`${value}T23:59:59.999`).getTime();

/** 距今人话（详设口径：`elapsed` 毫秒 → 「N 天前」；不足一天为「今天」）。 */
const sinceOf = (elapsedMs: number): string => {
  const days = Math.floor(Math.max(0, elapsedMs) / 86_400_000);
  return days <= 0 ? '今天' : `${days} 天前`;
};

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

// ---------------------------------------------------------------------------
// 枚举换算（契约中文 ↔ 界面英文）
// ---------------------------------------------------------------------------

const invert = <K extends string, V extends string>(map: Record<K, V>): Record<string, K> => {
  const next: Record<string, K> = {};
  for (const [key, value] of Object.entries(map) as Array<[K, V]>) next[value] = key;
  return next;
};

const MESSAGE_KIND = { 文字: 'text', 图片: 'image', 表情包: 'sticker' } as const;
const HEAT_STATE = { 活跃: 'active', 衰减中: 'fading', 已沉寂: 'silent' } as const;
const INGEST_SOURCE = { 群消息: 'group_messages', 通讯录与好友列表: 'contacts' } as const;
const INGEST_STATUS = { 成功: 'success', 失败: 'failed', 无授权: 'no_auth', 超时: 'timeout' } as const;
const PRIORITY = { 高: 'high', 中: 'medium', 低: 'low' } as const;
const PRIORITY_REVERSE = invert(PRIORITY);
const TODO_STATE = { 未处理: 'pending', 完成: 'done', 忽略: 'ignored' } as const;
const TODO_STATE_REVERSE = invert(TODO_STATE);
const DIMENSION = { 运动: 'sports', 艺术: 'art', 游戏: 'game', 娱乐: 'entertainment', 社交: 'social' } as const;
const DIMENSION_REVERSE = invert(DIMENSION);
const PERSONALITY = {
  领导式: 'leadership',
  活泼: 'lively',
  幽默: 'humorous',
  冷静: 'calm',
  理性: 'rational',
  判断: 'judgement',
} as const;
const PERSONALITY_REVERSE = invert(PERSONALITY);
const CORRECTION_REVERSE: Record<string, string> = { not_meme: '不是梗', not_interested: '不感兴趣', merged: '合并到其他梗', king_wrong: '梗王标注有误' };
const IDENTITY_STATUS = { 未确认: 'unconfirmed', 已确认: 'confirmed', 已否定: 'rejected' } as const;

const RECOGNITION: Record<string, ExtractType> = {
  群公告: 'announcement',
  '@所有人': 'at_all',
  接龙: 'relay',
  投票: 'vote',
  报名: 'signup',
  缴费: 'payment',
  会议: 'meeting',
  活动: 'activity',
  截止日期: 'deadline',
};

const enRecognition = (value: string): ExtractType => RECOGNITION[value] ?? 'other';
const enMemeKind = (value: string): 'catchphrase' | 'inner' | 'sticker' =>
  value === '口头禅' ? 'catchphrase' : value === '内部梗' ? 'inner' : 'sticker';

/** 界面英文维度 → 契约中文（用于写路径入参）。 */
export const zhDimension = (value: InterestCategory): string =>
  ({ sports: '运动', art: '艺术', game: '游戏', entertainment: '娱乐', social: '社交' })[value];
/** 契约中文维度 → 界面英文类别（与 `zhDimension` 互逆）。 */
export const dimensionOf = (value: string): InterestCategory =>
  (DIMENSION as Record<string, InterestCategory>)[value] ?? 'sports';
/** 界面英文性格六维 → 契约中文。 */
export const zhPersonality = (value: PersonalityTrait): string =>
  ({ leadership: '领导式', lively: '活泼', humorous: '幽默', calm: '冷静', rational: '理性', judgement: '判断' })[value];
export { CORRECTION_REVERSE, DIMENSION_REVERSE, MESSAGE_KIND, PERSONALITY_REVERSE, PRIORITY_REVERSE, TODO_STATE, TODO_STATE_REVERSE };

// ---------------------------------------------------------------------------
// 展示名缓存（联表；不复制权威数据）
// ---------------------------------------------------------------------------

let groupsPromise: Promise<Map<string, string>> | null = null;
const groupNames = new Map<string, string>();
const memberNames = new Map<string, { displayName: string; groupId: string }>();
const personInfo = new Map<string, { name: string; activity: number; replyMedianMs: number | null; unknown: boolean }>();
const tagInfo = new Map<string, { name: string; category: InterestCategory }>();
const personaTraitOf = new Map<string, PersonalityTrait>();
const cloudInfo = new Map<string, { name: string; type: 'catchphrase' | 'inner' | 'sticker'; mine: boolean }>();
const correctionOf = new Map<string, CorrectionMark>();

/** 性格标签缓存读取（删除 / 确认操作的维度定位）。 */
export const personaTraitFor = (traitId: string): PersonalityTrait | undefined => personaTraitOf.get(traitId);

/** 兴趣标签缓存读取（写路径的标签定位）。 */
export const tagInfoFor = (tagId: string): { name: string; category: InterestCategory } | undefined => tagInfo.get(tagId);

/** 改判结果写入缓存（`submitCorrection` 后重新取梗单元时生效）。 */
export const setCorrection = (memeId: string, mark: CorrectionMark): void => {
  correctionOf.set(memeId, mark);
};

/** 名单 / 图谱 / 评分卡结果写入人物缓存（配对、契合度等联表展示名用）。 */
export function rememberPeople(
  entries: readonly { personId: string; name: string; activity?: number; unknown?: boolean }[],
): void {
  for (const entry of entries) {
    const prev = personInfo.get(entry.personId);
    personInfo.set(entry.personId, {
      name: entry.name,
      activity: entry.activity ?? prev?.activity ?? 0,
      replyMedianMs: prev?.replyMedianMs ?? null,
      unknown: entry.unknown ?? prev?.unknown ?? false,
    });
  }
}

/** 评分卡 / 事件流结果写入兴趣标签缓存（写路径的标签定位用）。 */
export function rememberTags(entries: readonly { tagId: string; name: string; category: InterestCategory }[]): void {
  for (const entry of entries) tagInfo.set(entry.tagId, { name: entry.name, category: entry.category });
}

/** 群清单（一次拉取；失败不阻塞后续请求，展示名回落为标识）。 */
export function ensureGroups(): Promise<Map<string, string>> {
  if (groupsPromise === null) {
    groupsPromise = request<{ records: Array<{ groupId: string; groupName: string }> }>('GET', '/filter-options/groups', {
      query: [
        ['page', '1'],
        ['pageSize', '1000'],
      ],
    })
      .then((result) => {
        if (result.ok) for (const row of result.data.records) groupNames.set(row.groupId, row.groupName);
        return groupNames;
      })
      .catch(() => groupNames);
  }
  return groupsPromise;
}

export const groupNameOf = (groupId: string): string => groupNames.get(groupId) ?? groupId;

/** 成员目录（按需批量拉取；失败时回落为标识）。 */
export async function ensureMembers(ids: readonly string[]): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => id.length > 0 && !memberNames.has(id));
  if (missing.length === 0) return;
  const result = await request<{ members: Array<{ memberId: string; groupId: string; displayName: string }> }>('GET', '/members', {
    query: [['ids', missing.join(',')]],
  });
  if (result.ok) {
    for (const row of result.data.members) memberNames.set(row.memberId, { displayName: row.displayName, groupId: row.groupId });
    // 未命中的标识也落缓存（避免重复拉取），展示名回落为标识
    for (const id of missing) if (!memberNames.has(id)) memberNames.set(id, { displayName: id, groupId: '' });
  } else {
    for (const id of missing) memberNames.set(id, { displayName: id, groupId: '' });
  }
}

export const memberNameOf = (memberId: string): string => memberNames.get(memberId)?.displayName ?? memberId;

/** 人物展示信息（来自 API-021 结果；未见过则回落为标识）。 */
export const personNameOf = (personId: string): string => personInfo.get(personId)?.name ?? personId;

// ---------------------------------------------------------------------------
// 来源引用（REQ-007）：契约只给消息标识；其余展示字段在无逐条读取接口时留空
// ---------------------------------------------------------------------------

const refsOf = (messageIds: readonly string[]): SourceRef[] =>
  messageIds.map((messageId) => ({ messageId, groupId: '', groupName: '', senderName: '', sentAt: '', excerpt: '' }));

/** 媒体引用 → 可访问 URL（服务端 `/media/:ref` 按需解密）。 */
export const mediaUrlOf = (ref: string | null | undefined): string | undefined =>
  typeof ref === 'string' && ref.length > 0 ? `/media/${encodeURIComponent(ref)}` : undefined;

// ---------------------------------------------------------------------------
// 外壳与服务（API-001 / API-002 / API-004 / API-005 / API-006）
// ---------------------------------------------------------------------------

interface WireSourceStatus {
  source: string;
  status: string;
  at: number | null;
}
export function toUpdateStatus(wire: {
  hasData: boolean;
  updatedUntilX: number | null;
  sourceStatuses: WireSourceStatus[];
  meMemberId: string | null;
}): UpdateStatus {
  return {
    hasData: wire.hasData,
    updatedTo: iso(wire.updatedUntilX) || null,
    meId: wire.meMemberId,
    sources: wire.sourceStatuses.map((row) => ({
      source: (INGEST_SOURCE as Record<string, DataSource>)[row.source] ?? 'group_messages',
      status: (INGEST_STATUS as Record<string, 'success' | 'failed' | 'no_auth' | 'timeout'>)[row.status] ?? 'failed',
      ...(row.status === '成功' ? { lastSuccessAt: iso(row.at) } : {}),
    })),
  };
}

export function toUpdateResult(wire: {
  sources: Array<{
    source: string;
    status: string;
    written: number;
    failures: Array<{ reason: string }>;
    completedAt: number | null;
  }>;
}): UpdateResult {
  const times = wire.sources.map((row) => row.completedAt ?? 0).filter((value) => value > 0);
  return {
    results: wire.sources.map((row) => ({
      source: (INGEST_SOURCE as Record<string, DataSource>)[row.source] ?? 'group_messages',
      status: (INGEST_STATUS as Record<string, 'success' | 'failed' | 'no_auth' | 'timeout'>)[row.status] ?? 'failed',
      imported: row.written,
      ...(row.failures.length > 0
        ? { failed: row.failures.map((failure) => ({ message: failure.reason, count: 1 })) }
        : {}),
      ...(row.status !== '成功' && row.failures.length > 0 ? { failureReason: row.failures[0]?.reason } : {}),
    })),
    finishedAt: iso(times.length > 0 ? Math.max(...times) : Date.now()),
  };
}

/** 群清单 → 筛选条群多选项（并写入展示名缓存）。 */
/** 群展示名：源头未给名字（groupName 就是群 ID）时给出明确回退，而不是裸 ID。 */
const groupDisplayName = (groupId: string, groupName: string): string => {
  const cleaned = groupName.trim();
  if (cleaned.length > 0 && cleaned !== groupId) return cleaned;
  const short = groupId.split('@')[0] ?? groupId;
  return `未命名群聊（${short}）`;
};

export function toGroups(records: Array<{ groupId: string; groupName: string }>): Group[] {
  for (const row of records) groupNames.set(row.groupId, groupDisplayName(row.groupId, row.groupName));
  return records
    .map((row) => ({ id: row.groupId, name: groupDisplayName(row.groupId, row.groupName) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh'));
}

const ENTITY_LABEL: Record<string, string> = {
  'DM-002': '群',
  'DM-003': '原始消息记录',
  'DM-004': '群成员身份',
  'DM-005': '通讯录 / 好友列表记录',
  'DM-006': '梗及其派生结果',
  'DM-007': '梗出现记录',
  'DM-008': '梗变体关系',
  'DM-009': '梗精华消息',
  'DM-010': '提取条目',
  'DM-011': '人物',
  'DM-012': '身份对齐候选',
  'DM-013': '兴趣标签',
  'DM-014': '人物兴趣标签',
  'DM-015': '同义归并组',
  'DM-016': '性格标签',
  'DM-017': '消息互动记录',
  'DM-018': '两人契合度',
  'DM-019': '我的社交契合度',
  'DM-020': '生成历史',
  'DM-021': '候选梗单元',
  'DM-022': '素材合规确认',
};

const countsOf = (items: Array<{ entityType: string; count: number }>): DeletePrecheck['items'] =>
  items.map((row) => ({ entity: row.entityType, label: ENTITY_LABEL[row.entityType] ?? row.entityType, count: row.count }));

export async function toPrecheck(wire: { items: Array<{ entityType: string; count: number }> }, scope: DeleteScope): Promise<DeletePrecheck> {
  await ensureGroups();
  const items = countsOf(wire.items);
  return {
    scope,
    scopeLabel: scope.kind === 'all' ? '全部数据' : groupNameOf(scope.groupId),
    items,
    total: items.reduce((sum, item) => sum + item.count, 0),
  };
}

export function toDeletion(wire: { items: Array<{ entityType: string; count: number }> }): DeleteResult {
  return { items: countsOf(wire.items), undone: false };
}

// ---------------------------------------------------------------------------
// 模块一：梗分析（API-009 ~ API-013）
// ---------------------------------------------------------------------------

interface WireCloudTerm {
  memeId: string;
  name: string;
  frequency: number;
  occurrenceCount: number;
  kind: string;
  firstSeenAt: number;
  lastUsedAt: number;
}

const legendOf = (): Array<{ type: 'catchphrase' | 'inner' | 'sticker'; color: string; label: string }> =>
  (['catchphrase', 'inner', 'sticker'] as const).map((type) => ({
    type,
    color: MEME_TYPE_COLOR[type],
    label: MEME_TYPE_LABEL[type],
  }));

const rememberCloud = (terms: readonly WireCloudTerm[], mine = false): void => {
  for (const term of terms) cloudInfo.set(term.memeId, { name: term.name, type: enMemeKind(term.kind), mine });
};

export function toMemeCloud(wire: {
  terms: WireCloudTerm[];
  sourceMessageIds: string[];
}): { entries: ReturnType<typeof cloudEntries>[number][]; legend: ReturnType<typeof legendOf>; sourceRefs: SourceRef[] } {
  rememberCloud(wire.terms);
  return { entries: cloudEntries(wire.terms), legend: legendOf(), sourceRefs: refsOf(wire.sourceMessageIds) };
}

function cloudEntries(terms: readonly WireCloudTerm[]) {
  return terms.map((term) => ({
    memeId: term.memeId,
    name: term.name,
    frequency: term.frequency,
    occurrences: term.occurrenceCount,
    type: enMemeKind(term.kind),
    firstSeenAt: iso(term.firstSeenAt),
    lastUsedAt: iso(term.lastUsedAt),
    ...(cloudInfo.get(term.memeId)?.mine ? { mine: true } : {}),
  }));
}

export function toMineCloud(wire: { terms: WireCloudTerm[]; sourceMessageIds: string[] }) {
  rememberCloud(wire.terms, true);
  return { entries: cloudEntries(wire.terms), legend: legendOf(), sourceRefs: refsOf(wire.sourceMessageIds) };
}

interface WireCell {
  memeId: string;
  interpretation: string;
  firstSeenAt: number;
  firstSeenGroupId: string;
  lastUsedAt: number;
  elapsed: number;
  occurrenceCount: number;
  heat: string;
  weekOverWeek: number;
  monthlyCounts: Record<string, number>;
  lifecycle: { firstSeenAt: number; peakMonth: string; silentAt: number; activeDays: number };
  memeKing: Array<{ memberId: string; count: number; share: number }>;
  highlights: Array<{ messageId: string; kind: string; displayOrder: number }>;
  variantMemeIds: string[];
  sourceMessageIds: string[];
}

export async function toMemeUnit(wire: WireCell): Promise<import('@/types').MemeUnit> {
  const kingIds = wire.memeKing.map((row) => row.memberId);
  await Promise.all([ensureGroups(), ensureMembers(kingIds)]);
  const cached = cloudInfo.get(wire.memeId);
  const groupName = groupNameOf(wire.firstSeenGroupId);
  const monthly = Object.entries(wire.monthlyCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, count]) => ({ month, count, incomplete: false }));
  const members = wire.memeKing.map((row) => ({
    memberId: row.memberId,
    name: memberNameOf(row.memberId),
    count: row.count,
    ratio: row.share,
  }));
  return {
    memeId: wire.memeId,
    name: cached?.name ?? wire.memeId,
    type: cached?.type ?? 'catchphrase',
    groupId: wire.firstSeenGroupId,
    groupName,
    interpretation: wire.interpretation,
    firstSeenAt: iso(wire.firstSeenAt),
    firstSeenGroupName: groupName,
    lastUsedAt: iso(wire.lastUsedAt),
    sinceLastUse: sinceOf(wire.elapsed),
    occurrences: wire.occurrenceCount,
    weekOverWeek: wire.weekOverWeek,
    heatState: (HEAT_STATE as Record<string, 'active' | 'fading' | 'silent'>)[wire.heat] ?? 'active',
    monthly,
    lifecycle: {
      firstSeenAt: iso(wire.lifecycle.firstSeenAt),
      peakAt: wire.lifecycle.peakMonth,
      silentAt: iso(wire.lifecycle.silentAt),
      activeDays: wire.lifecycle.activeDays,
    },
    king: { members, topUsers: members.slice(0, 3).map(({ memberId, name, count }) => ({ memberId, name, count })) },
    highlights: wire.highlights.map((row) => ({
      messageId: row.messageId,
      senderName: '',
      sentAt: '',
      kind: (MESSAGE_KIND as Record<string, 'text' | 'image' | 'sticker'>)[row.kind] ?? 'text',
      groupId: wire.firstSeenGroupId,
      groupName,
    })),
    variants: wire.variantMemeIds.map((id) => ({ memeId: id, name: cloudInfo.get(id)?.name ?? id })),
    correction: correctionOf.get(wire.memeId) ?? 'none',
    sourceRefs: refsOf(wire.sourceMessageIds),
    mine: cached?.mine ?? false,
  };
}

export function toLifecycleView(wire: {
  rows: Array<{
    memeId: string;
    name: string;
    firstSeenAt: number;
    peakMonth: string;
    silentAt: number;
    activeDays: number;
    monthlyStrength: Record<string, number>;
  }>;
  leadingMemes: Array<{ month: string; memeIds: string[] }>;
}): LifecycleView {
  const rows = wire.rows.map((row) => {
    const months = Object.entries(row.monthlyStrength).sort(([left], [right]) => left.localeCompare(right));
    const max = Math.max(1, ...months.map(([, count]) => count));
    return {
      memeId: row.memeId,
      name: row.name,
      type: cloudInfo.get(row.memeId)?.type ?? 'catchphrase',
      firstSeenAt: iso(row.firstSeenAt),
      peakAt: row.peakMonth,
      silentAt: iso(row.silentAt),
      activeDays: row.activeDays,
      monthlyIntensity: months.map(([month, count]) => ({ month, intensity: count / max, count })),
    };
  });
  const byId = new Map(rows.map((row) => [row.memeId, row]));
  const monthlyLeaders = wire.leadingMemes.flatMap((group) =>
    group.memeIds.map((memeId) => ({
      month: group.month,
      memeId,
      name: byId.get(memeId)?.name ?? cloudInfo.get(memeId)?.name ?? memeId,
      count: byId.get(memeId)?.monthlyIntensity.find((item) => item.month === group.month)?.count ?? 0,
    })),
  );
  return { rows, monthlyLeaders, legend: legendOf() };
}

// ---------------------------------------------------------------------------
// 模块二：信息提取（API-014 ~ API-019）
// ---------------------------------------------------------------------------

interface WireExtractView {
  entryId: string;
  recognitionType: string;
  timeElement: number | null;
  locationElement: string | null;
  personElementMemberIds: string[] | null;
  subjectElement: string | null;
  deadline: number | null;
  groupId: string;
  time: number | null;
  topic: string;
  sourceMessageIds: string[];
}

function extractItemOf(view: WireExtractView): ExtractItem {
  return {
    id: view.entryId,
    type: enRecognition(view.recognitionType),
    elements: {
      ...(view.timeElement === null ? {} : { time: iso(view.timeElement) }),
      ...(view.locationElement === null ? {} : { location: view.locationElement }),
      ...(view.personElementMemberIds === null || view.personElementMemberIds.length === 0
        ? {}
        : { people: view.personElementMemberIds.map((memberId) => ({ memberId, name: memberNameOf(memberId) })) }),
      ...(view.subjectElement === null ? {} : { subject: view.subjectElement }),
      ...(view.deadline === null ? {} : { deadline: iso(view.deadline) }),
    },
    subject: view.topic,
    groupId: view.groupId,
    groupName: groupNameOf(view.groupId),
    sentAt: iso(view.time),
    // —— 契约 `API-014` 视图未含的展示字段：留空 / 默认（不伪造；详见 webui/README.md 的降级清单）
    summaryLine: '',
    aiSummary: '',
    priority: 'medium',
    todoState: 'pending',
    remindState: 'no_remind',
    sourceRefs: refsOf(view.sourceMessageIds),
  };
}

/** 完整记录（DM-010，如 `API-016` 回参）→ 条目视图。 */
interface WireExtractedItem extends WireExtractView {
  headline: string;
  aiSummary: string;
  priority: string;
  todoStatus: string;
  remindState: string;
}

export function fullExtractItemOf(item: WireExtractedItem): ExtractItem {
  return {
    ...extractItemOf(item),
    summaryLine: item.headline,
    aiSummary: item.aiSummary,
    priority: (PRIORITY as Record<string, 'high' | 'medium' | 'low'>)[item.priority] ?? 'medium',
    todoState: (TODO_STATE as Record<string, 'pending' | 'done' | 'ignored'>)[item.todoStatus] ?? 'pending',
    remindState: item.remindState === '待提醒' ? 'remind' : 'no_remind',
  };
}

export async function toExtractPage(wire: {
  items: WireExtractView[];
  pageInfo: { page: number; pageSize: number; total: number };
}): Promise<{ items: ExtractItem[]; page: number; pageSize: number; total: number }> {
  const memberIds = wire.items.flatMap((item) => item.personElementMemberIds ?? []);
  await Promise.all([ensureGroups(), ensureMembers(memberIds)]);
  return {
    items: wire.items.map(extractItemOf),
    page: wire.pageInfo.page,
    pageSize: wire.pageInfo.pageSize,
    total: wire.pageInfo.total,
  };
}

export async function toNoticeGroups(wire: {
  groups: Array<{
    key: string;
    label: string;
    notifications: Array<{
      entryId: string;
      groupId: string;
      recognitionType: string;
      priority: string;
      todoStatus: string;
      sourceMessageIds: string[];
    }>;
  }>;
}): Promise<Array<{ key: string; label: string; items: ExtractItem[] }>> {
  await ensureGroups();
  return wire.groups.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.notifications.map((row) => ({
      id: row.entryId,
      type: enRecognition(row.recognitionType),
      elements: {},
      subject: '',
      groupId: row.groupId,
      groupName: groupNameOf(row.groupId),
      sentAt: '',
      summaryLine: '',
      aiSummary: '',
      priority: (PRIORITY as Record<string, 'high' | 'medium' | 'low'>)[row.priority] ?? 'medium',
      todoState: (TODO_STATE as Record<string, 'pending' | 'done' | 'ignored'>)[row.todoStatus] ?? 'pending',
      remindState: 'no_remind',
      sourceRefs: refsOf(row.sourceMessageIds),
    })),
  }));
}

export async function toDueTodos(wire: {
  todos: Array<{ entryId: string; topic: string; groupId: string; deadline: number }>;
}): Promise<Array<{ id: string; subject: string; groupName: string; deadline: string }>> {
  await ensureGroups();
  return wire.todos.map((row) => ({
    id: row.entryId,
    subject: row.topic,
    groupName: groupNameOf(row.groupId),
    deadline: iso(row.deadline),
  }));
}

export async function toMessageDetail(
  wire: {
    heading: { headline: string; groupId: string; time: number | null };
    body: {
      aiSummary: string;
      sourceMessages: Array<{
        messageId: string;
        groupId: string;
        senderMemberId: string;
        sentAt: number;
        kind: string;
        text: string | null;
        mediaRef: string | null;
        mentionedMemberIds: string[] | null;
        quotedMessageId: string | null;
      }>;
    };
  },
  entryId: string,
): Promise<MessageDetail> {
  const senderIds = wire.body.sourceMessages.map((message) => message.senderMemberId);
  await Promise.all([ensureGroups(), ensureMembers(senderIds)]);
  return {
    id: entryId,
    heading: {
      summaryLine: wire.heading.headline,
      groupName: groupNameOf(wire.heading.groupId),
      sentAt: iso(wire.heading.time),
    },
    body: {
      aiSummary: wire.body.aiSummary,
      messages: wire.body.sourceMessages.map((message) => ({
        id: message.messageId,
        groupId: message.groupId,
        senderId: message.senderMemberId,
        senderName: memberNameOf(message.senderMemberId),
        sentAt: iso(message.sentAt),
        kind: (MESSAGE_KIND as Record<string, 'text' | 'image' | 'sticker'>)[message.kind] ?? 'text',
        ...(message.text === null ? {} : { text: message.text }),
        ...(mediaUrlOf(message.mediaRef) === undefined ? {} : { mediaUrl: mediaUrlOf(message.mediaRef) }),
        ...(message.mentionedMemberIds === null ? {} : { mentionedIds: message.mentionedMemberIds }),
        ...(message.quotedMessageId === null ? {} : { quotedMessageId: message.quotedMessageId }),
      })),
    },
  };
}

export async function toHints(wire: {
  hints: Array<{ memberId: string; tags: Array<{ name: string }> }>;
}): Promise<MemberInterestHint[]> {
  await ensureMembers(wire.hints.map((hint) => hint.memberId));
  return wire.hints.map((hint) => ({
    memberId: hint.memberId,
    memberName: memberNameOf(hint.memberId),
    interests: hint.tags.map((tag) => tag.name),
  }));
}

// ---------------------------------------------------------------------------
// 模块三：社交画像（API-020 ~ API-029）
// ---------------------------------------------------------------------------

interface WireProfileTag {
  tagId: string;
  name: string;
  dimension: string;
  confidence: number;
  evidenceMessageIds: string[];
}

interface WireProfile {
  secondaryTags: WireProfileTag[];
  dimensionScores: Record<string, number>;
  tagCloud: Array<{ tagId: string; name: string; weight: number }>;
  personalityTags: Array<{ tagId: string; dimension: string; score: number }>;
}

const categoryOf = (dimension: string): InterestCategory =>
  (DIMENSION as Record<string, InterestCategory>)[dimension] ?? 'social';

const traitOf = (dimension: string): PersonalityTrait =>
  (PERSONALITY as Record<string, PersonalityTrait>)[dimension] ?? 'calm';

function personalityTraitsOf(wire: WireProfile): PersonaTrait[] {
  return wire.personalityTags.map((tag) => {
    const trait = traitOf(tag.dimension);
    personaTraitOf.set(tag.tagId, trait);
    return { traitId: tag.tagId, trait, score: tag.score, status: 'confirmed' as const, origin: 'inferred' as const };
  });
}

export async function toPersonProfile(wire: WireProfile, personId: string): Promise<PersonProfile> {
  const dimensionById = new Map(wire.secondaryTags.map((tag) => [tag.tagId, tag.dimension]));
  const tags: InterestTag[] = wire.secondaryTags.map((tag) => {
    const category = categoryOf(tag.dimension);
    tagInfo.set(tag.tagId, { name: tag.name, category });
    return {
      tagId: tag.tagId,
      name: tag.name,
      category,
      confidence: tag.confidence,
      evidence: refsOf(tag.evidenceMessageIds),
      origin: 'extracted' as const,
    };
  });
  const cache = personInfo.get(personId);
  return {
    personId,
    name: cache?.name ?? personId,
    isMe: false,
    unknown: cache?.unknown ?? false,
    tags,
    categoryScores: {
      sports: num(wire.dimensionScores['运动']),
      art: num(wire.dimensionScores['艺术']),
      game: num(wire.dimensionScores['游戏']),
      entertainment: num(wire.dimensionScores['娱乐']),
      social: num(wire.dimensionScores['社交']),
    },
    personalCloud: wire.tagCloud.map((row) => ({
      name: row.name,
      confidence: row.weight,
      category: categoryOf(dimensionById.get(row.tagId) ?? ''),
    })),
    personality: personalityTraitsOf(wire),
    activity: cache?.activity ?? 0,
    ...(cache?.replyMedianMs === null || cache?.replyMedianMs === undefined
      ? {}
      : { replyMedianMinutes: Math.round(cache.replyMedianMs / 60_000) }),
    groups: [],
  };
}

/** 性格面板（降级口径：候选读取接口待后端提供 → `candidates` 为空；已确认从画像取数）。 */
export function toPersonaPanel(profile: PersonProfile): PersonaPanel {
  return {
    personId: profile.personId,
    personName: profile.name,
    candidates: [],
    confirmed: profile.personality,
  };
}

export function toInterestPeople(
  wire: { people: Array<{ personId: string; displayName: string; replyMedianMs: number | null; activity: number; unknown: boolean }> },
  entry: 'category' | 'tag',
  value: string,
): InterestPeopleResult {
  for (const row of wire.people) {
    personInfo.set(row.personId, { name: row.displayName, activity: row.activity, replyMedianMs: row.replyMedianMs, unknown: row.unknown });
  }
  return {
    entry,
    entryLabel: entry === 'category' ? INTEREST_CATEGORY_LABEL[value as InterestCategory] ?? value : value,
    people: wire.people.map((row) => ({
      personId: row.personId,
      name: row.displayName,
      confidence: 0,
      ...(row.replyMedianMs === null ? {} : { replyMedianMinutes: Math.round(row.replyMedianMs / 60_000) }),
      activity: row.activity,
      unknown: row.unknown,
      evidence: [],
    })),
  };
}

export function toPairMatch(wire: {
  personAId: string;
  personBId: string;
  commonTagIds: string[];
  fitScore: number;
  dimensionDiffs: Record<string, number>;
}): PairMatch {
  const diffOf = (category: InterestCategory): { a: number; b: number; diff: number } => {
    const zh = zhDimension(category);
    return { a: 0, b: 0, diff: num(wire.dimensionDiffs[zh]) };
  };
  return {
    personA: { personId: wire.personAId, name: personNameOf(wire.personAId) },
    personB: { personId: wire.personBId, name: personNameOf(wire.personBId) },
    sharedInterests: wire.commonTagIds.map((tagId) => ({
      tagId,
      name: tagInfo.get(tagId)?.name ?? tagId,
      category: tagInfo.get(tagId)?.category ?? 'social',
    })),
    compatibility: {
      total: wire.fitScore,
      factors: [
        { key: 'common', label: '共同爱好', value: wire.commonTagIds.length },
        { key: 'fit', label: '契合度加权', value: wire.fitScore },
      ],
    },
    categoryDiff: {
      sports: diffOf('sports'),
      art: diffOf('art'),
      game: diffOf('game'),
      entertainment: diffOf('entertainment'),
      social: diffOf('social'),
    },
  };
}

export function toMyCompatibility(wire: { pairs: Array<{ personId: string; score: number }>; overallFit: number | null }): MyCompatibility {
  return {
    perPerson: wire.pairs.map((row) => ({ personId: row.personId, name: personNameOf(row.personId), score: row.score, sharedCount: 0 })),
    integration: wire.overallFit ?? 0,
  };
}

export async function toAlignmentList(wire: {
  candidates: Array<{ candidateId: string; memberIds: string[]; source: string; status: string }>;
}): Promise<import('@/types').IdentityAlignmentCandidate[]> {
  const memberIds = wire.candidates.flatMap((candidate) => candidate.memberIds);
  await Promise.all([ensureGroups(), ensureMembers(memberIds)]);
  return wire.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    members: candidate.memberIds.map((memberId) => ({
      memberId,
      groupName: groupNameOf(memberNames.get(memberId)?.groupId ?? ''),
      displayName: memberNameOf(memberId),
    })),
    // 契约来源为「通讯录 / 好友列表」；界面 `DataSource` 只有「contacts」一档 → 归入之
    source: 'contacts' as DataSource,
    status: (IDENTITY_STATUS as Record<string, 'unconfirmed' | 'confirmed' | 'rejected'>)[candidate.status] ?? 'unconfirmed',
  }));
}

/** 写路径响应：状态回带（界面 `submitAlignment` 的回参形状）。 */
export const alignmentStatusOf = (wire: { status: string }): string =>
  (IDENTITY_STATUS as Record<string, string>)[wire.status] ?? 'unconfirmed';

export { enMemeKind, enRecognition, refsOf };
