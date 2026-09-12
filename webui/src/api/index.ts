/**
 * 数据接入层 —— 34 条 API 的唯一调用点
 * =============================================================================
 * 组件只依赖本文件，不直接依赖 fixtures / mock / HTTP。
 *
 * 两种运行模式（VITE_API_MODE）：
 *   · 'mock'（默认）：走 `./mock`，供后端 MOD-001 ~ MOD-008 尚未实现时自测与验收自查。
 *   · 'http'       ：走本机服务进程的 HTTP 接口（HLD §1：浏览器只经本机 HTTP 取数）。
 *
 * 接入真实后端的步骤（后端就绪后执行，前端组件零改动）：
 *   1. 把 `VITE_API_MODE` 设为 `http`（或在 .env.local 里设置）；
 *   2. 打开 `vite.config.ts` 里已预留的 `/api` 代理；
 *   3. 删除 `./fixtures.ts` 与 `./mock.ts`（REQ-019：不做演示数据版本）。
 *
 * 每个方法都标注了对应的 `API-###` 编号与来源需求，便于后端逐条对表实现。
 * 错误一律按 `api-contract.md` §1.2 的 16 个稳定标识返回（不静默失败 —— REQ-016）。
 */
import * as m from './mock';
import {
  ERROR_CODES,
  type ApiEnvelope,
  type DataFlowNotice,
  type DeletePrecheck,
  type DeleteResult,
  type DeleteScope,
  type ErrorCode,
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
  type MaterialConsent,
  type MaterialTier,
  type MemeCloudResult,
  type MemeKingBoard,
  type MemeYearbook,
  type MemeContext,
  type MemeUnit,
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

export type ApiMode = 'mock' | 'http';

const MODE: ApiMode = (import.meta.env.VITE_API_MODE as ApiMode) ?? 'mock';
const BASE = (import.meta.env.VITE_API_BASE as string) ?? '/api';

export const apiMode = () => MODE;

const fail = (code: ErrorCode, message: string, hint?: string): ApiEnvelope<never> => ({
  ok: false,
  data: null,
  error: { code, message, hint },
});

const isErrorCode = (v: string): v is ErrorCode => (ERROR_CODES as readonly string[]).includes(v);

/** 把 mock 抛出的 `new Error('ERROR_CODE')` 映射为契约错误标识 */
function mapThrown(e: unknown, fallback: ErrorCode, message: string): ApiEnvelope<never> {
  const raw = e instanceof Error ? e.message : String(e);
  if (isErrorCode(raw)) {
    const hint =
      raw === 'CONFIRMATION_REQUIRED'
        ? '删除不可恢复，需要先完成二次确认。'
        : raw === 'INVALID_INPUT'
          ? '请检查输入：取值必须落在约定的闭集内。'
          : undefined;
    return fail(raw, message, hint);
  }
  return fail(fallback, message);
}

async function http<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
      return payload ?? fail('STORAGE_UNAVAILABLE', `本机服务返回 ${res.status}`);
    }
    return (await res.json()) as ApiEnvelope<T>;
  } catch (e) {
    return fail('STORAGE_UNAVAILABLE', e instanceof Error ? e.message : '本机服务不可用');
  }
}

/** 开发期：模拟本机服务的极短延迟，使骨架屏分支可被观察 */
const tick = (ms = 120) => new Promise((r) => setTimeout(r, MODE === 'mock' ? ms : 0));
const ok = <T,>(data: T, stale = false): ApiEnvelope<T> => ({ ok: true, data, stale });

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    sp.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  return sp.toString();
}

