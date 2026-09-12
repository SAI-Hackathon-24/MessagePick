/**
 * 消息详情（REQ-048 / AC-021、AC-070）
 * =============================================================================
 * heading：AI 一句话总结 + 来源群 + 时间
 * 正文　：AI 总结 + 所有来源群消息（每条可回跳原文 —— REQ-007）
 * 附加　：消息涉及成员的**内联兴趣提示**（REQ-070；只含已确认数据，无数据时不显示提示）
 */
import { MessageSquareText, Sparkles, Users } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { fmtMD, fmtDayLabel } from '@/lib/format';
import { EXTRACT_TYPE_LABEL } from '@/types';
import { Avatar, Badge, Card, CardHeader, Drawer, ErrorState, LoadingState, SectionHeading } from '@/components/ui';
import { MessageBubble } from './MessageBubble';

export function MessageDetailDrawer({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const { claimDrawer, releaseDrawer } = useAppState();
  const detail = useApi(() => (id ? api.messageDetail(id) : Promise.resolve({ ok: true, data: null } as never)), [id]);
  const d = detail.data;

  /* 成员兴趣提示：由外壳组装（REQ-070、API-029）—— 无数据时不显示提示，也不弹错误 */
  const memberIds = (d?.body.messages ?? []).map((m) => m.senderId).filter(Boolean);
  const hints = useApi(() => api.memberInterestHints([...new Set(memberIds)]), [memberIds.join(',')]);

  useEffect(() => {
    if (!open || !id) return;
    const key = `message-detail:${id}`;
    claimDrawer(key);
    return () => releaseDrawer(key);
  }, [open, id, claimDrawer, releaseDrawer]);

  if (!open) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      kind="message-detail"
      title={d ? <span className="text-[15px] font-semibold leading-snug text-ink-800">{d.heading.summaryLine}</span> : '消息详情'}
      subtitle={
        d && (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {/* heading 三要素：一句话总结（标题）+ 来源群 + 时间 */}
            <span className="mp-chip !py-0.5 !text-[11px]">{d.heading.groupName}</span>
            <span className="tabular-nums">
              {fmtDayLabel(d.heading.sentAt)} {fmtMD(d.heading.sentAt).slice(-5)}
            </span>
            <Badge tone="neutral">共 {d.body.messages.length} 条来源消息</Badge>
          </span>
        )
      }
      footer={<span className="mp-meta">正文含该事项的全部来源群消息，按时间正序排列；每条均可回跳原文（REQ-007）。</span>}
    >
      {detail.loading && !d ? (
        <LoadingState label="正在读取消息详情…" rows={3} />
      ) : detail.error ? (
        <ErrorState error={detail.error} onRetry={detail.refetch} onBack={onClose} />
      ) : d ? (
        <div className="space-y-5">
          {/* 正文：AI 总结 */}
          <section className="rounded-2xl border border-jade-500/20 bg-jade-500/[0.06] px-4 py-3">
            <div className="mp-meta mb-1 inline-flex items-center gap-1 text-jade-700">
              <Sparkles size={12} /> AI 总结
            </div>
            <p className="text-sm leading-relaxed text-ink-700">{d.body.aiSummary}</p>
          </section>

          {/* 内联兴趣提示（REQ-070）：仅已确认数据；无数据时不显示 */}
          {(hints.data ?? []).some((h) => h.interests.length > 0 || h.unknown) && (
            <Card>
              <CardHeader title="涉及成员的兴趣提示" icon={Users} subtitle="只显示兴趣标签；发言不足的成员标注「未知」，不做推测" />
              <ul className="space-y-2 px-4 py-3.5">
                {(hints.data ?? []).map((h) => (
                  <li key={h.memberId} className="flex flex-wrap items-center gap-2">
                    <Avatar name={h.memberName} size={24} />
                    <span className="text-xs font-medium text-ink-700">{h.memberName}</span>
                    {h.unknown ? (
                      <Badge tone="neutral">未知（发言不足，不做推测）</Badge>
                    ) : (
                      h.interests.map((t) => (
                        <span key={t} className="mp-chip !py-0.5 !text-[11px]">
                          {t}
                        </span>
                      ))
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* 正文：所有来源群消息 */}
          <section>
            <SectionHeading title={`全部来源消息（${d.body.messages.length}）`} hint="按时间正序" />
            <ol className="space-y-3">
              {d.body.messages.map((m) => (
                <li key={m.id}>
                  <MessageBubble message={m} />
                </li>
              ))}
            </ol>
          </section>

          <div className="mp-meta flex items-center gap-2">
            <MessageSquareText size={12} />
            识别类型：{EXTRACT_TYPE_LABEL[Object.keys(EXTRACT_TYPE_LABEL)[0] as keyof typeof EXTRACT_TYPE_LABEL]} 等九类；本条目由 AI 提取并聚类。
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
