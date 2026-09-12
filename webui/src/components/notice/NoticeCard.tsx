/**
 * 通知卡片（Notice Card Unit）
 * 目标.md 详情页要求 → 卡片 heading：AI 一句话总结 + 来自哪个群 + 什么时间
 *                        卡片正文：AI 总结摘要 + 来源条数
 */
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, ChevronRight, CircleDashed, EyeOff, MapPin, Users } from 'lucide-react';
import { NOTICE_CATEGORY_LABEL, NOTICE_PRIORITY_LABEL, NOTICE_STATUS_LABEL, type NoticeItem, type NoticePriority, type NoticeStatus } from '@/types';
import { cn } from '@/lib/cn';
import { compactNum, deadlineHint, fmtMD } from '@/lib/format';
import { Badge, Card } from '@/components/ui';

const PRIORITY_TONE: Record<NoticePriority, 'coral' | 'amber' | 'sky' | 'neutral'> = {
  urgent: 'coral',
  high: 'amber',
  normal: 'sky',
  low: 'neutral',
};

const STATUS_ICON: Record<NoticeStatus, typeof CircleDashed> = {
  todo: CircleDashed,
  doing: CalendarClock,
  done: CheckCircle2,
  ignored: EyeOff,
  expired: AlertTriangle,
};

export function NoticeCard({
  notice,
  active,
  onOpen,
  onToggleStatus,
  compact,
  className,
}: {
  notice: NoticeItem;
  active?: boolean;
  onOpen: () => void;
  onToggleStatus?: (next: NoticeStatus) => void;
  compact?: boolean;
  className?: string;
}) {
  const dl = deadlineHint(notice.entities.deadline ? String(notice.entities.deadline) : null);
  const StatusIcon = STATUS_ICON[notice.status];

  return (
    <Card hover className={cn('flex flex-col gap-2.5 p-4', active && 'border-jade-500/50 ring-2 ring-jade-500/15', compact && 'p-3.5', className)} onClick={onOpen}>
      {/* heading 第一行：一句话总结 */}
      <h3 className="text-[14.5px] font-semibold leading-snug text-ink-800">{notice.headline}</h3>

      {/* heading 第二行：来自哪个群 + 什么时间 */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="mp-chip !py-0.5 !text-[11px]">{notice.chat}</span>
        <span className="mp-meta tabular-nums">{fmtMD(notice.time)}</span>
        <Badge tone="neutral">{NOTICE_CATEGORY_LABEL[notice.category]}</Badge>
        <Badge tone={PRIORITY_TONE[notice.priority]}>{NOTICE_PRIORITY_LABEL[notice.priority]}</Badge>
        {dl && <Badge tone={dl.overdue ? 'neutral' : dl.urgent ? 'coral' : 'jade'}>{dl.text}</Badge>}
      </div>

      {/* 正文：AI 总结 */}
      <p className={cn('text-xs leading-relaxed text-ink-500', compact ? 'line-clamp-2' : 'line-clamp-3')}>{notice.summary}</p>

      {/* 抽取到的关键要素 */}
      {(notice.entities.location || notice.entities.people?.length || notice.entities.event_time) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {notice.entities.event_time && (
            <span className="mp-meta inline-flex items-center gap-1">
              <CalendarClock size={11} /> {fmtMD(String(notice.entities.event_time))}
            </span>
          )}
          {notice.entities.location && (
            <span className="mp-meta inline-flex items-center gap-1">
              <MapPin size={11} /> {String(notice.entities.location)}
            </span>
          )}
          {notice.entities.people && notice.entities.people.length > 0 && (
            <span className="mp-meta inline-flex items-center gap-1">
              <Users size={11} /> {notice.entities.people.slice(0, 2).join('、')}
            </span>
          )}
        </div>
      )}

      {/* 底部：来源数 + 标签 + 状态切换 */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink-900/[0.06] pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge tone="violet">
            <BellRing size={10} />
            {notice.sources.length} 条来源
          </Badge>
          {notice.tags.slice(0, 2).map((t) => (
            <span key={t} className="mp-meta rounded bg-ink-900/[0.05] px-1.5 py-0.5">
              #{t}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onToggleStatus && notice.status !== 'done' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleStatus('done');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-jade-500/30 bg-jade-500/[0.08] px-2 py-0.5 text-[11px] font-medium text-jade-700 transition-colors hover:bg-jade-500/15"
            >
              <CheckCircle2 size={11} />
              标记完成
            </button>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-400">
            <StatusIcon size={11} />
            {NOTICE_STATUS_LABEL[notice.status]}
          </span>
          <ChevronRight size={13} className="text-ink-300" />
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* 通知时间轴单元（按天分组）—— 目标.md：按时间轴排列所有总结出来的消息            */
/* -------------------------------------------------------------------------- */
export function NoticeTimelineGroup({
  dateLabel,
  count,
  children,
  className,
}: {
  dateLabel: string;
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('relative pl-6', className)}>
      {/* 轴线 */}
      <span className="absolute bottom-0 left-[7px] top-2 w-px bg-ink-900/[0.09]" aria-hidden />
      <span className="absolute left-0 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-jade-500 ring-1 ring-jade-500/30" aria-hidden />
      <header className="mb-2 flex items-center gap-2">
        <h4 className="text-[13px] font-semibold text-ink-700">{dateLabel}</h4>
        <span className="mp-meta">{count} 条</span>
      </header>
      <div className="space-y-2.5 pb-5">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 待办紧凑行（总览页 / 通知页侧栏复用）                                          */
/* -------------------------------------------------------------------------- */
export function NoticeCompactRow({ notice, onOpen }: { notice: NoticeItem; onOpen: () => void }) {
  const dl = deadlineHint(notice.entities.deadline ? String(notice.entities.deadline) : null);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-jade-500/[0.06]">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', notice.priority === 'urgent' ? 'bg-coral-500' : notice.priority === 'high' ? 'bg-amber-500' : 'bg-jade-500')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink-700">{notice.headline}</span>
        <span className="mp-meta">
          {notice.chat} · {fmtMD(notice.time)}
        </span>
      </span>
      {dl && <span className={cn('shrink-0 text-[11px] tabular-nums', dl.overdue ? 'text-ink-400' : dl.urgent ? 'text-coral-500' : 'text-ink-400')}>{dl.text}</span>}
      <span className="mp-meta shrink-0">{compactNum(notice.sources.length)} 源</span>
    </button>
  );
}