/* -------------------------------------------------------------------------- */
/* API：每个方法对应契约中的一条 API-###                                        */
/* -------------------------------------------------------------------------- */
export const api = {
  /* ================= MOD-001 数据接入与更新 ================= */

  /** API-002 查询更新状态：首屏引导与「记录更新至 X」（REQ-002、REQ-003） */
  async updateStatus(): Promise<ApiEnvelope<UpdateStatus>> {
    await tick(80);
    if (MODE === 'http') return http<UpdateStatus>('/update/status');
    return ok(m.mockUpdateStatus());
  },

  /** API-001 触发更新：分来源结果，部分失败不阻塞（REQ-016） */
  async triggerUpdate(target?: 'group_messages' | 'contacts'): Promise<ApiEnvelope<UpdateResult>> {
    await tick(600);
    if (MODE === 'http') return http<UpdateResult>('/update', { method: 'POST', body: JSON.stringify({ target }) });
    return ok(m.mockTriggerUpdate(target));
  },

  /** 群列表（DM-002）：全局筛选条的群多选项（REQ-004） */
  async groups(): Promise<ApiEnvelope<Group[]>> {
    await tick(60);
    if (MODE === 'http') return http<Group[]>('/groups');
    return ok(m.mockGroups());
  },

  /* ================= MOD-002 删除（REQ-011 / REQ-012） ================= */

  /** API-005 删除预检：返回受影响实体清单与计数 */
  async deletePrecheck(scope: DeleteScope): Promise<ApiEnvelope<DeletePrecheck>> {
    await tick(200);
    if (MODE === 'http') return http<DeletePrecheck>('/privacy/delete/precheck', { method: 'POST', body: JSON.stringify(scope) });
    return ok(m.mockDeletePrecheck(scope));
  },

  /** API-006 执行删除：缺少二次确认时拒绝执行（CONFIRMATION_REQUIRED） */
  async executeDelete(scope: DeleteScope, confirmed: boolean): Promise<ApiEnvelope<DeleteResult>> {
    await tick(500);
    if (MODE === 'http') return http<DeleteResult>('/privacy/delete', { method: 'POST', body: JSON.stringify({ scope, confirmed }) });
    try {
      return ok(m.mockExecuteDelete(scope, confirmed));
    } catch (e) {
      return mapThrown(e, 'DELETION_INTERRUPTED', '删除未执行');
    }
  },

  /** 数据去向说明（REQ-012 / AC-030）：首次使用与设置页各一处 */
  async dataFlowNotice(): Promise<ApiEnvelope<DataFlowNotice>> {
    await tick(60);
    if (MODE === 'http') return http<DataFlowNotice>('/privacy/data-flow');
    return ok(m.mockDataFlowNotice());
  },

  /* ================= MOD-005 模块一：梗分析 ================= */

  /** API-009 查询梗词云：字号口径 + 布局（REQ-020 ~ REQ-024） */
  async memeCloud(f: GlobalFilter, layout: 'heat' | 'firstSeen', scale: 'cumulative' | 'window'): Promise<ApiEnvelope<MemeCloudResult>> {
    await tick();
    if (MODE === 'http') return http<MemeCloudResult>(`/memes/cloud?${qs({ filter: f, layout, scale })}`);
    const data = m.mockMemeCloud(f, layout, scale);
    if (!data.entries.length) return fail('EMPTY_RESULT', '当前筛选条件下没有梗', '可一键清除筛选条件后重试。');
    return ok(data);
  },

  /**
   * 查询梗王榜（模块一排行榜）
   * 后端建议路由：GET /api/memes/king-board
   * 口径：参与度 = 使用梗的总次数；创造力 = 由其首次带火且被反复使用的梗数量；
   *      综合分 = 参与度 40% + 覆盖广度 20% + 带火贡献 40%（各归一化到 0–100）
   */
  async memeKingBoard(f: GlobalFilter): Promise<ApiEnvelope<MemeKingBoard>> {
    await tick();
    if (MODE === 'http') return http<MemeKingBoard>(`/memes/king-board?${qs({ filter: f })}`);
    const data = m.mockMemeKingBoard(f);
    if (!data.rows.length) return fail('EMPTY_RESULT', '当前筛选条件下没有可统计的梗', '可一键清除筛选条件后重试。');
    return ok(data);
  },

  /**
   * 查询梗年鉴数据（模块一的全屏回顾）
   * 后端建议路由：GET /api/memes/yearbook
   * 一次返回全部 6 页所需数据（封面 / 总量 / 最热的梗 / 它的诞生 / 凉掉的梗 / 结尾），
   * 翻页不再请求。数据不足时 `enough = false`，界面显示「数据还不够写年鉴」。
   */
  async memeYearbook(f: GlobalFilter): Promise<ApiEnvelope<MemeYearbook>> {
    await tick();
    if (MODE === 'http') return http<MemeYearbook>(`/memes/yearbook?${qs({ filter: f })}`);
    return ok(m.mockYearbook(f));
  },

  /**
   * 生成群称号（结尾页）：由 LLM 依据 Top10 梗生成。
   * 按「群 + 时间范围」缓存，避免重复生成（使用者明确要求缓存）。
   */
  async yearbookTitle(groupKey: string, topMemes: string[]): Promise<ApiEnvelope<{ title: string; cached: boolean }>> {
    const cacheKey = `mp:yearbook-title:${groupKey}`;
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) return ok({ title: cached, cached: true });
    } catch {
      /* localStorage 不可用时忽略缓存 */
    }

    await tick(700);
    if (MODE === 'http') {
      const res = await http<{ title: string }>('/memes/yearbook/title', { method: 'POST', body: JSON.stringify({ groupKey, topMemes }) });
      if (res.ok && res.data) {
        try {
          window.localStorage.setItem(cacheKey, res.data.title);
        } catch {
          /* ignore */
        }
        return ok({ title: res.data.title, cached: false });
      }
      return res as ApiEnvelope<{ title: string; cached: boolean }>;
    }

    if (!topMemes.length) return fail('EMPTY_RESULT', '梗太少，暂时写不出称号');

    /** 开发期：按 Top10 梗的构成拼一句可读的称号（后端接 LLM 后替换） */
    const seed = topMemes.join('');
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const candidates = [
      `年度梗最密的群`,
      `人均三个热梗的群`,
      `梗不过夜的群`,
      `${topMemes[0]} 一统江湖的群`,
      `每天都在造词的群`,
    ];
    const title = candidates[h % candidates.length];
    try {
      window.localStorage.setItem(cacheKey, title);
    } catch {
      /* ignore */
    }
    return ok({ title, cached: false });
  },

  /** API-010 查询梗单元：解读 / 首现 / 最近调用 / 分布 / 生命周期 / 梗王 / 精华 / 变体 */
  async memeUnit(memeId: string): Promise<ApiEnvelope<MemeUnit>> {
    await tick();
    if (MODE === 'http') return http<MemeUnit>(`/memes/${memeId}`);
    const data = m.mockMemeUnit(memeId);
    if (!data) return fail('NOT_FOUND', '该梗不存在或已被删除');
    return ok(data);
  },

  /** API-011 查询生命周期视图（REQ-025） */
  async memeLifecycle(f: GlobalFilter, months: string[]): Promise<ApiEnvelope<ReturnType<typeof m.mockLifecycleView>>> {
    await tick();
    if (MODE === 'http') return http(`/memes/lifecycle?${qs({ filter: f, months })}`);
    const data = m.mockLifecycleView(f, months);
    if (!data.rows.length) return fail('NO_DATA', '尚无可用数据', '请先完成一次「更新数据」。');
    return ok(data);
  },

  /** API-012 提交纠正改判：四类改判立即生效（REQ-035） */
  async submitCorrection(memeId: string, mark: MemeUnit['correction'], mergeTargetId?: string): Promise<ApiEnvelope<MemeUnit>> {
    await tick(200);
    if (MODE === 'http')
      return http<MemeUnit>(`/memes/${memeId}/correction`, { method: 'POST', body: JSON.stringify({ mark, mergeTargetId }) });
    try {
      const data = m.mockSubmitCorrection(memeId, mark, mergeTargetId);
      if (!data) return fail('NOT_FOUND', '该梗不存在');
      return ok(data);
    } catch (e) {
      return mapThrown(e, 'STORAGE_UNAVAILABLE', '改判未保存');
    }
  },

  /** API-013 查询「我相关」梗：我用过的 / 我参与消息里的（REQ-006） */
  async myMemes(f: GlobalFilter, view: 'used' | 'participated'): Promise<ApiEnvelope<MemeCloudResult>> {
    await tick();
    if (MODE === 'http') return http<MemeCloudResult>(`/memes/mine?${qs({ filter: f, view })}`);
    if (!f.meId) return fail('IDENTITY_NOT_READY', '「我」的身份未就绪', '身份取自 wechat-cli 的 Me 标识，完成一次「更新数据」后自动可用。');
    const all = m.mockMemeCloud({ ...f, keyword: '' }, 'heat', 'cumulative');
    const mine = all.entries.filter((e) => e.mine);
    if (!mine.length) return fail('EMPTY_RESULT', '没有与你相关的梗', '可一键清除筛选条件后重试。');
    void view;
    return ok({ ...all, entries: mine });
  },

  /* ================= MOD-008 生成（挂载点在模块一，上下文经外壳转交） ================= */

  /** API-030 生成表情包：素材档位三档单选 + 模板 + 文案 → 4 张（REQ-036） */
  async generateStickers(ctx: MemeContext, tier: MaterialTier, template: string, caption: string): Promise<ApiEnvelope<StickerGeneration>> {
    await tick(900);
    if (MODE === 'http')
      return http<StickerGeneration>('/generate/stickers', { method: 'POST', body: JSON.stringify({ ctx, tier, template, caption }) });
    try {
      return ok(m.mockGenerateStickers(ctx, tier, template, caption));
    } catch (e) {
      return mapThrown(e, 'ANALYSIS_FAILED', '表情包生成失败');
    }
  },

  /** API-031 生成文字变体：默认 5 条（REQ-037） */
  async generateTextVariants(ctx: MemeContext): Promise<ApiEnvelope<TextVariantGeneration>> {
    await tick(500);
    if (MODE === 'http') return http<TextVariantGeneration>('/generate/text-variants', { method: 'POST', body: JSON.stringify({ ctx }) });
    return ok(m.mockGenerateTextVariants(ctx));
  },

  /** API-032 生成新梗候选：确认前不进入词云（REQ-038） */
  async generateNewMemeCandidates(f: GlobalFilter): Promise<ApiEnvelope<NewMemeCandidate[]>> {
    await tick(800);
    if (MODE === 'http')
      return http<NewMemeCandidate[]>('/generate/new-meme-candidates', { method: 'POST', body: JSON.stringify({ filter: f }) });
    const data = m.mockGenerateNewMemeCandidates(f);
    if (!data.length) return fail('EMPTY_RESULT', '近期消息里没有发现潜在新梗');
    return ok(data);
  },

  /** API-033 确认候选入库：确认后才进入词云等视图（REQ-009、REQ-038） */
  async confirmCandidate(candidateId: string): Promise<ApiEnvelope<{ candidateId: string; memeId: string; status: 'confirmed' }>> {
    await tick(300);
    if (MODE === 'http')
      return http(`/generate/candidates/${candidateId}/confirm`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
    try {
      return ok(m.mockConfirmCandidate(candidateId));
    } catch (e) {
      return mapThrown(e, 'STORAGE_UNAVAILABLE', '候选入库失败');
    }
  },

  /** API-034 查询生成历史（可回看与再次下载） */
  async generationHistory(f: GlobalFilter): Promise<ApiEnvelope<GenerationHistoryItem[]>> {
    await tick();
    if (MODE === 'http') return http<GenerationHistoryItem[]>(`/generate/history?${qs({ filter: f })}`);
    const data = m.mockGenerationHistory(f);
    if (!data.length) return fail('EMPTY_RESULT', '还没有生成记录');
    return ok(data);
  },

  /** 素材合规确认（DM-022 / REQ-014）：未确认时 G1 被拒 */
  async materialConsents(): Promise<ApiEnvelope<MaterialConsent[]>> {
    await tick();
    if (MODE === 'http') return http<MaterialConsent[]>('/generate/materials');
    return ok(m.mockMaterialConsents());
  },

  async confirmMaterial(consentId: string): Promise<ApiEnvelope<MaterialConsent>> {
    await tick(200);
    if (MODE === 'http') return http<MaterialConsent>(`/generate/materials/${consentId}/confirm`, { method: 'POST' });
    try {
      return ok(m.mockConfirmMaterial(consentId));
    } catch (e) {
      return mapThrown(e, 'NOT_FOUND', '素材记录不存在');
    }
  },

  /* ================= MOD-006 模块二：信息提取 ================= */

  /** API-014 查询提取条目：按时间排序供消息时间轴使用（REQ-047） */
  async extractItems(f: GlobalFilter, page = 1, pageSize = 50): Promise<ApiEnvelope<Paged<ExtractItem>>> {
    await tick();
    if (MODE === 'http') return http<Paged<ExtractItem>>(`/extracts?${qs({ filter: f, page, pageSize })}`);
    const data = m.mockExtractItems(f, page, pageSize);
    if (!data.total) return fail('EMPTY_RESULT', '当前筛选条件下没有提取到内容', '可一键清除筛选条件后重试。');
    return ok(data);
  },

  /** API-015 查询通知总览：按来源 / 类型 / 优先级 / 待办分组（REQ-045） */
  async noticeGroups(f: GlobalFilter, dimension: NoticeDimension): Promise<ApiEnvelope<{ key: string; items: ExtractItem[] }[]>> {
    await tick();
    if (MODE === 'http') return http(`/notices?${qs({ filter: f, dimension })}`);
    const data = m.mockNoticeGroups(f, dimension);
    if (!data.length) return fail('EMPTY_RESULT', '当前筛选条件下没有通知', '可一键清除筛选条件后重试。');
    return ok(data);
  },

  /** API-016 修改主题 / 优先级：改后立即生效（REQ-008） */
  async updateExtract(id: string, patch: { subject?: string; priority?: Priority }): Promise<ApiEnvelope<ExtractItem>> {
    await tick(200);
    if (MODE === 'http') return http<ExtractItem>(`/extracts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    try {
      return ok(m.mockUpdateExtract(id, patch));
    } catch (e) {
      return mapThrown(e, 'NOT_FOUND', '条目不存在');
    }
  },

  /** API-017 标记待办状态：完成 / 忽略（REQ-046） */
  async markTodo(id: string, state: TodoState): Promise<ApiEnvelope<{ id: string; todoState: TodoState }>> {
    await tick(200);
    if (MODE === 'http') return http(`/extracts/${id}/todo`, { method: 'POST', body: JSON.stringify({ state }) });
    try {
      return ok(m.mockMarkTodo(id, state));
    } catch (e) {
      return mapThrown(e, 'NOT_FOUND', '条目不存在');
    }
  },

  /** API-018 查询到期待办：距到期 ≤1 天且未完成（REQ-046） */
  async dueTodos(nowIso: string): Promise<ApiEnvelope<ReturnType<typeof m.mockDueTodos>>> {
    await tick(80);
    if (MODE === 'http') return http(`/todos/due?${qs({ now: nowIso })}`);
    return ok(m.mockDueTodos(nowIso));
  },

  /** API-019 查询消息详情：heading + 正文（REQ-048） */
  async messageDetail(id: string): Promise<ApiEnvelope<MessageDetail>> {
    await tick();
    if (MODE === 'http') return http<MessageDetail>(`/extracts/${id}`);
    const data = m.mockMessageDetail(id);
    if (!data) return fail('NOT_FOUND', '条目不存在或已删除');
    return ok(data);
  },

  /* ================= MOD-007 模块三：社交画像 ================= */

  /** API-020 查询人物画像（REQ-061、REQ-071、REQ-073） */
  async personProfile(personId: string): Promise<ApiEnvelope<PersonProfile>> {
    await tick();
    if (MODE === 'http') return http<PersonProfile>(`/persons/${personId}`);
    const data = m.mockProfile(personId);
    if (!data) return fail('NOT_FOUND', '该成员不存在');
    if (!data.tags.length) return fail('EMPTY_RESULT', '尚无可展示的兴趣标签', '该成员发言不足时不做推测（REQ-081）。');
    return ok(data);
  },

  /** API-021 查询兴趣 → 人：按维度 / 按标签两个入口（REQ-064、REQ-065） */
  async interestToPeople(entry: 'category' | 'tag', value: string, f: GlobalFilter): Promise<ApiEnvelope<InterestPeopleResult>> {
    await tick();
    if (MODE === 'http') return http<InterestPeopleResult>(`/interests/people?${qs({ entry, value, filter: f })}`);
    const data = m.mockInterestToPeople(entry, value, f);
    if (!data.people.length) return fail('EMPTY_RESULT', '没有找到符合条件的人', '可一键清除筛选条件后重试。');
    return ok(data);
  },

  /** API-022 查询两人配对（REQ-058、REQ-059、REQ-062） */
  async pairMatch(aId: string, bId: string): Promise<ApiEnvelope<PairMatch>> {
    await tick();
    if (MODE === 'http') return http<PairMatch>(`/pairs?${qs({ a: aId, b: bId })}`);
    const data = m.mockPairMatch(aId, bId);
    if (!data) return fail('NOT_FOUND', '配对的成员不存在');
    return ok(data);
  },

  /** API-023 查询「我的社交契合度」：逐人列表 + 整体融入度（REQ-079） */
  async myCompatibility(): Promise<ApiEnvelope<MyCompatibility>> {
    await tick();
    if (MODE === 'http') return http<MyCompatibility>('/me/compatibility');
    const data = m.mockMyCompatibility();
    if (!data.perPerson.length) return fail('IDENTITY_NOT_READY', '「我」的身份未就绪');
    return ok(data);
  },

  /** API-024 生成组局建议：仅文字建议（REQ-063） */
  async gatheringSuggestion(interest: string, personIds: string[]): Promise<ApiEnvelope<GatheringSuggestion>> {
    await tick(500);
    if (MODE === 'http')
      return http<GatheringSuggestion>('/interests/gathering', { method: 'POST', body: JSON.stringify({ interest, personIds }) });
    if (!personIds.length) return fail('EMPTY_RESULT', '未选择候选人', '请先在「兴趣 → 人」结果中勾选候选人。');
    return ok(m.mockGatheringSuggestion(interest, personIds));
  },

  /** API-025 查询身份对齐候选（REQ-082） */
  async alignmentCandidates(): Promise<ApiEnvelope<IdentityAlignmentCandidate[]>> {
    await tick();
    if (MODE === 'http') return http<IdentityAlignmentCandidate[]>('/identity/candidates');
    return ok(m.mockAlignmentCandidates());
  },

  /** API-026 提交身份对齐结论：未确认与否定均不生效（REQ-082） */
  async submitAlignment(candidateId: string, decision: 'confirmed' | 'rejected'): Promise<ApiEnvelope<{ candidateId: string; status: string }>> {
    await tick(200);
    if (MODE === 'http') return http(`/identity/candidates/${candidateId}`, { method: 'POST', body: JSON.stringify({ decision }) });
    try {
      return ok(m.mockSubmitAlignment(candidateId, decision));
    } catch (e) {
      return mapThrown(e, 'NOT_FOUND', '候选不存在');
    }
  },

  /** API-027 确认与增删改性格标签（REQ-074 ~ REQ-077） */
  async personaPanel(personId: string): Promise<ApiEnvelope<PersonaPanel>> {
    await tick(80);
    if (MODE === 'http') return http<PersonaPanel>(`/persons/${personId}/persona`);
    return ok(m.mockPersonaPanel(personId));
  },

  async updatePersona(
    personId: string,
    op: 'confirm' | 'add' | 'delete' | 'edit',
    traitId: string,
    trait?: PersonalityTrait,
  ): Promise<ApiEnvelope<PersonaPanel>> {
    await tick(200);
    if (MODE === 'http')
      return http<PersonaPanel>(`/persons/${personId}/persona`, { method: 'POST', body: JSON.stringify({ op, traitId, trait }) });
    try {
      return ok(m.mockConfirmPersona(personId, traitId, op, trait));
    } catch (e) {
      return mapThrown(e, 'INVALID_INPUT', '性格标签操作未生效');
    }
  },

  /** API-028 增删改兴趣标签：立即影响后续结果（REQ-056） */
  async editInterestTag(
    personId: string,
    op: 'add' | 'delete' | 'edit',
    payload: { tagId?: string; name?: string; category?: InterestCategory },
  ): Promise<ApiEnvelope<PersonProfile>> {
    await tick(200);
    if (MODE === 'http')
      return http<PersonProfile>(`/persons/${personId}/interests`, { method: 'PATCH', body: JSON.stringify({ op, ...payload }) });
    try {
      return ok(m.mockEditInterestTag(personId, op, payload));
    } catch (e) {
      return mapThrown(e, 'INVALID_INPUT', '兴趣标签操作未生效');
    }
  },

  /** API-029 查询成员兴趣提示：仅含已确认数据（REQ-070、REQ-075） */
  async memberInterestHints(memberIds: string[]): Promise<ApiEnvelope<ReturnType<typeof m.mockInterestHints>>> {
    await tick(60);
    if (MODE === 'http') return http(`/members/interest-hints?${qs({ ids: memberIds.join(',') })}`);
    return ok(m.mockInterestHints(memberIds));
  },

  /* ================= 模块三的其余展示形态 ================= */

  /** 展示-人-人关系图谱（REQ-069）：节点 = 人，连线 = 共同爱好 */
  async relationGraph(): Promise<ApiEnvelope<RelationGraph>> {
    await tick();
    if (MODE === 'http') return http<RelationGraph>('/social/graph');
    return ok(m.mockRelationGraph());
  },

  /** 展示-兴趣时间轴 / 事件流（REQ-067）：仅可视化、不参与权重（REQ-087） */
  async interestEventStreams(): Promise<ApiEnvelope<InterestEventStream[]>> {
    await tick();
    if (MODE === 'http') return http<InterestEventStream[]>('/interests/event-streams');
    return ok(m.mockInterestEventStreams());
  },

  /** 展示-评分卡 / 仪表盘（REQ-068、REQ-078） */
  async interestScoreCards(): Promise<ApiEnvelope<InterestScoreCard[]>> {
    await tick();
    if (MODE === 'http') return http<InterestScoreCard[]>('/interests/score-cards');
    return ok(m.mockInterestScoreCards());
  },

  /** 数据量（首屏与设置页展示，非契约接口） */
  async dataVolume(): Promise<ApiEnvelope<ReturnType<typeof m.mockDataVolume>>> {
    await tick(60);
    if (MODE === 'http') return http('/status/volume');
    return ok(m.mockDataVolume());
  },
};

export type Api = typeof api;
