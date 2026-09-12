/**
 * 两人配对（API-022 / REQ-058、REQ-059、REQ-062）
 * =============================================================================
 * 共同爱好 + 契合度 + **逐维度差值**（雷达叠加对比）。
 * 契合度因子 = 共同标签数 + 置信度加权 + 实际互动 + 活跃度（只计一次，不重复计入 —— REQ-057）。
 * 不做时效衰减（REQ-086）；时间轴 / 事件流不参与权重（REQ-087）。
 */
import { HeartHandshake } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { INTEREST_CATEGORIES, INTEREST_CATEGORY_LABEL, type InterestCategory } from '@/types';
import { Badge, Card, ErrorState, LoadingState, NoticeBar } from '@/components/ui';
import { HobbyRadar } from '@/components/charts/Charts';

export function PairMatchPanel({ aId, bId }: { aId: string; bId: string }) {
  const match = useApi(() => api.pairMatch(aId, bId), [aId, bId]);
  const pa = useApi(() => api.personProfile(aId), [aId]);
  const pb = useApi(() => api.personProfile(bId), [bId]);

  if (aId === bId) return <NoticeBar tone="amber">请选择两个不同的人。</NoticeBar>;
  if (match.loading && !match.data) return <LoadingState label="正在计算契合度…" rows={2} />;
  if (match.error) return <ErrorState error={match.error} onRetry={match.refetch} className="!py-4" />;
  const m = match.data;
  if (!m) return null;

  return (
    <div className="space-y-3" data-testid="pair-match">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-ink-900/[0.07] bg-white/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-800">{m.personA.name}</span>
          <HeartHandshake size={14} className="text-jade-600" />
          <span className="text-sm font-semibold text-ink-800">{m.personB.name}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-jade-500/10 text-sm font-bold tabular-nums text-jade-700 ring-1 ring-jade-500/20" data-testid="compat-score">
            {m.compatibility.total}
          </div>
          <span className="mp-meta">契合度</span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-3.5">
          <div className="mp-section-title mb-2">契合度因子（活跃度只计一次）</div>
          <ul className="space-y-1.5">
            {m.compatibility.factors.map((f) => (
              <li key={f.key} className="flex items-center gap-2 text-xs">
                <span className="w-[132px] shrink-0 text-ink-600">{f.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
                  <span className="block h-full rounded-full bg-jade-500" style={{ width: `${Math.min(100, (f.value / 40) * 100)}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-ink-500">{f.value}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-3.5">
          <div className="mp-section-title mb-2">逐维度差值（雷达叠加对比 —— REQ-059）</div>
          {pa.data && pb.data ? (
            <HobbyRadar scores={pa.data.categoryScores} compare={{ name: pb.data.name, scores: pb.data.categoryScores }} height={240} />
          ) : (
            <LoadingState rows={1} label="正在读取两人维度分…" />
          )}
          <ul className="mt-2 grid grid-cols-1 gap-1">
            {INTEREST_CATEGORIES.map((c: InterestCategory) => {
              const cell = m.categoryDiff[c];
              return (
                <li key={c} className="flex items-center justify-between text-[11.5px] text-ink-600">
                  <span>{INTEREST_CATEGORY_LABEL[c]}</span>
                  <span className="tabular-nums">
                    {cell.a} / {cell.b}
                    <span className={cell.diff === 0 ? 'ml-2 text-ink-400' : cell.diff > 0 ? 'ml-2 text-jade-700' : 'ml-2 text-amber-700'}>
                      {cell.diff > 0 ? '+' : ''}
                      {cell.diff}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="p-3.5">
        <div className="mp-section-title mb-2">共同爱好（{m.sharedInterests.length}）</div>
        <div className="flex flex-wrap gap-1.5">
          {m.sharedInterests.map((s) => (
            <span key={s.tagId} className="mp-chip">
              {s.name}
              <Badge tone="neutral">{INTEREST_CATEGORY_LABEL[s.category]}</Badge>
            </span>
          ))}
          {!m.sharedInterests.length && <span className="mp-meta">两人暂无共同标签</span>}
        </div>
      </Card>
    </div>
  );
}
