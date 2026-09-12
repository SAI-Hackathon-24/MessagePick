/**
 * 由现有接口派生的展示数据（梗王榜 / 梗年鉴）
 * =============================================================================
 * 后端**没有** `king-board` / `yearbook` 路由，且本分支的口径是「前端与后端完全对齐、
 * 不新增接口」。因此这两件由前端**组合已有接口**得到，不落库、不改契约：
 *
 *   · `/api/memes/cloud`      —— 梗清单（名字 / 次数 / 首现 / 最近调用）
 *   · `/api/memes/:memeId`    —— 单个梗的 `king`（梗王与主要使用者）与 `highlights`
 *   · `/api/status/volume`    —— 消息总数（年鉴「这段时间的消息总数」）
 *   · `/api/filter-options/groups` —— 群名
 *
 * 代价是要按梗逐个取详情；因此只对**热门前 N 个**梗取详情（默认 10），
 * 足以支撑榜单与年鉴，不至于为了一个标题拉全量。
 *
 * 口径说明（与页面文案一致）：
 *   · 参与度   = 该成员使用梗的总次数（由各梗 `king.members` 的 count 累加）
 *   · 覆盖广度 = 用过的不同梗数量
 *   · 创造力   = 由该成员**首次带火**的梗数量（取该梗首条精华消息的发送者）
 *   · 综合分   = 参与度 40% + 覆盖广度 20% + 带火贡献 40%（各归一化 0–100）
 * 这些都是可由记录统计的事实，不做性格判断。
 */
import type { GlobalFilter, MemeKingBoard, MemeKingRow, MemeYearbook } from '@/types';

/** 参与详情聚合的梗数量上限（榜单与年鉴都只需头部；避免为标题拉全量）。 */
const TOP_N = 10;

/** 派生过程需要的原始取数口（由 `api/index.ts` 注入，避免循环依赖）。 */
export interface DerivePorts {
  cloud: (filter: GlobalFilter, limit: number) => Promise<{ memeId: string; name: string; occurrences: number; firstSeenAt: string; lastUsedAt: string }[]>;
  unit: (memeId: string) => Promise<{
    king: { members: { memberId: string; name: string; count: number }[]; topUsers: { memberId: string; name: string; count: number }[] };
    highlights: { messageId: string; senderName: string; text?: string; sentAt: string; kind: string }[];
    monthly: { month: string; count: number }[];
    activeDays: number;
  } | null>;
  volume: () => Promise<{ messages: number }>;
  groupName: (groupId: string) => string;
}

/** 单个成员在派生过程中的累计。 */
interface Accumulator {
  memberId: string;
  name: string;
  participations: number;
  memes: Set<string>;
  authored: string[];
}

/**
 * 梗王榜：聚合头部梗的 `king.members` 得到每人参与度与带火贡献。
 * `authored` 的判定是「该梗首条精华消息的发送者」——即最先把它用起来的人。
 */
export async function deriveKingBoard(filter: GlobalFilter, ports: DerivePorts): Promise<MemeKingBoard> {
  const top = await ports.cloud(filter, TOP_N);
  const acc = new Map<string, Accumulator>();

  const ensure = (memberId: string, name: string): Accumulator => {
    const found = acc.get(memberId);
    if (found !== undefined) return found;
    const created: Accumulator = { memberId, name, participations: 0, memes: new Set(), authored: [] };
    acc.set(memberId, created);
    return created;
  };

  for (const entry of top) {
    const unit = await ports.unit(entry.memeId);
    if (unit === null) continue;
    // 参与度：所有使用过该梗的人各记一次（并列时全部列出）
    for (const member of unit.king.members) {
      const row = ensure(member.memberId, member.name);
      row.participations += member.count;
      row.memes.add(entry.memeId);
    }
    // 主要使用者也计入覆盖广度（他们用过这个梗）
    for (const member of unit.king.topUsers) ensure(member.memberId, member.name).memes.add(entry.memeId);
    // 创造力：该梗首条精华消息的发送者
    const first = unit.highlights[0];
    if (first !== undefined) ensure(first.senderName, first.senderName).authored.push(entry.name);
  }

  const rows = [...acc.values()];
  const maxUse = Math.max(...rows.map((r) => r.participations), 1);
  const maxDistinct = Math.max(...rows.map((r) => r.memes.size), 1);
  const maxAuthored = Math.max(...rows.map((r) => r.authored.length), 1);

  const board: MemeKingRow[] = rows
    .map((r) => {
      const normalized = {
        participations: Math.round((r.participations / maxUse) * 100),
        distinctMemes: Math.round((r.memes.size / maxDistinct) * 100),
        authoredHits: Math.round((r.authored.length / maxAuthored) * 100),
      };
      return {
        memberId: r.memberId,
        name: r.name,
        participations: r.participations,
        distinctMemes: r.memes.size,
        authoredHits: r.authored.length,
        authoredMemeNames: r.authored,
        normalized,
        score: Math.round(normalized.participations * 0.4 + normalized.distinctMemes * 0.2 + normalized.authoredHits * 0.4),
        isKing: false,
        rank: 0,
      };
    })
    .sort((a, b) => b.score - a.score || b.participations - a.participations);

  board.forEach((row, index) => {
    row.rank = index + 1;
  });
  if (board.length > 0) board[0]!.isKing = true;

  return { rows: board, king: board[0], totalParticipations: rows.reduce((sum, r) => sum + r.participations, 0) };
}

