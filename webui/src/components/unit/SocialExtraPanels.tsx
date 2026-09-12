/**
 * 模块三的其余展示形态
 * =============================================================================
 * · 人-人关系图谱（REQ-069）：节点 = 人，连线 = 共同爱好；
 *   发言不足者**列入但零连线**（孤立节点），不用猜测的连线污染图谱（REQ-081）
 * · 兴趣时间轴 / 事件流（REQ-067）：回放兴趣的首现与兴衰；
 *   **仅可视化，不参与契合度权重计算**（REQ-087）
 */
import { Network, Sparkles, TrendingUp } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { fmtMD } from '@/lib/format';
import { INTEREST_CATEGORY_LABEL } from '@/types';
import { Badge, Card, CardHeader, ErrorState, LoadingState, NoticeBar , BuildingState } from '@/components/ui';
import { InterestEventTimeline, RelationGraphChart } from '@/components/charts/Charts';

export function RelationGraphPanel() {
  const graph = useApi(() => api.relationGraph(), []);
  if (graph.loading && !graph.data) return <LoadingState label="正在构建人-人关系图谱…" rows={2} />;
  // 构建中（IDENTITY_NOT_READY 是契约规定的正常中间态，不是失败）：改为等待提示
  if (graph.error?.code === 'IDENTITY_NOT_READY') return <BuildingState />;
  if (graph.error) return <ErrorState error={graph.error} onRetry={graph.refetch} />;
  const g = graph.data;
  if (!g) return null;
  const unknownCount = g.nodes.filter((n) => n.unknown).length;

  return (
    <Card data-testid="relation-graph">
      <CardHeader
        title="人-人关系图谱"
        icon={Network}
        subtitle="节点 = 人，连线 = 共同爱好；用于看出小圈层。连线粗细与共同爱好数量相关"
        right={<span className="mp-meta">{g.nodes.length} 节点 · {g.links.length} 连线</span>}
      />
      <div className="px-4 py-3.5">
        <RelationGraphChart graph={g} />
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
  // 构建中（IDENTITY_NOT_READY 是契约规定的正常中间态，不是失败）：改为等待提示
  if (streams.error?.code === 'IDENTITY_NOT_READY') return <BuildingState />;
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
