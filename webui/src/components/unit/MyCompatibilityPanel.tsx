/**
 * 我的社交契合度（API-023 / REQ-079、REQ-057、REQ-058）
 * =============================================================================
 * 两个都要：①我 vs 每个群友的逐人契合度（列表）②我在群里的整体融入度（单一分数）。
 * 身份取自 Me 标识、无需手工设置（REQ-006）；身份未就绪时给提示 + 手动重试（AC-019）。
 */
import { Gauge, Users } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { Card, CardHeader, ErrorState, LoadingState, MiniStat, ProgressBar , BuildingState } from '@/components/ui';

export function MyCompatibilityPanel() {
  const mine = useApi(() => api.myCompatibility(), []);

  if (mine.loading && !mine.data) return <LoadingState label="正在计算我的社交契合度…" rows={2} />;
  // 构建中（IDENTITY_NOT_READY 是契约规定的正常中间态，不是失败）：改为等待提示
  if (mine.error?.code === 'IDENTITY_NOT_READY') return <BuildingState />;
  if (mine.error) return <ErrorState error={mine.error} onRetry={mine.refetch} />;
  const d = mine.data;
  if (!d) return null;

  return (
    <Card data-testid="my-compatibility">
      <CardHeader title="我的社交契合度" icon={Gauge} subtitle="逐人契合度列表 + 整体融入度；身份取自 Me 标识，无需手工设置" />
      <div className="space-y-4 px-4 py-3.5">
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat label="整体融入度" value={d.integration} tone="jade" />
          <MiniStat label="有契合度的群友" value={`${d.perPerson.length} 人`} />
          <MiniStat label="最高契合" value={d.perPerson[0] ? `${d.perPerson[0].name} ${d.perPerson[0].score}` : '—'} />
        </div>
        <div>
          <div className="mp-meta mb-1">整体融入度（单一分数）</div>
          <ProgressBar percent={d.integration} />
        </div>
        <div>
          <div className="mp-section-title mb-2 inline-flex items-center gap-1.5">
            <Users size={13} /> 逐人契合度
          </div>
          <ul className="space-y-1.5">
            {d.perPerson.map((p) => (
              <li key={p.personId} className="flex items-center gap-3">
                <span className="w-[92px] shrink-0 truncate text-xs font-medium text-ink-700">{p.name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
                  <span className={cn('block h-full rounded-full', p.score >= 60 ? 'bg-jade-500' : p.score >= 35 ? 'bg-amber-500' : 'bg-ink-300')} style={{ width: `${Math.min(100, p.score)}%` }} />
                </span>
                <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink-500">{p.score}</span>
                <span className="mp-meta w-16 shrink-0 text-right">共同 {p.sharedCount}</span>
              </li>
            ))}
          </ul>
          <p className="mp-meta mt-2">共 {num(d.perPerson.length)} 位群友；契合度 = 共同标签数 + 置信度加权 + 实际互动 + 活跃度（只计一次）。</p>
        </div>
      </div>
    </Card>
  );
}
