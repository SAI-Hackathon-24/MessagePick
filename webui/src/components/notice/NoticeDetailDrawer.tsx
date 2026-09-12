import { useState } from 'react';
import { BellRing, CalendarClock, Check, Clock3, CornerDownRight, Copy, ExternalLink, MapPin, Sparkles, Users } from 'lucide-react';
import { NOTICE_CATEGORY_LABEL, NOTICE_PRIORITY_LABEL, NOTICE_STATUS_LABEL, type NoticeItem, type NoticeStatus } from '@/types';
import { cn } from '@/lib/cn';
import { deadlineHint, fmtDayLabel, fmtMD } from '@/lib/format';
import { Avatar, Badge, Drawer, NoticeBar } from '@/components/ui';

/**
 * 通知详情抽屉
 * ---------------------------------------------------------------------------
 * 目标.md 明确要求详情页包含：
 *   heading：AI 一句话总结 + 来自哪个群 + 什么时间
 *   正文：AI 总结 + 所有群消息来源
 * 额外提供：要素表、待办状态流转、复制摘要、跳转原消息（占位）
 */
export function NoticeDetailDrawer({
  notice,
  open,
  onClose,
  onStatusChange,
}: {
  notice: NoticeItem | null;
  open: boolean;
  onClose: () => void;
  onStatusChange: (id: string, status: NoticeStatus) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!notice) return null;

  const dl = deadlineHint(notice.entities.deadline ? String(notice.entities.deadline) : null);
  const entityRows = Object.entries(notice.entities).filter(([, v]) => v !== undefined && v !== null && v !== '');

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(`${notice.headline}\n\n${notice.summary}\n\n来源：${notice.chat}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={<span className="text-[15px] font-semibold leading-snug text-ink-800">{notice.headline}</span>}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="mp-chip !py-0.5 !text-[11px]">{notice.chat}</span>
          <span className="tabular-nums">{fmtDayLabel(notice.time)} {fmtMD(notice.time).slice(-5)}</span>
          <Badge tone="neutral">{NOTICE_CATEGORY_LABEL[notice.category]}</Badge>
          <Badge tone={notice.priority === 'urgent' ? 'coral' : notice.priority === 'high' ? 'amber' : 'sky'}>{NOTICE_PRIORITY_LABEL[notice.priority]}</Badge>
          {dl && <Badge tone={dl.overdue ? 'neutral' : dl.urgent ? 'coral' : 'jade'}>{dl.text}</Badge>}
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {(['todo', 'doing', 'done', 'ignored'] as NoticeStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onStatusChange(notice.id, s)}
                className={cn('mp-chip', notice.status === s && 'mp-chip-active')}
              >
                {notice.status === s && <Check size={11} />}
                {NOTICE_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <button type="button" onClick={copySummary} className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700">
            <Copy size={12} />
            {copied ? '已复制' : '复制摘要'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* AI 总结（正文） */}
        <section className="rounded-2xl border border-jade-500/20 bg-jade-500/[0.06] px-4 py-3">
          <div className="mp-meta mb-1 inline-flex items-center gap-1 text-jade-700">
            <Sparkles size={12} /> AI 总结
          </div>
          <p className="text-sm leading-relaxed text-ink-700">{notice.summary}</p>
          <p className="mp-meta mt-2">
            抽取自 {notice.sources.length} 条原始消息{notice.confidence !== undefined && ` · 模型置信度 ${(notice.confidence * 100).toFixed(0)}%`}
          </p>
          <div className="mp-meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {notice.entities.event_time && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock size={11} /> {fmtMD(String(notice.entities.event_time))}
                </span>
              )}
              {notice.entities.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={11} /> {String(notice.entities.location)}
                </span>
              )}
              {notice.entities.people && notice.entities.people.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Users size={11} /> {notice.entities.people.join('、')}
                </span>
              )}
            </div>
        </section>

        {/* 关键要素 */}
        <section>
          <div className="mp-section-title mb-2">抽取到的关键要素</div>
          <dl className="grid grid-cols-2 gap-2">
            {entityRows.map(([k, v]) => (
              <div key={k} className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                <dt className="mp-meta">{ENTITY_LABEL[k] ?? k}</dt>
                <dd className="mt-0.5 text-xs font-medium text-ink-700">{Array.isArray(v) ? v.join(' / ') : typeof v === 'object' ? JSON.stringify(v) : fmtEntityValue(k, String(v))}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 提醒能力（占位） */}
        <section className="flex flex-wrap items-center gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700">
            <BellRing size={12} />
            {notice.reminded ? '已设置提醒' : '设置提醒'}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700">
            <ExternalLink size={12} />
            跳转原消息
          </button>
          {notice.remind_at && <span className="mp-meta">建议提醒时间：{fmtMD(notice.remind_at)}</span>}
        </section>

        {/* 所有群消息来源（目标.md 要求） */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="mp-section-title">所有群消息来源（{notice.sources.length}）</div>
            <span className="mp-meta inline-flex items-center gap-1">
              <Clock3 size={11} /> 按时间正序
            </span>
          </div>
          <ol className="relative space-y-3 pl-1">
            <span className="absolute bottom-2 left-[15px] top-2 w-px bg-ink-900/[0.09]" aria-hidden />
            {notice.sources.map((s) => (
              <li key={s.id} className="relative flex gap-3">
                <Avatar name={s.sender} size={30} className="z-10 shrink-0" />
                <div className="min-w-0 flex-1 rounded-xl border border-ink-900/[0.06] bg-white/80 px-3 py-2">
                  <div className="mp-meta flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-600">{s.sender}</span>
                    <span className="tabular-nums">{s.time}</span>
                    <span className="rounded bg-ink-900/[0.05] px-1.5 py-0.5">{s.chat}</span>
                    {s.type !== 'text' && <Badge tone="amber">{s.type}</Badge>}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-700">{s.text}</p>
                  {s.type === 'image' && (
                    <div className="mt-2 flex h-20 items-center justify-center rounded-lg border border-dashed border-ink-900/15 bg-ink-900/[0.03] text-[11px] text-ink-400">
                      [图片] 演示环境不渲染真实图片（wechat-cli --media 可解密原图）
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <NoticeBar className="flex items-start gap-2">
          <CornerDownRight size={13} className="mt-0.5 shrink-0" />
          <span>
            来源归属口径：同一事项在群内被反复提起时会被聚合成一张卡片；当前共有 {notice.sources.length} 条原始消息指向本事项。
            接入真实后端后，此处将展示 wechat-cli 返回的原始消息行与 local_id，可一键跳转。
          </span>
        </NoticeBar>
      </div>
    </Drawer>
  );
}

const ENTITY_LABEL: Record<string, string> = {
  subject: '事项',
  event_time: '时间',
  deadline: '截止时间',
  location: '地点',
  people: '相关人',
  amount: '金额',
  current: '当前进度',
  options: '候选项',
  materials: '所需材料',
};

function fmtEntityValue(key: string, value: string) {
  if (key === 'deadline' || key === 'event_time') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return fmtMD(t);
  }
  return value;
}
