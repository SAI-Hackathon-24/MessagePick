/**
 * 全局筛选条（REQ-004、api-contract §1.3）
 * =============================================================================
 * 全应用唯一的筛选控件：群多选 · 时间范围 · 关键词 · 当前用户身份。
 * 一行控件，统一作用于三个模块的所有视图；各模块不得自建同类筛选控件（REQ-049）。
 * · 关键词的匹配对象随所在模块变化（REQ-005），因此在控件上直接标注。
 * · 身份取自 wechat-cli 的 Me 标识、无需手工设置（REQ-006）：
 *   界面只展示身份与「我相关」视角开关，不提供手工输入。
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarRange, Check, ChevronDown, Layers, Search, UserRound, X } from 'lucide-react';
import { useAppState } from '@/state/appState';
import { cn } from '@/lib/cn';
import { Chip } from '@/components/ui';

export function GlobalFilterBar({ meName }: { meName?: string }) {
  const { filter, setFilter, clearFilter, groups } = useAppState();
  const [openGroups, setOpenGroups] = useState(false);
  const [openTime, setOpenTime] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setOpenGroups(false);
      if (timeRef.current && !timeRef.current.contains(e.target as Node)) setOpenTime(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const groupLabel = filter.groupIds.length === 0 ? '全部群' : filter.groupIds.length === 1 ? (groups.find((g) => g.id === filter.groupIds[0])?.name ?? '1 个群') : `已选 ${filter.groupIds.length} 个群`;
  const timeLabel = !filter.timeRange.start && !filter.timeRange.end ? '全部时间' : `${filter.timeRange.start?.slice(5) ?? '最早'} ~ ${filter.timeRange.end?.slice(5) ?? '最新'}`;
  const hasFilter = filter.groupIds.length > 0 || !!filter.timeRange.start || !!filter.timeRange.end || !!filter.keyword;

  const toggleGroup = (id: string) => setFilter({ groupIds: filter.groupIds.includes(id) ? filter.groupIds.filter((x) => x !== id) : [...filter.groupIds, id] });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="global-filter">
      <span className="mp-meta hidden lg:inline">全局筛选</span>

      {/* 群多选 */}
      <div className="relative" ref={groupRef}>
        <button
          type="button"
          data-testid="filter-groups"
          onClick={() => setOpenGroups((o) => !o)}
          className={cn('flex items-center gap-2 rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:border-jade-500/40', openGroups && 'border-jade-500/50 ring-2 ring-jade-500/15')}
        >
          <Layers size={13} className="text-jade-600" />
          <span className="max-w-[140px] truncate">{groupLabel}</span>
          <ChevronDown size={12} className={cn('text-ink-400 transition-transform', openGroups && 'rotate-180')} />
        </button>
        {openGroups && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(320px,calc(100vw-2rem))] animate-fade-up overflow-hidden rounded-2xl border border-ink-900/[0.08] bg-white shadow-card-hover">
            <div className="flex items-center justify-between border-b border-ink-900/[0.06] px-3 py-2">
              <span className="mp-meta">群多选 · 空 = 不限</span>
              <button type="button" onClick={() => setFilter({ groupIds: [] })} className="rounded-md px-2 py-1 text-[11px] text-jade-700 hover:bg-jade-500/10">
                全不选
              </button>
            </div>
            <ul className="max-h-[300px] overflow-y-auto py-1">
              {groups.map((g) => {
                const on = filter.groupIds.includes(g.id);
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      data-group-option={g.id}
                      onClick={() => toggleGroup(g.id)}
                      className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-jade-500/[0.06]', on && 'bg-jade-500/[0.08]')}
                    >
                      <span className={cn('flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors', on ? 'border-jade-600 bg-jade-600 text-white' : 'border-ink-300')}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">{g.name}</span>
                    </button>
                  </li>
                );
              })}
              {!groups.length && <li className="mp-meta px-3 py-3">尚无群：请先完成一次「更新数据」。</li>}
            </ul>
          </div>
        )}
      </div>

      {/* 时间范围 */}
      <div className="relative" ref={timeRef}>
        <button
          type="button"
          data-testid="filter-time"
          onClick={() => setOpenTime((o) => !o)}
          className={cn('flex items-center gap-2 rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:border-jade-500/40', openTime && 'border-jade-500/50 ring-2 ring-jade-500/15')}
        >
          <CalendarRange size={13} className="text-jade-600" />
          <span className="tabular-nums">{timeLabel}</span>
          <ChevronDown size={12} className={cn('text-ink-400 transition-transform', openTime && 'rotate-180')} />
        </button>
        {openTime && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(300px,calc(100vw-2rem))] animate-fade-up rounded-2xl border border-ink-900/[0.08] bg-white p-3 shadow-card-hover">
            <div className="flex items-center gap-2">
              <input
                type="date"
                data-testid="filter-time-start"
                value={filter.timeRange.start?.slice(0, 10) ?? ''}
                onChange={(e) => setFilter({ timeRange: { ...filter.timeRange, start: e.target.value || undefined } })}
                className="w-full rounded-lg border border-ink-900/[0.1] px-2 py-1.5 text-xs tabular-nums text-ink-700 outline-none focus:border-jade-500/50"
              />
              <span className="text-ink-300">~</span>
              <input
                type="date"
                data-testid="filter-time-end"
                value={filter.timeRange.end?.slice(0, 10) ?? ''}
                onChange={(e) => setFilter({ timeRange: { ...filter.timeRange, end: e.target.value || undefined } })}
                className="w-full rounded-lg border border-ink-900/[0.1] px-2 py-1.5 text-xs tabular-nums text-ink-700 outline-none focus:border-jade-500/50"
              />
            </div>
            <p className="mp-meta mt-2">空 = 不限。时间口径以来源消息的发送时间为基准。</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: '近 30 天', days: 30 },
                { label: '近 90 天', days: 90 },
                { label: '全部', days: 0 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    if (p.days === 0) setFilter({ timeRange: {} });
                    else {
                      const end = new Date('2026-06-30T00:00:00+08:00');
                      const start = new Date(end.getTime() - p.days * 86400000);
                      setFilter({ timeRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) } });
                    }
                    setOpenTime(false);
                  }}
                  className="rounded-lg border border-ink-900/[0.08] px-2.5 py-1 text-[11px] text-ink-600 hover:border-jade-500/40 hover:text-jade-700"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 关键词（匹配对象随模块变化 —— REQ-005） */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300" />
        <input
          data-testid="filter-keyword"
          value={filter.keyword}
          onChange={(e) => setFilter({ keyword: e.target.value })}
          placeholder="关键词"
          className="w-[190px] rounded-xl border border-ink-900/[0.08] bg-white/80 py-1.5 pl-8 pr-7 text-xs text-ink-700 outline-none transition-all placeholder:text-ink-300 focus:w-[240px] focus:border-jade-500/50 focus:ring-2 focus:ring-jade-500/12"
        />
        {filter.keyword && (
          <button type="button" aria-label="清除关键词" onClick={() => setFilter({ keyword: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600">
            <X size={12} />
          </button>
        )}
      </div>

      {/* 身份（REQ-006：取自 Me 标识，不提供手工设置） */}
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white/80 px-2.5 py-1.5 text-xs text-ink-600" title="身份取自 wechat-cli 的 Me 标识，无需手工设置">
        <UserRound size={13} className="text-jade-600" />
        我：{meName ?? (filter.meId ? filter.meId : '未就绪')}
      </span>

      {hasFilter && (
        <Chip onClick={clearFilter} className="!border-coral-500/30 !text-coral-500" title="一键清除全部筛选条件">
          <X size={11} /> 清除筛选
        </Chip>
      )}

    </div>
  );
}
