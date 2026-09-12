import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Check, ChevronDown, Layers, Users } from 'lucide-react';
import { GROUPS } from '@/api/mockData';
import { useAppState } from '@/app/appState';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';

/* -------------------------------------------------------------------------- */
/* 群选择器（多选）—— 所有页面的「分析范围」入口                                 */
/* -------------------------------------------------------------------------- */
export function GroupSelector() {
  const { chats, setChats, toggleChat } = useAppState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const label = chats.length === 0 ? '全部群聊' : chats.length === 1 ? chats[0] : `已选 ${chats.length} 个群`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-jade-500/40',
          open && 'border-jade-500/50 ring-2 ring-jade-500/15',
        )}
      >
        <Layers size={15} className="text-jade-600" />
        <span className="max-w-[180px] truncate">{label}</span>
        <ChevronDown size={14} className={cn('text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(340px,calc(100vw-2rem))] animate-fade-up overflow-hidden rounded-2xl border border-ink-900/[0.08] bg-white shadow-card-hover">
          <div className="flex items-center justify-between border-b border-ink-900/[0.06] px-3 py-2">
            <span className="mp-meta">分析范围 · 可多选</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => setChats([])} className="rounded-md px-2 py-1 text-[11px] text-jade-700 hover:bg-jade-500/10">
                全部
              </button>
              <button type="button" onClick={() => setChats(GROUPS.filter((g) => g.username.includes('@chatroom')).map((g) => g.chat))} className="rounded-md px-2 py-1 text-[11px] text-ink-500 hover:bg-ink-900/[0.05]">
                仅群聊
              </button>
            </div>
          </div>
          <ul className="max-h-[320px] overflow-y-auto py-1">
            {GROUPS.map((g) => {
              const on = chats.includes(g.chat);
              return (
                <li key={g.chat}>
                  <button
                    type="button"
                    data-chat={g.chat}
                    onClick={() => toggleChat(g.chat)}
                    className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-jade-500/[0.06]', on && 'bg-jade-500/[0.08]')}
                  >
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors', on ? 'border-jade-600 bg-jade-600 text-white' : 'border-ink-300')}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-jade-500/12 text-xs font-semibold text-jade-700">{g.avatar}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink-700">{g.chat}</span>
                      <span className="mp-meta">
                        {g.subject} · {g.memberCount} 人
                      </span>
                    </span>
                    <Users size={13} className="shrink-0 text-ink-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 时间范围选择 —— 预设 + 自定义                                                 */
/* -------------------------------------------------------------------------- */
const PRESETS = [
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: '90d', label: '近 90 天', days: 90 },
  { key: 'all', label: '全部', days: 0 },
] as const;

export function TimeRangePicker() {
  const { range, setRange } = useAppState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = useMemo(() => PRESETS.find((p) => p.days === 0 && !range.start)?.key ?? '', [range.start]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const applyPreset = (days: number) => {
    if (days === 0) {
      setRange({ start: '2026-03-01', end: '2026-06-09' });
    } else {
      const end = new Date('2026-06-09T00:00:00+08:00');
      const start = new Date(end.getTime() - days * 86400000);
      setRange({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-jade-500/40',
          open && 'border-jade-500/50 ring-2 ring-jade-500/15',
        )}
      >
        <CalendarRange size={15} className="text-jade-600" />
        <span className="tabular-nums">
          {range.start.slice(5)} ~ {range.end.slice(5)}
        </span>
        <ChevronDown size={14} className={cn('text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(280px,calc(100vw-2rem))] animate-fade-up rounded-2xl border border-ink-900/[0.08] bg-white p-3 shadow-card-hover">
          <div className="mp-meta mb-2">快捷范围</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.days)}
                className={cn('rounded-lg border border-ink-900/[0.08] px-2.5 py-1 text-xs text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700', active === p.key && 'border-jade-500/50 bg-jade-500/10 text-jade-700')}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mp-meta mt-3 mb-1.5">自定义（含异常分支：起止倒置会被拦截）</div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={range.start}
              onChange={(e) => {
                const v = e.target.value;
                setRange({ start: v, end: v > range.end ? v : range.end });
              }}
              className="w-full rounded-lg border border-ink-900/[0.1] bg-white px-2 py-1.5 text-xs tabular-nums text-ink-700 outline-none focus:border-jade-500/50"
            />
            <span className="text-ink-300">~</span>
            <input
              type="date"
              value={range.end}
              onChange={(e) => {
                const v = e.target.value;
                setRange({ start: v < range.start ? v : range.start, end: v });
              }}
              className="w-full rounded-lg border border-ink-900/[0.1] bg-white px-2 py-1.5 text-xs tabular-nums text-ink-700 outline-none focus:border-jade-500/50"
            />
          </div>
          <button type="button" onClick={() => setOpen(false)} className="mt-3 w-full rounded-lg bg-ink-900 py-1.5 text-xs font-medium text-white hover:bg-ink-800">
            应用（{range.start} ~ {range.end}）
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 演示场景切换（空态 / 失败态 / 慢速）—— 评审时用于走查异常分支                    */
/* -------------------------------------------------------------------------- */
export function SimSwitcher() {
  const { sim, setSim } = useAppState();
  const opts = [
    { key: 'off', label: '正常' },
    { key: 'empty', label: '空态' },
    { key: 'error', label: '失败态' },
    { key: 'slow', label: '慢速' },
  ] as const;
  return (
    <div className="hidden items-center gap-1 rounded-xl border border-ink-900/[0.08] bg-white/70 p-1 lg:flex">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setSim(o.key)}
          className={cn('rounded-lg px-2 py-1 text-[11px] font-medium transition-colors', sim === o.key ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-900/[0.05]')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 数据来源说明条（诚实标注 mock / wechat-cli）                                  */
/* -------------------------------------------------------------------------- */
export function DataSourceBadge() {
  return (
    <Badge tone="amber" className="hidden xl:inline-flex" >
      演示数据 · mock（接口已预留）
    </Badge>
  );
}
