/**
 * 数据接入层（Adapter）
 * =============================================================================
 * 组件只依赖本文件导出的 `api`，不直接依赖 mock。
 *
 * 当前 raw_design.md / 后端 core 未定稿 → 全部走本地 mock，但：
 *
 *  1. 每个方法的签名就是「前后端接口契约」（参数 + 返回类型见 src/types.ts）。
 *  2. 真实后端就绪后，只需在此文件内把 `mockApi.xxx()` 换成
 *     `http('/api/xxx')` 或 MCP 工具调用，组件层零改动。
 *  3. 所有返回值统一是 `ApiEnvelope<T>`，UI 通过 `useApi` 自动处理
 *     loading / empty / error 三种异常分支。
 *
 * 后端建议路由（与 wechat-cli 命令对应）：
 *   GET  /api/sessions                    → sessions
 *   GET  /api/chats/:chat/members         → members
 *   GET  /api/chats/:chat/messages        → history
 *   GET  /api/chats/:chat/stats           → stats
 *   GET  /api/chats/:chat/media           → media
 *   POST /api/analyze/memes               → core + LLM（梗提炼）
 *   POST /api/analyze/notices             → core + LLM（通知提取）
 *   POST /api/analyze/profiles            → core + LLM（画像匹配）
 *   POST /api/remix                       → 表情包等再创作生成
 *
 * 演示环境变量（用于走查空态/失败态，不需要后端配合）：
 *   ?sim=empty      强制空数据
 *   ?sim=error      强制接口失败
 *   ?sim=slow       强制 3s 延迟
 * 例如： #/meme?sim=empty
 */
import type {
  ApiEnvelope,
  ChatMember,
  ChatSession,
  FriendshipPotential,
  MemeCard,
  MemeRemixJob,
  NoticeItem,
  NoticeQuery,
  NoticeStatus,
  OverviewStats,
  PersonalityProfile,
  RelationshipSummary,
  RemixKind,
  SocialOverviewStats,
  WordCloudItem,
} from '@/types';
import { GROUPS, MEMBERS_BY_GROUP, MEMES, NOTICES, OVERVIEW, POTENTIALS, PROFILES, RELATIONSHIPS, SESSIONS, SOCIAL_STATS } from './mockData';

/* -------------------------------------------------------------------------- */
/* 模拟场景开关                                                                */
/* -------------------------------------------------------------------------- */
export type SimMode = 'off' | 'empty' | 'error' | 'slow';

const SIM_VALUES: SimMode[] = ['empty', 'error', 'slow'];

/** 从当前 URL 读取模拟场景（每次调用都读，避免 SPA 内跳转后失效） */
function readSimFromUrl(): SimMode {
  try {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    const p = new URLSearchParams(hashQuery || window.location.search.slice(1));
    const v = p.get('sim');
    if (v && (SIM_VALUES as string[]).includes(v)) return v as SimMode;
  } catch {
    /* ignore */
  }
  return 'off';
}

let manualSim: SimMode | null = null; // 由顶部开关设置，优先级高于 URL

export const getSimMode = (): SimMode => manualSim ?? readSimFromUrl();

export const setSimMode = (m: SimMode) => {
  manualSim = m;
  window.dispatchEvent(new CustomEvent('mp:sim', { detail: m }));
};

/** 监听 hash 变化，让 #/meme?sim=empty 这类地址在 SPA 内跳转也能生效 */
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    // 地址里显式带了 sim 参数时，以地址为准（覆盖开关）
    if (window.location.hash.includes('sim=')) manualSim = null;
    window.dispatchEvent(new CustomEvent('mp:sim', { detail: getSimMode() }));
  });
}

const delay = (ms = 260) => new Promise((r) => setTimeout(r, getSimMode() === 'slow' ? 3000 : ms));

async function wrap<T>(producer: () => T, ms?: number): Promise<ApiEnvelope<T>> {
  const started = performance.now();
  await delay(ms);
  if (getSimMode() === 'error') {
    return {
      ok: false,
      data: null as unknown as T,
      error: {
        code: 'LLM_TIMEOUT',
        message: '分析服务响应超时（模拟失败态）',
        hint: '可点击「重新分析」重试；若持续失败，请检查 core / LLM 服务是否运行。',
      },
    };
  }
  const data = producer();
  return {
    ok: true,
    data,
    source: 'mock',
    elapsed_ms: Math.round(performance.now() - started),
    notice: getSimMode() === 'empty' ? '当前筛选条件下没有数据（模拟空态）' : undefined,
  };
}

const isEmpty = () => getSimMode() === 'empty';

