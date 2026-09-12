/**
 * 数据接入层 —— 组件与后端之间的唯一接缝（34 条 `API-###` 的调用点）。
 * =============================================================================
 * 组件只依赖本文件的方法签名（组件零改动）；本文件负责：
 *   · 路径与查询参数（mod-004 §4.1 / §4.2 口径）；
 *   · 信封与错误标识归一（`client.ts`：成功 `{data}` / 失败 `{error}` → `ApiEnvelope`）；
 *   · 契约线格式 ↔ 界面视图模型的换算（`map.ts`）。
 *
 * 数据源一律为**本机服务进程的 HTTP 接口**（HLD §1：浏览器只经本机 HTTP 取数）；
 * 开发期替身（fixtures / mock）已按 REQ-019 删除，本文件不再有演示数据模式。
 *
 * 降级清单（后端暂无数据面的入口，返回明确错误而不是伪造数据；见 webui/README.md）：
 *   · 生成 G1 ~ G3（依赖 MOD-008 编排层）与生成历史 / 素材确认清单；
 *   · 性格面板的「候选」区（后端无候选读取接口；已确认标签从画像取数）。
 * 展示类视图（人-人图谱 / 事件流 / 评分卡 / 人的名单）由本机外壳的展示组装路由
 * （非契约接口）供数；错误一律按 `api-contract.md` §1.2 的稳定标识返回
 * （不静默失败 —— REQ-016）。
 */
import {
  type ApiEnvelope,
  type DataFlowNotice,
  type DeletePrecheck,
  type DeleteResult,
  type DeleteScope,
  type ExtractItem,
  type GatheringSuggestion,
  type GenerationHistoryItem,
  type GlobalFilter,
  type Group,
  type IdentityAlignmentCandidate,
  type InterestCategory,
  type InterestEventStream,
  type InterestPeopleResult,
  type InterestScoreCard,
  type LifecycleView,
  type MaterialConsent,
  type MaterialTier,
  type MemeCloudResult,
  type MemeContext,
  type MemeUnit,
  type MemberInterestHint,
  type MessageDetail,
  type MyCompatibility,
  type NewMemeCandidate,
  type NoticeDimension,
  type PairMatch,
  type Paged,
  type PersonProfile,
  type PersonaPanel,
  type PersonalityTrait,
  type Priority,
  type RelationGraph,
  type StickerGeneration,
  type TextVariantGeneration,
  type TodoState,
  type UpdateResult,
  type UpdateStatus,
} from '@/types';
import { queryOf, request } from './client';
import {
  alignmentStatusOf,
  CORRECTION_REVERSE,
  dayEnd,
  dayStart,
  DIMENSION_REVERSE,
  dimensionOf,
  ensureGroups,
  ensureMembers,
  fullExtractItemOf,
  iso,
  personNameOf,
  personaTraitFor,
  PRIORITY_REVERSE,
  rememberPeople,
  rememberTags,
  setCorrection,
  tagInfoFor,
  TODO_STATE,
  TODO_STATE_REVERSE,
  toAlignmentList,
  toDeletion,
  toDueTodos,
  toExtractPage,
  toGroups,
  toHints,
  toInterestPeople,
  toLifecycleView,
  toMemeCloud,
  toMemeUnit,
  toMessageDetail,
  toMineCloud,
  toMyCompatibility,
  toNoticeGroups,
  toPairMatch,
  toPersonaPanel,
  toPersonProfile,
  toPrecheck,
  toUpdateResult,
  toUpdateStatus,
  zhDimension,
  zhPersonality,
} from './map';

/** 未接线 / 无后端数据源的入口：返回明确错误（不伪造数据；缺口清单见 webui/README.md）。 */
const notWired = <T,>(feature: string): ApiEnvelope<T> => ({
  ok: false,
  data: null,
  error: {
    code: 'SOURCE_UNAVAILABLE',
    message: `「${feature}」尚未接线（后端后续版本提供）。`,
    hint: '不影响其余功能；缺口与进度见 webui/README.md。',
  },
});

/** 入参不合法（写路径的前置校验；与服务端守卫口径一致）。 */
const invalid = (message: string, hint?: string): ApiEnvelope<never> => ({
  ok: false,
  data: null,
  error: { code: 'INVALID_INPUT', message, ...(hint === undefined ? {} : { hint }) },
});

