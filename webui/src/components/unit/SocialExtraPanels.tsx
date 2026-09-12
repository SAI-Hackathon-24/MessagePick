/**
 * 模块三的其余展示形态
 * =============================================================================
 * · 人-人关系图谱（REQ-069）：节点 = 人，连线 = 共同爱好；
 *   发言不足者**列入但零连线**（孤立节点），不用猜测的连线污染图谱（REQ-081）
 * · 兴趣时间轴 / 事件流（REQ-067）：回放兴趣的首现与兴衰；
 *   **仅可视化，不参与契合度权重计算**（REQ-087）
 */
import { useState } from 'react';
import { Network, Sparkles, Table2, TrendingUp } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { fmtMD } from '@/lib/format';
import { INTEREST_CATEGORY_LABEL } from '@/types';
import { Badge, Card, CardHeader, ErrorState, LoadingState, NoticeBar } from '@/components/ui';
import { InterestEventTimeline, RelationGraphChart } from '@/components/charts/Charts';

export function RelationGraphPanel() {
  const graph = useApi(() => api.relationGraph(), []);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  if (graph.loading && !graph.data) return <LoadingState label="正在构建人-人关系图谱…" rows={2} />;
  if (graph.error) return <ErrorState error={graph.error} onRetry={graph.refetch} />;
  const g = graph.data;
  if (!g) return null;
  const unknownCount = g.nodes.filter((n) => n.unknown).length;
  /** 按共同爱好数量排序的配对列表：与图谱等价、且可直接阅读 */
  const pairs = [...g.links].sort((a, b) => b.sharedCount - a.sharedCount);
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
              {g.nodes.length} 人 · {g.links.length} 组共同爱好
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
      <div className="px-4 py-3.5">
        {view === 'graph' ? (
          <>
            <RelationGraphChart graph={g} height={520} />
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
            {!pairs.length && <li className="mp-meta py-2">没有共同爱好达到 2 项的组合</li>}
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