/**
 * 梗年鉴：封面 / 总量 / 最热的梗 / 它的诞生 / 凉掉的梗 / 结尾。
 * 时间范围与消息总数取自现有接口；「诞生」用首条精华消息还原。
 */
export async function deriveYearbook(filter: GlobalFilter, ports: DerivePorts): Promise<MemeYearbook> {
  const [top, volume] = await Promise.all([ports.cloud(filter, TOP_N), ports.volume()]);
  const topMemes = top.map((t) => ({ memeId: t.memeId, name: t.name, occurrences: t.occurrences }));
  const hottest = top[0];

  const hottestUnit = hottest === undefined ? null : await ports.unit(hottest.memeId);
  const birth = hottestUnit?.highlights[0];

  /** 时间范围：取头部梗的最早首现与最晚调用（没有梗时退回「—」）。 */
  const seenTimes = top.map((t) => Date.parse(t.firstSeenAt)).filter((n) => Number.isFinite(n));
  const usedTimes = top.map((t) => Date.parse(t.lastUsedAt)).filter((n) => Number.isFinite(n));
  const range = {
    start: seenTimes.length > 0 ? new Date(Math.min(...seenTimes)).toISOString().slice(0, 10) : '—',
    end: usedTimes.length > 0 ? new Date(Math.max(...usedTimes)).toISOString().slice(0, 10) : '—',
  };

  /**
   * 「火过又凉了」：在头部梗里挑最近调用距今最久、且次数不算少的那个。
   * 用「距今最久」而不是绝对时间，避免把刚采到的新梗误判成凉梗。
   */
  const now = Date.now();
  const faded = [...top]
    .map((t) => ({ ...t, silentDays: Math.round((now - Date.parse(t.lastUsedAt)) / 86_400_000) }))
    .filter((t) => t.occurrences >= Math.max(2, Math.round((hottest?.occurrences ?? 1) * 0.2)))
    .sort((a, b) => b.silentDays - a.silentDays)[0];

  const fadedUnit = faded === undefined ? null : await ports.unit(faded.memeId);
  const peak = (fadedUnit?.monthly ?? []).reduce<{ month: string; count: number } | null>(
    (best, bucket) => (best === null || bucket.count > best.count ? bucket : best),
    null,
  );

  return {
    groupName:
      filter.groupIds.length === 1 ? ports.groupName(filter.groupIds[0]!) : filter.groupIds.length === 0 ? '全部群聊' : `${filter.groupIds.length} 个群`,
    range,
    totalMessages: volume.messages,
    memeMessages: top.reduce((sum, t) => sum + t.occurrences, 0),
    ...(hottest === undefined ? {} : { topMeme: { memeId: hottest.memeId, name: hottest.name, occurrences: hottest.occurrences } }),
    ...(birth === undefined || hottest === undefined
      ? {}
      : {
          topMemeBirth: {
            memeName: hottest.name,
            senderName: birth.senderName,
            text: birth.text ?? '',
            sentAt: birth.sentAt,
            groupName: ports.groupName(filter.groupIds[0] ?? ''),
          },
        }),
    ...(faded === undefined
      ? {}
      : {
          fadedMeme: {
            memeId: faded.memeId,
            name: faded.name,
            occurrences: faded.occurrences,
            peakAt: faded.lastUsedAt,
            peakLabel: peak?.month ?? '',
            silentAt: faded.lastUsedAt,
            silentDays: faded.silentDays,
          },
        }),
    topMemes,
    // 数据够不够写年鉴：至少 3 个梗且最热的被用过 5 次
    enough: topMemes.length >= 3 && (hottest?.occurrences ?? 0) >= 5,
  };
}

/**
 * 群称号：由 Top10 梗确定性地拼一句（**不调用模型** —— 后端没有该接口，
 * 前端也不应为了一个标题去开一条新链路）。按「群 + 时间范围」缓存到 localStorage。
 */
export function deriveYearbookTitle(groupKey: string, topMemes: string[]): { title: string; cached: boolean } {
  const cacheKey = `mp:yearbook-title:${groupKey}`;
  try {
    const cached = globalThis.localStorage?.getItem(cacheKey);
    if (cached !== null && cached !== undefined && cached !== '') return { title: cached, cached: true };
  } catch {
    /* 隐私模式 / 配额满：退化为本次会话内计算 */
  }

  const seed = topMemes.join('');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const candidates = [
    '年度梗最密的群',
    '人均三个热梗的群',
    '梗不过夜的群',
    '每天都在造词的群',
    topMemes[0] === undefined ? '' : `${topMemes[0]} 一统江湖的群`,
  ].filter((t) => t !== '');

  const title = candidates[hash % candidates.length]!;
  try {
    globalThis.localStorage?.setItem(cacheKey, title);
  } catch {
    /* 写入失败不影响本次展示 */
  }
  return { title, cached: false };
}