/* -------------------------------------------------------------------------- */
/* 筛选工具：前端本地筛选，后端就绪后可下沉为查询参数（口径保持一致）              */
/* -------------------------------------------------------------------------- */
export function filterNotices(list: NoticeItem[], q: NoticeQuery): NoticeItem[] {
  const kw = q.keyword.trim().toLowerCase();
  const toDay = (v?: string) => (v ? v.slice(0, 10) : undefined);
  const start = toDay(q.start);
  const end = toDay(q.end);
  let out = list.filter((n) => {
    if (q.chats.length && !q.chats.includes(n.chat)) return false;
    if (q.categories.length && !q.categories.includes(n.category)) return false;
    if (q.priorities.length && !q.priorities.includes(n.priority)) return false;
    if (q.statuses.length && !q.statuses.includes(n.status)) return false;
    if (q.only_with_deadline && !n.entities.deadline) return false;
    // 时间筛选按「日期」比较（YYYY-MM-DD），与展示用的 'MM-DD HH:mm' 解耦。
    // 注意：不能用 n.time 直接比较 —— 它不带年份，与 'YYYY-MM-DD' 边界比较会得出错误结果。
    const day = n.date ?? new Date(n.timestamp * 1000).toISOString().slice(0, 10);
    if (start && day < start) return false;
    if (end && day > end) return false;
    if (kw) {
      const hay = [n.headline, n.summary, n.chat, n.tags.join(' '), String(n.entities.subject ?? ''), n.sources.map((s) => s.text).join(' ')]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  out = out.sort((a, b) => {
    switch (q.sort) {
      case 'time_asc':
        return a.timestamp - b.timestamp;
      case 'priority':
        return priorityRank[a.priority] - priorityRank[b.priority] || b.timestamp - a.timestamp;
      case 'deadline': {
        const da = a.entities.deadline ? Date.parse(String(a.entities.deadline)) : Number.MAX_SAFE_INTEGER;
        const db = b.entities.deadline ? Date.parse(String(b.entities.deadline)) : Number.MAX_SAFE_INTEGER;
        return da - db;
      }
      case 'time_desc':
      default:
        return b.timestamp - a.timestamp;
    }
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */
export const api = {
  /** 会话 / 群列表 —— 对齐 wechat-cli `sessions` */
  listSessions: () =>
    wrap<ChatSession[]>(() => (isEmpty() ? [] : SESSIONS)),

  /** 群成员 —— 对齐 wechat-cli `members` */
  listMembers: (chat: string) =>
    wrap<ChatMember[]>(() => (isEmpty() ? [] : (MEMBERS_BY_GROUP[chat] ?? []))),

  /** 总览统计 —— 对齐 wechat-cli `stats` + core 聚合 */
  getOverview: (_chats: string[]) =>
    wrap<OverviewStats>(() =>
      isEmpty()
        ? { ...OVERVIEW, total_messages: 0, meme_count: 0, notice_count: 0, todo_count: 0, top_senders: [] }
        : OVERVIEW,
    ),

  /** 词云数据（由梗库派生；后端可由 LLM 关键词抽取直接给出） */
  getWordCloud: (chats: string[], layout: 'cloud' | 'rank' | 'time') =>
    wrap<WordCloudItem[]>(() => {
      if (isEmpty()) return [];
      const scoped = chats.length ? MEMES.filter((m) => m.chats.some((c) => chats.includes(c))) : MEMES;
      const items: WordCloudItem[] = scoped.map((m) => ({
        term: m.term,
        count: m.count,
        weight: 0,
        meme_id: m.id,
        category: m.category,
        first_seen: m.first_seen.slice(5, 10),
        last_seen: m.last_seen.slice(5, 10),
      }));
      const max = Math.max(...items.map((i) => i.count), 1);
      const min = Math.min(...items.map((i) => i.count), 0);
      items.forEach((i) => (i.weight = (i.count - min) / Math.max(1, max - min)));
      if (layout === 'time') {
        // 按首次出现时间排序
        const order = new Map(scoped.map((m) => [m.id, Date.parse(m.first_seen)]));
        items.sort((a, b) => (order.get(a.meme_id!) ?? 0) - (order.get(b.meme_id!) ?? 0));
      } else {
        items.sort((a, b) => b.count - a.count);
      }
      return items;
    }),

  /** 梗卡片列表 */
  listMemes: (chats: string[], sort: 'hot' | 'recent' | 'lifespan' = 'hot') =>
    wrap<MemeCard[]>(() => {
      if (isEmpty()) return [];
      const scoped = chats.length ? MEMES.filter((m) => m.chats.some((c) => chats.includes(c))) : MEMES;
      const copy = [...scoped];
      if (sort === 'hot') copy.sort((a, b) => b.count - a.count);
      if (sort === 'recent') copy.sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
      if (sort === 'lifespan') copy.sort((a, b) => b.lifespan_days - a.lifespan_days);
      return copy;
    }),

  getMeme: (id: string) => wrap<MemeCard | null>(() => (isEmpty() ? null : (MEMES.find((m) => m.id === id) ?? null)), 160),

  /** 梗再创作：生成表情包 / 配文图（占位实现，返回 SVG dataURL 占位图） */
  remixMeme: (memeId: string, kind: RemixKind, style: string) =>
    wrap<MemeRemixJob>(() => {
      const meme = MEMES.find((m) => m.id === memeId);
      const term = meme?.term ?? '梗';
      const frames = kind === 'sticker' ? ['原图', '放大', '配文'] : ['主图'];
      return {
        id: `job_${Date.now()}`,
        meme_id: memeId,
        kind,
        status: 'done',
        style,
        prompt: `为群聊梗「${term}」生成${kind === 'sticker' ? '表情包' : '配文图'}，风格：${style}`,
        created_at: new Date().toISOString(),
        results: frames.map((label, i) => ({ url: placeholderArt(term, style, i), label })),
      };
    }, 900),

  /** 通知查询 */
  queryNotices: (q: NoticeQuery) =>
    wrap<NoticeItem[]>(() => (isEmpty() ? [] : filterNotices(NOTICES, q)), 340),

  getNotice: (id: string) => wrap<NoticeItem | null>(() => (isEmpty() ? null : (NOTICES.find((n) => n.id === id) ?? null)), 160),

  /** 更新通知状态（标记完成 / 忽略）—— TODO(接口待定)：后端持久化位置 */
  updateNoticeStatus: (id: string, status: NoticeStatus) =>
    wrap<{ id: string; status: NoticeStatus }>(() => {
      const target = NOTICES.find((n) => n.id === id);
      if (target) target.status = status;
      return { id, status };
    }),

  /** 画像 / 成员信息 —— 两个模式共用（性格展示卡片） */
  listProfiles: (chat: string) =>
    wrap<PersonalityProfile[]>(() => (isEmpty() ? [] : PROFILES.slice(0, Math.max(4, Math.min(12, (MEMBERS_BY_GROUP[chat] ?? []).length || 8))))),

  /**
   * 正向社交：已经熟识的人之间做了什么 → 关系总结
   * 后端建议路由：POST /api/analyze/relationships
   */
  listRelationships: () => wrap<RelationshipSummary[]>(() => (isEmpty() ? [] : RELATIONSHIPS), 420),

  /**
   * 反向社交：非熟人但有相似兴趣、具备交友潜力的人
   * 后端建议路由：POST /api/analyze/potential-friends
   */
  listPotentials: () => wrap<FriendshipPotential[]>(() => (isEmpty() ? [] : [...POTENTIALS].sort((a, b) => b.potential - a.potential)), 420),

  /** 功能三统计 */
  getSocialStats: () => wrap<SocialOverviewStats>(() => (isEmpty() ? { familiar_count: 0, memory_count: 0, potential_count: 0, high_potential_count: 0 } : SOCIAL_STATS), 240),

  /** 群列表（部分页面只需要 chat 数组） */
  listGroups: () => wrap(() => GROUPS.map((g) => ({ chat: g.chat, username: g.username, subject: g.subject, avatar: g.avatar, member_count: g.memberCount, is_group: g.username.includes('@chatroom') }))),
};

/** 生成一张带文字的 SVG 占位图（避免依赖外部图片资源，演示离线可用） */
function placeholderArt(term: string, style: string, variant: number): string {
  const palettes = [
    ['#0b0f17', '#07C160'],
    ['#121722', '#f59e0b'],
    ['#052e1c', '#45bd87'],
    ['#1c2230', '#fb7185'],
  ];
  const [bg, fg] = palettes[variant % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${fg}" stop-opacity="0.35"/>
  </linearGradient></defs>
  <rect width="320" height="320" rx="28" fill="url(#g)"/>
  <text x="160" y="150" font-size="${term.length > 3 ? 44 : 62}" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(term)}</text>
  <text x="160" y="196" font-size="18" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="${fg}" text-anchor="middle">${escapeXml(style)}</text>
  <text x="160" y="264" font-size="14" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#ffffff" fill-opacity="0.55" text-anchor="middle">聊斋 MessagePick · 演示占位图</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export type Api = typeof api;
