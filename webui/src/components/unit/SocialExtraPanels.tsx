/**
 * 模块三的其余展示形态
 * =============================================================================
 * · 人-人关系图谱（REQ-069）：节点 = 人，连线 = 共同爱好；
 *   发言不足者**列入但零连线**（孤立节点），不用猜测的连线污染图谱（REQ-081）
 * · 兴趣时间轴 / 事件流（REQ-067）：回放兴趣的首现与兴衰；
 *   **仅可视化，不参与契合度权重计算**（REQ-087）
 */
import { useMemo, useState } from 'react';
import { Network, Search, Sparkles, Table2, TrendingUp, UserRound } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { fmtMD } from '@/lib/format';
import { INTEREST_CATEGORY_LABEL } from '@/types';
import { Badge, Card, CardHeader, ErrorState, LoadingState, NoticeBar } from '@/components/ui';
import { InterestEventTimeline, RelationGraphChart } from '@/components/charts/Charts';

export function RelationGraphPanel() {
  const graph = useApi(() => api.relationGraph(), []);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  /** 评审建议 3/8：前端过滤，不加后端接口 */
  const [onlyMine, setOnlyMine] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [tagQuery, setTagQuery] = useState('');

  const g = graph.data;

  /**
   * ⚠️ 所有 hook 必须在任何提前 return **之前**调用。
   * 这些 useMemo 早前写在 `if (!g) return null` 之后，导致数据到达前后
   * hook 数量不一致 → React 抛「Rendered more hooks than during the previous render」
   * 并整页崩溃。因此这里统一先取数据、再判断加载与错误。
   */
  const meId = g?.nodes.find((n) => n.isMe)?.personId;

  const filtered = useMemo(() => {
    if (!g) return { nodes: [], links: [] };
    let links = [...g.links];
    if (tagQuery.trim()) {
      const q = tagQuery.trim().toLowerCase();
      links = links.filter((l) => l.sharedInterests.some((t) => t.toLowerCase().includes(q)));
    }
    if (onlyMine && meId) links = links.filter((l) => l.source === meId || l.target === meId);

    if (nameQuery.trim()) {
      const q = nameQuery.trim().toLowerCase();
      const hit = new Set(g.nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.personId));
      // 姓名检索：保留命中的人 + 与他们直接相连的人，便于看清关系
      links = links.filter((l) => hit.has(l.source) || hit.has(l.target));
      const connected = new Set<string>(hit);
      links.forEach((l) => {
        connected.add(l.source);
        connected.add(l.target);
      });
      return { nodes: g.nodes.filter((n) => connected.has(n.personId)), links };
    }

    if (onlyMine || tagQuery.trim()) {
      // 过滤后只显示有关联的节点，避免留下一片无连线的孤立点
      const used = new Set<string>();
      links.forEach((l) => {
        used.add(l.source);
        used.add(l.target);
      });
      if (meId) used.add(meId);
      return { nodes: g.nodes.filter((n) => used.has(n.personId)), links };
    }
    return { nodes: g.nodes, links };
  }, [g, onlyMine, nameQuery, tagQuery, meId]);

  const pairs = useMemo(() => [...filtered.links].sort((a, b) => b.sharedCount - a.sharedCount), [filtered.links]);

  if (graph.loading && !g) return <LoadingState label="正在构建人-人关系图谱…" rows={2} />;
  if (graph.error) return <ErrorState error={graph.error} onRetry={graph.refetch} />;
  if (!g) return null;

  const unknownCount = g.nodes.filter((n) => n.unknown).length;
  const nameOf = (id: string) => g.nodes.find((n) => n.personId === id)?.name ?? id;

  return (
    <Card data-testid="relation-graph">
      <CardHeader
        title="人-人关系图谱"
        icon={Network}
        subtitle="节点 = 人，连线 = 共同爱好；用于看出小圈层。连线粗细与共同爱好数量相关"
        right={
          <div className="flex items-center gap-2">
            <span className="mp-meta">
              {filtered.nodes.length} / {g.nodes.length} 人 · {filtered.links.length} / {g.links.length} 组共同爱好
            </span>
            <div className="flex items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1">
              {(
                [
                  { k: 'graph', label: '图谱', icon: Network },
                  { k: 'list', label: '列表', icon: Table2 },
                ] as const
              ).map((v) => (
                <button
                  key={v.k}
                  type="button"
                  data-testid={`graph-view-${v.k}`}
                  onClick={() => setView(v.k)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    view === v.k ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  <v.icon size={13} />
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* 检索与快捷开关（评审建议 3、8）：全部为前端过滤 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-900/[0.06] px-4 py-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            data-testid="graph-name-search"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="按姓名筛选成员"
            className="w-[168px] rounded-xl border border-ink-900/[0.1] bg-white py-1.5 pl-8 pr-2.5 text-xs outline-none placeholder:text-ink-300 focus:border-jade-500/50"
          />
        </div>
        <div className="relative">
          <Sparkles size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            data-testid="graph-tag-search"
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="按兴趣标签筛选（如 羽毛球）"
            className="w-[210px] rounded-xl border border-ink-900/[0.1] bg-white py-1.5 pl-8 pr-2.5 text-xs outline-none placeholder:text-ink-300 focus:border-jade-500/50"
          />
        </div>
        <button
          type="button"
          data-testid="graph-only-mine"
          onClick={() => setOnlyMine((v) => !v)}
          className={
            'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-colors ' +
            (onlyMine ? 'border-jade-600 bg-jade-600 text-white' : 'border-ink-900/[0.1] text-ink-600 hover:border-jade-500/40')
          }
        >
          <UserRound size={12} />
          只显示自己关系
        </button>
        {(onlyMine || nameQuery || tagQuery) && (
          <button
            type="button"
            onClick={() => {
              setOnlyMine(false);
              setNameQuery('');
              setTagQuery('');
            }}
            className="mp-meta text-coral-500 hover:underline"
          >
            清除
          </button>
        )}
      </div>

      <div className="px-4 py-3.5">
        {view === 'graph' ? (
          <>
            <RelationGraphChart graph={filtered} height={520} />
            <p className="mp-meta mt-1">
              可拖拽节点、滚轮缩放。节点大小 ≈ 发言量；绿色为「我」，灰色为发言不足的成员（列入但零连线）。
            </p>
          </>
        ) : (
          <ul className="space-y-1.5" data-testid="graph-pairs">
            {pairs.slice(0, 30).map((l, i) => (
              <li key={`${l.source}-${l.target}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                <span className="text-xs font-medium text-ink-700">
                  {nameOf(l.source)} × {nameOf(l.target)}
                </span>
                <span className="mp-meta">共同爱好 {l.sharedCount} 项</span>
                <span className="flex flex-wrap gap-1">
                  {l.sharedInterests.map((t) => (
                    <span key={t} className="mp-chip !py-0.5 !text-[11px]">
                      {t}
                    </span>
                  ))}
                </span>
              </li>
            ))}
            {!pairs.length && <li className="mp-meta py-2">当前筛选下没有共同爱好达到 2 项的组合</li>}
          </ul>
        )}
        <NoticeBar tone="sky" className="mt-2 leading-relaxed">
          发言不足、不足以推断兴趣的成员（{unknownCount} 位）以灰色小节点**列入图谱但零连线**，
          不做推测、也不用猜测的连线污染图谱（REQ-081）。
        </NoticeBar>
      </div>
    </Card>
  );
}

export function InterestTimelinePanel() {
  const streams = useApi(() => api.interestEventStreams(), []);
  if (streams.loading && !streams.data) return <LoadingState label="正在读取兴趣事件流…" rows={2} />;
  if (streams.error) return <ErrorState error={streams.error} onRetry={streams.refetch} />;

  return (
    <Card data-testid="interest-timeline">
      <CardHeader
        title="兴趣时间轴 / 事件流"
        icon={TrendingUp}
        subtitle="兴趣也有首次出现时间与兴衰过程，可回放"
        right={<Badge tone="amber">仅可视化、不参与权重</Badge>}
      />
      <div className="px-4 py-3.5">
        <InterestEventTimeline streams={streams.data ?? []} />
        <ul className="mt-3 space-y-2">
          {(streams.data ?? []).slice(0, 5).map((s) => (
            <li key={s.tagId} className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles size={12} className="text-jade-600" />
                <span className="text-xs font-semibold text-ink-800">{s.name}</span>
                <Badge tone="neutral">{INTEREST_CATEGORY_LABEL[s.category]}</Badge>
                <span className="mp-meta">首现 {fmtMD(s.firstSeenAt)}</span>
                <span className="mp-meta ml-auto">{s.events.length} 个事件</span>
              </div>
            </li>
          ))}
        </ul>
        <NoticeBar tone="amber" className="mt-3 leading-relaxed">
          时间轴 / 事件流只用于回放兴衰过程，**不参与**契合度的权重计算，也不做时效衰减（REQ-086、REQ-087）。
        </NoticeBar>
      </div>
    </Card>
  );
}
