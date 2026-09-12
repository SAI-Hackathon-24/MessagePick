/**
 * 身份对齐（API-025 / API-026、DM-012 / REQ-082、AC-023）
 * =============================================================================
 * wechat-cli 只能提供群昵称 / 群名片，没有跨群稳定标识，因此跨群匹配依赖
 * **人工确认的映射表**：系统给出候选（结合通讯录 / 好友列表），使用者逐条确认 / 否定。
 * **未确认与已否定均不生效** —— 相关人在确认前按各自独立个体处理。
 */
import { Check, Link2, X } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { fmtMD } from '@/lib/format';
import { ALIGNMENT_STATUS_LABEL, SOURCE_LABEL } from '@/types';
import { Badge, Card, CardHeader, EmptyState, ErrorState, LoadingState, NoticeBar } from '@/components/ui';
import { Button } from '@/components/shell/Button';

export function IdentityAlignmentPanel() {
  const list = useApi(() => api.alignmentCandidates(), []);

  const decide = async (candidateId: string, decision: 'confirmed' | 'rejected') => {
    const res = await api.submitAlignment(candidateId, decision);
    if (res.ok) list.refetch();
  };

  if (list.loading && !list.data) return <LoadingState label="正在读取身份对齐候选…" rows={2} />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.refetch} />;

  return (
    <Card data-testid="identity-alignment">
      <CardHeader
        title="身份对齐"
        icon={Link2}
        subtitle="同一人在不同群里昵称不同时，逐条确认或否定候选映射；未确认的映射不生效"
      />
      <div className="space-y-3 px-4 py-3.5">
        <NoticeBar tone="sky" className="leading-relaxed">
          候选由系统结合通讯录 / 好友列表给出。确认后，两端的群成员会合并为同一个人，其兴趣、活跃度与回复时长随之合并计算；
          <strong>未确认与已否定都不会生效</strong>，相关人在确认前按各自独立个体处理（REQ-082）。
        </NoticeBar>

        <ul className="space-y-2">
          {(list.data ?? []).map((c) => (
            <li key={c.candidateId} className="rounded-2xl border border-ink-900/[0.07] bg-white/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {c.members.map((m, i) => (
                  <span key={m.memberId} className="inline-flex items-center gap-2">
                    {i > 0 && <span className="text-ink-300">=</span>}
                    <span className="text-xs font-semibold text-ink-800">{m.displayName}</span>
                    <span className="mp-meta">{m.groupName}</span>
                  </span>
                ))}
                <Badge tone="neutral">来源：{SOURCE_LABEL[c.source]}</Badge>
                <Badge tone={c.status === 'confirmed' ? 'jade' : c.status === 'rejected' ? 'coral' : 'amber'}>{ALIGNMENT_STATUS_LABEL[c.status]}</Badge>
                {c.confirmedAt && <span className="mp-meta">确认于 {fmtMD(c.confirmedAt)}</span>}
                <span className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant={c.status === 'confirmed' ? 'ghost' : 'primary'} icon={Check} onClick={() => void decide(c.candidateId, 'confirmed')} disabled={c.status === 'confirmed'}>
                    确认
                  </Button>
                  <Button size="sm" variant="outline" icon={X} onClick={() => void decide(c.candidateId, 'rejected')} disabled={c.status === 'rejected'}>
                    否定
                  </Button>
                </span>
              </div>
            </li>
          ))}
          {!(list.data ?? []).length && <li><EmptyState title="暂无身份对齐候选" description="候选由系统结合通讯录 / 好友列表生成；若通讯录来源不可用，会给出原因并可手动重试。" /></li>}
        </ul>
      </div>
    </Card>
  );
}