/** 展示组装路由的线格式（外壳非契约接口）。 */
interface WireEventStreams {
  streams: Array<{
    tagId: string;
    name: string;
    dimension: string;
    firstSeenAt: number;
    events: Array<{ at: number; intensity: number }>;
  }>;
}

interface WireScoreCards {
  cards: Array<{
    tagId: string;
    name: string;
    dimension: string;
    heat: number;
    peopleCount: number;
    perPerson: Array<{ personId: string; name: string; confidence: number }>;
  }>;
}

/** 全局筛选 → 查询参数（mod-004 §4.2：`groupIds` 重复参数、`from` / `to`、`keyword`、`identity`；空 = 不限）。 */
const filterQuery = (f: GlobalFilter): Array<[string, string]> =>
  queryOf([
    ...f.groupIds.map((id): [string, string | undefined] => ['groupIds', id]),
    ['from', f.timeRange.start === undefined || f.timeRange.start === '' ? undefined : String(dayStart(f.timeRange.start))],
    ['to', f.timeRange.end === undefined || f.timeRange.end === '' ? undefined : String(dayEnd(f.timeRange.end))],
    ['keyword', f.keyword],
    ['identity', f.meId],
  ]);

/** 画像读取（性格面板与写后重建共用）。 */
const loadProfile = async (personId: string): Promise<ApiEnvelope<PersonProfile>> => {
  const res = await request<Parameters<typeof toPersonProfile>[0]>('GET', `/people/${encodeURIComponent(personId)}`);
  return res.ok ? { ok: true, data: await toPersonProfile(res.data, personId) } : res;
};

/** 到期待办展示项（`API-018` 的界面形态；时间轴/待办面板使用）。 */
export interface DueTodoView {
  id: string;
  subject: string;
  groupName: string;
  deadline: string;
}

/** 数据量展示项（非契约接口 `/api/status/volume`）。 */
export interface DataVolume {
  messages: number;
  groups: number;
  people: number;
  memes: number;
  extracts: number;
}

/** 外壳设置视图（GET/PUT `/api/settings`；密钥只写不读回）。 */
export interface SettingsView {
  model: { baseUrl: string; apiKeyConfigured: boolean; taskConcurrency: number };
  ingest: { autoTriggerAfterIngest: boolean; pageSize: number };
  server: { port: number };
  log: { level: string; retentionDays: number };
}

/** 设置补丁（部分更新；缺省字段保持不变，`apiKey` 不传表示不改）。 */
export interface SettingsPatch {
  model?: { baseUrl?: string; apiKey?: string; taskConcurrency?: number };
  ingest?: { autoTriggerAfterIngest?: boolean };
  log?: { level?: string };
}

/** 数据去向说明（纯静态文案；REQ-012 / AC-030 的两处展示共用一份）。 */
const DATA_FLOW_NOTICE: DataFlowNotice = {
  modelEndpoint: '（未配置，可在设置页填写）',
  statements: [
    '原始聊天记录只保存在本机应用数据目录，不会上传到任何服务器。',
    '仅「识别 / 抽取 / 聚类 / 生成 / 推断」五类模型任务所需的消息内容，会发送到你在设置页配置的大模型服务。',
    '应用不提供任何对外分享 / 发送通道：分析结果不外露给群成员，也不会替你发消息。',
    '按群删除或全量清空时，原始记录、派生结果、生成历史与媒体缓存会被一并删除，不可恢复。',
  ],
};

/* -------------------------------------------------------------------------- */
/* API：每个方法对应契约中的一条 API-###                                        */
/* -------------------------------------------------------------------------- */
export const api = {
  /* ================= MOD-001 数据接入与更新 ================= */

  /** API-002 查询更新状态：首屏引导与「记录更新至 X」（REQ-002、REQ-003） */
  async updateStatus(): Promise<ApiEnvelope<UpdateStatus>> {
    const res = await request<Parameters<typeof toUpdateStatus>[0]>('GET', '/update-status');
    return res.ok ? { ok: true, data: toUpdateStatus(res.data) } : res;
  },

  /** API-001 触发更新：分来源结果，部分失败不阻塞（REQ-016） */
  async triggerUpdate(target?: 'group_messages' | 'contacts'): Promise<ApiEnvelope<UpdateResult>> {
    const res = await request<Parameters<typeof toUpdateResult>[0]>('POST', '/update', {
      body: target === undefined ? {} : { targetSource: target === 'contacts' ? '通讯录与好友列表' : '群消息' },
    });
    return res.ok ? { ok: true, data: toUpdateResult(res.data) } : res;
  },

  /** 群列表（DM-002）：全局筛选条的群多选项（REQ-004） */
  async groups(): Promise<ApiEnvelope<Group[]>> {
    const res = await request<{ records: Array<{ groupId: string; groupName: string }> }>('GET', '/filter-options/groups', {
      query: [
        ['page', '1'],
        ['pageSize', '1000'],
      ],
    });
    return res.ok ? { ok: true, data: toGroups(res.data.records) } : res;
  },

  /* ================= MOD-002 删除（REQ-011 / REQ-012） ================= */

  /** API-005 删除预检：返回受影响实体清单与计数 */
  async deletePrecheck(scope: DeleteScope): Promise<ApiEnvelope<DeletePrecheck>> {
    const res = await request<{ items: Array<{ entityType: string; count: number }> }>('POST', '/deletions/preflight', {
      body: { scope },
    });
    return res.ok ? { ok: true, data: await toPrecheck(res.data, scope) } : res;
  },

  /** API-006 执行删除：缺少二次确认时拒绝执行（CONFIRMATION_REQUIRED） */
  async executeDelete(scope: DeleteScope, confirmed: boolean): Promise<ApiEnvelope<DeleteResult>> {
    const res = await request<{ items: Array<{ entityType: string; count: number }> }>('POST', '/deletions', {
      body: { scope, confirmed },
    });
    return res.ok ? { ok: true, data: toDeletion(res.data) } : res;
  },

  /** 数据去向说明（REQ-012 / AC-030）：纯静态文案（无服务端数据） */
  async dataFlowNotice(): Promise<ApiEnvelope<DataFlowNotice>> {
    return { ok: true, data: DATA_FLOW_NOTICE };
  },

  /* ================= MOD-005 模块一：梗分析 ================= */

  /** API-009 查询梗词云：字号口径 + 布局（REQ-020 ~ REQ-024） */
  async memeCloud(f: GlobalFilter, layout: 'heat' | 'firstSeen', scale: 'cumulative' | 'window'): Promise<ApiEnvelope<MemeCloudResult>> {
    const res = await request<Parameters<typeof toMemeCloud>[0]>('GET', '/memes/cloud', {
      query: [
        ...filterQuery(f),
        ['layout', layout === 'heat' ? '按热度' : '按首次出现时间'],
        ['sizeBasis', scale === 'cumulative' ? '累计出现次数' : '指定时间窗内出现频次'],
      ],
    });
    return res.ok ? { ok: true, data: toMemeCloud(res.data) } : res;
  },

  /** API-010 查询梗单元：解读 / 首现 / 最近调用 / 分布 / 生命周期 / 梗王 / 精华 / 变体 */
  async memeUnit(memeId: string): Promise<ApiEnvelope<MemeUnit>> {
    const res = await request<Parameters<typeof toMemeUnit>[0]>('GET', `/memes/${encodeURIComponent(memeId)}`);
    return res.ok ? { ok: true, data: await toMemeUnit(res.data) } : res;
  },

  /** API-011 查询生命周期视图（REQ-025） */
  async memeLifecycle(f: GlobalFilter, months: string[]): Promise<ApiEnvelope<LifecycleView>> {
    const sorted = [...months].sort();
    const from = sorted[0] ?? '0000-01';
    const to = sorted[sorted.length - 1] ?? '9999-12';
    const res = await request<Parameters<typeof toLifecycleView>[0]>('GET', '/memes/lifecycle', {
      query: [...filterQuery(f), ['months', `${from},${to}`]],
    });
    return res.ok ? { ok: true, data: toLifecycleView(res.data) } : res;
  },

  /** API-012 提交纠正改判：四类改判立即生效（REQ-035） */
  async submitCorrection(memeId: string, mark: MemeUnit['correction'], mergeTargetId?: string): Promise<ApiEnvelope<MemeUnit>> {
    if (mark === 'none') {
      return invalid('「无」不是可提交的改判类型', '四类改判：不是梗 / 不感兴趣 / 合并到其他梗 / 梗王标注有误。');
    }
    const res = await request<{ memeId: string; correction: string }>('POST', `/memes/${encodeURIComponent(memeId)}/correction`, {
      body: { correction: CORRECTION_REVERSE[mark], ...(mergeTargetId === undefined ? {} : { mergeTargetId }) },
    });
    if (!res.ok) return res;
    setCorrection(memeId, mark);
    const unit = await request<Parameters<typeof toMemeUnit>[0]>('GET', `/memes/${encodeURIComponent(memeId)}`);
    return unit.ok ? { ok: true, data: await toMemeUnit(unit.data) } : unit;
  },

  /** API-013 查询「我相关」梗：我用过的 / 我参与消息里的（REQ-006） */
  async myMemes(f: GlobalFilter, view: 'used' | 'participated'): Promise<ApiEnvelope<MemeCloudResult>> {
    const res = await request<Parameters<typeof toMineCloud>[0]>('GET', '/memes/mine', {
      query: [...filterQuery(f), ['view', view === 'used' ? '我用过的' : '我参与消息里的']],
    });
    return res.ok ? { ok: true, data: toMineCloud(res.data) } : res;
  },

  /* ================= MOD-008 生成（挂载点在模块一，上下文经外壳转交） ================= */

  /**
   * API-030 生成表情包（REQ-036）：依赖 MOD-008 编排层（未落盘）→ 降级为明确错误。
   * 缺口与进度见 webui/README.md；不伪造生成物（REQ-019 / AC-010）。
   */
  async generateStickers(_ctx: MemeContext, _tier: MaterialTier, _template: string, _caption: string): Promise<ApiEnvelope<StickerGeneration>> {
    return notWired('生成表情包（G1）');
  },

  /** API-031 生成文字变体（REQ-037）：依赖 MOD-008 编排层（未落盘）→ 降级。 */
  async generateTextVariants(_ctx: MemeContext): Promise<ApiEnvelope<TextVariantGeneration>> {
    return notWired('文字变体生成（G2）');
  },

  /** API-032 生成新梗候选（REQ-038）：依赖 MOD-008 编排层（未落盘）→ 降级。 */
  async generateNewMemeCandidates(_f: GlobalFilter): Promise<ApiEnvelope<NewMemeCandidate[]>> {
    return notWired('新梗候选（G3）');
  },

  /** API-033 确认候选入库（REQ-009、REQ-038）：依赖 MOD-008 编排层（未落盘）→ 降级。 */
  async confirmCandidate(_candidateId: string): Promise<ApiEnvelope<{ candidateId: string; memeId: string; status: 'confirmed' }>> {
    return notWired('候选入库');
  },

  /** API-034 查询生成历史：依赖 MOD-008 编排层（未落盘）→ 降级。 */
  async generationHistory(_f: GlobalFilter): Promise<ApiEnvelope<GenerationHistoryItem[]>> {
    return notWired('生成历史');
  },

  /** 素材合规确认清单（DM-022 / REQ-014）：后端无清单读取接口 → 降级。 */
  async materialConsents(): Promise<ApiEnvelope<MaterialConsent[]>> {
    return notWired('素材确认清单');
  },

  /** 素材确认（按标识）：后端确认为条目式提交（与生成流程同接线）→ 降级。 */
  async confirmMaterial(_consentId: string): Promise<ApiEnvelope<MaterialConsent>> {
    return notWired('素材确认');
  },

  /* ================= MOD-006 模块二：信息提取 ================= */

  /** API-014 查询提取条目：按时间排序供消息时间轴使用（REQ-047） */
  async extractItems(f: GlobalFilter, page = 1, pageSize = 50): Promise<ApiEnvelope<Paged<ExtractItem>>> {
    const res = await request<Parameters<typeof toExtractPage>[0]>('GET', '/extracts', {
      query: [...filterQuery(f), ['page', String(page)], ['pageSize', String(pageSize)]],
    });
    return res.ok ? { ok: true, data: await toExtractPage(res.data) } : res;
  },

  /** API-015 查询通知总览：按来源 / 类型 / 优先级 / 待办分组（REQ-045） */
  async noticeGroups(f: GlobalFilter, dimension: NoticeDimension): Promise<ApiEnvelope<{ key: string; items: ExtractItem[] }[]>> {
    const zh = { source: '来源', type: '类型', priority: '优先级', todo: '待办' }[dimension];
    const res = await request<Parameters<typeof toNoticeGroups>[0]>('GET', '/notifications', {
      query: [...filterQuery(f), ['dimension', zh]],
    });
    return res.ok ? { ok: true, data: await toNoticeGroups(res.data) } : res;
  },

  /** API-016 修改主题 / 优先级：改后立即生效（REQ-008） */
  async updateExtract(id: string, patch: { subject?: string; priority?: Priority }): Promise<ApiEnvelope<ExtractItem>> {
    const res = await request<{ item: Parameters<typeof fullExtractItemOf>[0] }>('PATCH', `/extracts/${encodeURIComponent(id)}`, {
      body: {
        ...(patch.subject === undefined ? {} : { topic: patch.subject }),
        ...(patch.priority === undefined ? {} : { priority: PRIORITY_REVERSE[patch.priority] }),
      },
    });
    if (!res.ok) return res;
    await Promise.all([ensureGroups(), ensureMembers(res.data.item.personElementMemberIds ?? [])]);
    return { ok: true, data: fullExtractItemOf(res.data.item) };
  },

  /** API-017 标记待办状态：完成 / 忽略（REQ-046） */
  async markTodo(id: string, state: TodoState): Promise<ApiEnvelope<{ id: string; todoState: TodoState }>> {
    const res = await request<{ todoStatus: string }>('POST', `/extracts/${encodeURIComponent(id)}/todo`, {
      body: { todoStatus: TODO_STATE_REVERSE[state] },
    });
    if (!res.ok) return res;
    return { ok: true, data: { id, todoState: (TODO_STATE as Record<string, TodoState>)[res.data.todoStatus] ?? state } };
  },

  /** API-018 查询到期待办：距到期 ≤1 天且未完成（REQ-046） */
  async dueTodos(nowIso: string): Promise<ApiEnvelope<DueTodoView[]>> {
    const parsed = Date.parse(nowIso);
    const now = Number.isFinite(parsed) ? parsed : Date.now();
    const res = await request<Parameters<typeof toDueTodos>[0]>('GET', '/todos/due', { query: [['now', String(now)]] });
    return res.ok ? { ok: true, data: await toDueTodos(res.data) } : res;
  },

  /** API-019 查询消息详情：heading + 正文（REQ-048） */
  async messageDetail(id: string): Promise<ApiEnvelope<MessageDetail>> {
    const res = await request<Parameters<typeof toMessageDetail>[0]>('GET', `/extracts/${encodeURIComponent(id)}`);
    return res.ok ? { ok: true, data: await toMessageDetail(res.data, id) } : res;
  },

  /* ================= MOD-007 模块三：社交画像 ================= */

  /** API-020 查询人物画像（REQ-061、REQ-071、REQ-073） */
  async personProfile(personId: string): Promise<ApiEnvelope<PersonProfile>> {
    if (personId.length === 0) return invalid('未选择成员', '请先在成员列表中选择要查看的成员。');
    return loadProfile(personId);
  },

  /** API-021 查询兴趣 → 人：按维度 / 按标签两个入口（REQ-064、REQ-065） */
  async interestToPeople(entry: 'category' | 'tag', value: string, f: GlobalFilter): Promise<ApiEnvelope<InterestPeopleResult>> {
    const res = await request<Parameters<typeof toInterestPeople>[0]>('GET', '/people', {
      query: [
        ...filterQuery(f),
        ['entry', entry === 'category' ? '按一级维度' : '按二级标签'],
        ['value', entry === 'category' ? DIMENSION_REVERSE[value] ?? value : value],
      ],
    });
    return res.ok ? { ok: true, data: toInterestPeople(res.data, entry, value) } : res;
  },

  /** API-022 查询两人配对（REQ-058、REQ-059、REQ-062） */
  async pairMatch(aId: string, bId: string): Promise<ApiEnvelope<PairMatch>> {
    if (aId.length === 0 || bId.length === 0) return invalid('未选择两位成员', '请先选择要配对的两个成员。');
    const res = await request<Parameters<typeof toPairMatch>[0]>('GET', '/pairs', {
      query: [
        ['memberAId', aId],
        ['memberBId', bId],
      ],
    });
    return res.ok ? { ok: true, data: toPairMatch(res.data) } : res;
  },

  /** API-023 查询「我的社交契合度」：逐人列表 + 整体融入度（REQ-079） */
  async myCompatibility(): Promise<ApiEnvelope<MyCompatibility>> {
    const res = await request<Parameters<typeof toMyCompatibility>[0]>('GET', '/me/fit');
    return res.ok ? { ok: true, data: toMyCompatibility(res.data) } : res;
  },

  /** API-024 生成组局建议：仅文字建议（REQ-063） */
  async gatheringSuggestion(interest: string, personIds: string[]): Promise<ApiEnvelope<GatheringSuggestion>> {
    if (personIds.length === 0) {
      return invalid('未选择候选人', '请先在「兴趣 → 人」结果中勾选候选人。');
    }
    const res = await request<{ text: string }>('POST', '/playdate', {
      body: { interest, candidateMemberIds: personIds },
    });
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        interest,
        candidates: personIds.map((personId) => ({ personId, name: personNameOf(personId) })),
        text: res.data.text,
      },
    };
  },

  /** API-025 查询身份对齐候选（REQ-082） */
  async alignmentCandidates(): Promise<ApiEnvelope<IdentityAlignmentCandidate[]>> {
    const res = await request<Parameters<typeof toAlignmentList>[0]>('GET', '/identity/candidates');
    return res.ok ? { ok: true, data: await toAlignmentList(res.data) } : res;
  },

  /** API-026 提交身份对齐结论：未确认与否定均不生效（REQ-082） */
  async submitAlignment(candidateId: string, decision: 'confirmed' | 'rejected'): Promise<ApiEnvelope<{ candidateId: string; status: string }>> {
    const res = await request<{ status: string }>('POST', `/identity/candidates/${encodeURIComponent(candidateId)}`, {
      body: { conclusion: decision === 'confirmed' ? '确认' : '否定' },
    });
    return res.ok ? { ok: true, data: { candidateId, status: alignmentStatusOf(res.data) } } : res;
  },

  /**
   * API-027 确认与增删改性格标签（REQ-074 ~ REQ-077）。
   * 降级口径：后端无候选读取接口 → 面板「候选」区为空，已确认标签从画像（API-020）取数。
   */
  async personaPanel(personId: string): Promise<ApiEnvelope<PersonaPanel>> {
    if (personId.length === 0) return invalid('未选择成员', '请先在成员列表中选择要查看的成员。');
    const res = await loadProfile(personId);
    return res.ok ? { ok: true, data: toPersonaPanel(res.data) } : res;
  },

  async updatePersona(
    personId: string,
    op: 'confirm' | 'add' | 'delete' | 'edit',
    traitId: string,
    trait?: PersonalityTrait,
  ): Promise<ApiEnvelope<PersonaPanel>> {
    const action = { confirm: '确认', add: '增', delete: '删', edit: '改' }[op];
    const dimension = trait ?? personaTraitFor(traitId);
    if (dimension === undefined) {
      return invalid('无法定位性格标签（六维）', '请重新打开画像后再操作（标签信息未缓存）。');
    }
    const res = await request<{ tags: unknown }>('POST', `/people/${encodeURIComponent(personId)}/persona`, {
      body: { action, dimension: zhPersonality(dimension) },
    });
    if (!res.ok) return res;
    const panel = await loadProfile(personId);
    return panel.ok ? { ok: true, data: toPersonaPanel(panel.data) } : panel;
  },

  /** API-028 增删改兴趣标签：立即影响后续结果（REQ-056） */
  async editInterestTag(
    personId: string,
    op: 'add' | 'delete' | 'edit',
    payload: { tagId?: string; name?: string; category?: InterestCategory },
  ): Promise<ApiEnvelope<PersonProfile>> {
    const action = { add: '增', delete: '删', edit: '改' }[op];
    const info = payload.tagId === undefined ? undefined : tagInfoFor(payload.tagId);
    const name = payload.name ?? info?.name;
    const category = payload.category ?? info?.category;
    if (name === undefined || category === undefined) {
      return invalid('无法定位兴趣标签', '请重新打开画像后再操作（标签信息未缓存）。');
    }
    const res = await request<{ profile: Parameters<typeof toPersonProfile>[0] }>('PATCH', `/people/${encodeURIComponent(personId)}/interests`, {
      body: { action, tag: { name, dimension: zhDimension(category) } },
    });
    return res.ok ? { ok: true, data: await toPersonProfile(res.data.profile, personId) } : res;
  },

  /** API-029 查询成员兴趣提示：仅含已确认数据（REQ-070、REQ-075） */
  async memberInterestHints(memberIds: string[]): Promise<ApiEnvelope<MemberInterestHint[]>> {
    if (memberIds.length === 0) return { ok: true, data: [] };
    const res = await request<Parameters<typeof toHints>[0]>('GET', '/people/interest-hints', {
      query: [['ids', memberIds.join(',')]],
    });
    if (!res.ok && res.error?.code === 'NO_DATA') return { ok: true, data: [] };
    return res.ok ? { ok: true, data: await toHints(res.data) } : res;
  },

  /* ================= 模块三的其余展示形态（外壳展示组装路由） ================= */

  /** 展示-人的名单（非契约接口）：社交页成员列表 / 统计 / 配对默认值。 */
  async memberRoster(): Promise<ApiEnvelope<RelationGraph['nodes']>> {
    const res = await request<{ people: RelationGraph['nodes'] }>('GET', '/people/roster');
    if (!res.ok) return res;
    rememberPeople(res.data.people);
    return { ok: true, data: res.data.people };
  },

  /** 展示-人-人关系图谱（REQ-069）：节点 = 全部人（未知者零连线），连线 = 共同爱好。 */
  async relationGraph(): Promise<ApiEnvelope<RelationGraph>> {
    const res = await request<RelationGraph>('GET', '/social/graph');
    if (!res.ok) return res;
    rememberPeople(res.data.nodes);
    return res;
  },

  /** 展示-兴趣时间轴 / 事件流（REQ-067）：首现时间 + 事件点；仅可视化、不参与权重。 */
  async interestEventStreams(): Promise<ApiEnvelope<InterestEventStream[]>> {
    const res = await request<WireEventStreams>('GET', '/interests/event-streams');
    if (!res.ok) return res;
    const streams = res.data.streams.map((row) => ({
      tagId: row.tagId,
      name: row.name,
      category: dimensionOf(row.dimension),
      firstSeenAt: iso(row.firstSeenAt),
      // 契约事件点只含「时间 → 强度」（DM-013）：不带逐人信息，人物名留空
      events: row.events.map((point) => ({ at: iso(point.at), intensity: point.intensity, personName: '' })),
    }));
    rememberTags(streams);
    return { ok: true, data: streams };
  },

  /** 展示-评分卡 / 仪表盘（REQ-068、REQ-078）：标签热度 + 逐人置信度。 */
  async interestScoreCards(): Promise<ApiEnvelope<InterestScoreCard[]>> {
    const res = await request<WireScoreCards>('GET', '/interests/score-cards');
    if (!res.ok) return res;
    const cards = res.data.cards.map((row) => ({
      tagId: row.tagId,
      name: row.name,
      category: dimensionOf(row.dimension),
      heat: row.heat,
      peopleCount: row.peopleCount,
      perPerson: row.perPerson,
    }));
    rememberTags(cards);
    rememberPeople(res.data.cards.flatMap((card) => card.perPerson.map((person) => ({ personId: person.personId, name: person.name }))));
    return { ok: true, data: cards };
  },

  /** 本模块自有：读取外壳设置（模型服务 / 采集 / 日志；密钥只写不读回）。 */
  async settings(): Promise<ApiEnvelope<SettingsView>> {
    return request<SettingsView>('GET', '/settings');
  },

  /** 本模块自有：保存设置（部分字段补丁；`apiKey` 不传表示保持原值）。 */
  async saveSettings(patch: SettingsPatch): Promise<ApiEnvelope<SettingsView>> {
    return request<SettingsView>('PUT', '/settings', { body: patch });
  },

  /** 数据量（首屏与设置页展示，非契约接口） */
  async dataVolume(): Promise<ApiEnvelope<DataVolume>> {
    return request<DataVolume>('GET', '/status/volume');
  },
};

export type Api = typeof api;
