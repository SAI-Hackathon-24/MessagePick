/**
 * 全局筛选条（REQ-004、api-contract §1.3）
 * =============================================================================
 * 全应用唯一的筛选控件：群多选 · 时间范围 · 关键词 · 当前用户身份。
 * 一行控件，统一作用于三个模块的所有视图；各模块不得自建同类筛选控件（REQ-049）。
 * · 关键词的匹配对象随所在模块变化（REQ-005），因此在控件上直接标注。
 * · 身份取自 wechat-cli 的 Me 标识、无需手工设置（REQ-006）：
 *   值不提供手工输入；视角开关可切「我（我相关）/ 全局」，默认全局。
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, Check, CheckCircle2, ChevronDown, Layers, Loader2, Play, Search, UserRound, X } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { cn } from '@/lib/cn';
import { KEYWORD_SCOPE } from '@/types';
import { Badge, Chip } from '@/components/ui';

export function GlobalFilterBar({ meName }: { meName?: string }) {
  const { filter, setFilter, clearFilter, groups, setModule, identityMode, setIdentityMode, status } = useAppState();
  const [openGroups, setOpenGroups] = useState(false);
  const [openTime, setOpenTime] = useState(false);
  const [openIdentity, setOpenIdentity] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  const [watchingAnalysis, setWatchingAnalysis] = useState(false);
  const [analysisChip, setAnalysisChip] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [analysisDetail, setAnalysisDetail] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState('');
  const groupRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const identityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setOpenGroups(false);
      if (timeRef.current && !timeRef.current.contains(e.target as Node)) setOpenTime(false);
      if (identityRef.current && !identityRef.current.contains(e.target as Node)) setOpenIdentity(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const groupLabel = filter.groupIds.length === 0 ? '全部群' : filter.groupIds.length === 1 ? (groups.find((g) => g.id === filter.groupIds[0])?.name ?? '1 个群') : `已选 ${filter.groupIds.length} 个群`;
  const timeLabel = !filter.timeRange.start && !filter.timeRange.end ? '全部时间' : `${filter.timeRange.start?.slice(5) ?? '最早'} ~ ${filter.timeRange.end?.slice(5) ?? '最新'}`;
  /* 身份值始终取自 API-002 的 Me 标识（与当前视角开关无关，避免全局模式下误显示「未就绪」） */
  const meLabel = meName ?? status?.meId ?? '未就绪';
  const identityLabel = identityMode === 'me' ? `我：${meLabel}` : '身份：全局';
  const hasFilter = filter.groupIds.length > 0 || !!filter.timeRange.start || !!filter.timeRange.end || !!filter.keyword || identityMode === 'me';

  const toggleGroup = (id: string) => setFilter({ groupIds: filter.groupIds.includes(id) ? filter.groupIds.filter((x) => x !== id) : [...filter.groupIds, id] });

  /** 按需分析：对当前筛选的群（未选群 = 全部群）触发梗分析 + 信息提取（后台执行）。 */
  const runAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeMsg(null);
    setAnalysisChip('idle');
    const res = await api.analyze(filter.groupIds);
    setAnalyzing(false);
    if (!res.ok || !res.data) {
      setAnalyzeMsg(`分析未启动：${res.error?.message ?? '未知错误'}`);
      return;
    }
    setWatchingAnalysis(true);
    setAnalyzeMsg(`已开始分析（${res.data.scope}）· 稍后刷新看结果`);
    setTimeout(() => setAnalyzeMsg(null), 8_000);
  };

  /* 挂载探询：刷新页面时若分析仍在后台进行，继续跟随其状态 */
  useEffect(() => {
    let cancelled = false;
    void api.operations().then((res) => {
      if (cancelled || !res.ok || !res.data) return;
      const running = res.data.some((op) => op.kind === 'warmup' && (op.state === 'queued' || op.state === 'running'));
      if (running) setWatchingAnalysis(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 分析状态轮询：运行中显示转圈图标；结束后呈现「完成 / 有失败」（提示性旁路，出错静默降速） */
  useEffect(() => {
    if (!watchingAnalysis) return;
    let disposed = false;
    let timer: number | undefined;
    let sawRunning = false;
    let polls = 0;
    const observed = new Set<string>();

    const poll = async (): Promise<void> => {
      const res = await api.operations();
      if (disposed) return;
      if (!res.ok || !res.data) {
        timer = window.setTimeout(() => void poll(), 3_000);
        return;
      }
      polls += 1;
      const warmups = res.data.filter((op) => op.kind === 'warmup');
      const running = warmups.filter((op) => op.state === 'queued' || op.state === 'running');
      if (running.length > 0) {
        sawRunning = true;
        for (const op of running) observed.add(op.id);
        setAnalysisDetail([...new Set(running.map((op) => op.scope))].join(' · '));
        /* 进度摘要：折算「梗·识别 3/14」式段位（无分母的操作不显示）；相同段位去重 */
        const segments = [
          ...new Set(
            running.flatMap((op) => {
              if (op.counts.total === undefined || op.counts.total === 0) return [];
              const short = op.scope.includes('梗') ? '梗' : op.scope.includes('信息') ? '提取' : op.scope;
              return [`${short}${op.phase === undefined ? '' : `·${op.phase}`} ${op.counts.done}/${op.counts.total}`];
            }),
          ),
        ];
        const earliest = Math.min(...running.map((op) => op.startedAt));
        const minutes = Math.floor((Date.now() - earliest) / 60_000);
        setAnalysisProgress([...segments, ...(minutes >= 1 ? [`已 ${minutes} 分`] : [])].join(' · '));
        setAnalysisChip('running');
        timer = window.setTimeout(() => void poll(), 2_000);
        return;
      }
      /* 第一轮可能早于操作登记；未见过运行态且只查了一轮时，再多等一拍再结算 */
      if (!sawRunning && polls < 2) {
        timer = window.setTimeout(() => void poll(), 1_000);
        return;
      }
      /* 结算：以观察到的操作（或最近一对）的终态判定「完成 / 有失败」 */
      const inspected = observed.size > 0 ? warmups.filter((op) => observed.has(op.id)) : warmups.slice(-2);
      const failed = inspected.some((op) => op.state === 'failed' || op.state === 'partial');
      setAnalysisChip(failed ? 'failed' : 'done');
      setWatchingAnalysis(false);
    };

    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [watchingAnalysis]);

  /* 「完成 / 有失败」展示 20 秒后自动隐去；新一轮分析开始时立即覆盖 */
  useEffect(() => {
    if (analysisChip !== 'done' && analysisChip !== 'failed') return;
    const timer = window.setTimeout(() => setAnalysisChip('idle'), 20_000);
    return () => window.clearTimeout(timer);
  }, [analysisChip]);

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
          placeholder={`关键词（匹配${KEYWORD_SCOPE[filter.module]}）`}
          className="w-[190px] rounded-xl border border-ink-900/[0.08] bg-white/80 py-1.5 pl-8 pr-7 text-xs text-ink-700 outline-none transition-all placeholder:text-ink-300 focus:w-[240px] focus:border-jade-500/50 focus:ring-2 focus:ring-jade-500/12"
        />
        {filter.keyword && (
          <button type="button" aria-label="清除关键词" onClick={() => setFilter({ keyword: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600">
            <X size={12} />
          </button>
        )}
      </div>

      {/* 身份（REQ-006：值取自 Me 标识、不提供手工输入；视角可切「我相关 / 全局」，默认全局） */}
      <div className="relative" ref={identityRef}>
        <button
          type="button"
          data-testid="filter-identity"
          onClick={() => setOpenIdentity((o) => !o)}
          className={cn('flex items-center gap-2 rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:border-jade-500/40', openIdentity && 'border-jade-500/50 ring-2 ring-jade-500/15')}
          title="身份值取自 wechat-cli 的 Me 标识，无需手工输入；可切换「我相关」或全局视角"
        >
          <UserRound size={13} className="text-jade-600" />
          <span className="max-w-[150px] truncate">{identityLabel}</span>
          <ChevronDown size={12} className={cn('text-ink-400 transition-transform', openIdentity && 'rotate-180')} />
        </button>
        {openIdentity && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(250px,calc(100vw-2rem))] animate-fade-up overflow-hidden rounded-2xl border border-ink-900/[0.08] bg-white shadow-card-hover">
            <div className="border-b border-ink-900/[0.06] px-3 py-2">
              <span className="mp-meta">身份视角 · 值来自 Me 标识</span>
            </div>
            <ul className="py-1">
              {(
                [
                  { k: 'global' as const, label: '全局（不限）', hint: '不按身份过滤，查看所有数据' },
                  { k: 'me' as const, label: `我：${meLabel}`, hint: '只看与我相关的梗与数据' },
                ]
              ).map((opt) => {
                const on = identityMode === opt.k;
                return (
                  <li key={opt.k}>
                    <button
                      type="button"
                      data-identity-option={opt.k}
                      onClick={() => {
                        setIdentityMode(opt.k);
                        setOpenIdentity(false);
                      }}
                      className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-jade-500/[0.06]', on && 'bg-jade-500/[0.08]')}
                    >
                      <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors', on ? 'border-jade-600 bg-jade-600 text-white' : 'border-ink-300')}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink-700">{opt.label}</span>
                        <span className="mp-meta block truncate">{opt.hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* 按需分析（非契约入口）；作用范围 = 当前筛选的群 */}
      <button
        type="button"
        data-testid="run-analysis"
        onClick={() => void runAnalyze()}
        disabled={analyzing}
        title="对当前筛选的群（未选群 = 全部群）触发梗分析 + 信息提取"
        className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-ink-800 disabled:opacity-60"
      >
        <Play size={12} className={analyzing ? 'animate-pulse' : undefined} />
        {analyzing ? '提交中…' : filter.groupIds.length > 0 ? `分析选中 ${filter.groupIds.length} 个群` : '分析全部群'}
      </button>
      {analysisChip !== 'idle' && (
        <span
          data-testid="analysis-status"
          title={
            analysisChip === 'running'
              ? `后台分析进行中：${analysisDetail || '梗分析 + 信息提取'}`
              : analysisChip === 'done'
                ? '后台分析已完成；刷新页面可见最新结果'
                : '后台分析有失败分片；可再次点击「分析」重试'
          }
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium tabular-nums',
            analysisChip === 'running' && 'border-amber-500/30 bg-amber-500/10 text-amber-700',
            analysisChip === 'done' && 'border-jade-500/30 bg-jade-500/10 text-jade-700',
            analysisChip === 'failed' && 'border-coral-500/30 bg-coral-500/10 text-coral-600',
          )}
        >
          {analysisChip === 'running' && <Loader2 size={13} className="animate-spin" />}
          {analysisChip === 'done' && <CheckCircle2 size={13} />}
          {analysisChip === 'failed' && <AlertTriangle size={13} />}
          {analysisChip === 'running'
            ? `分析中…${analysisProgress.length > 0 ? ` ${analysisProgress}` : ''}`
            : analysisChip === 'done'
              ? '分析完成'
              : '分析有失败'}
        </span>
      )}
      {analyzeMsg && (
        <span data-testid="analysis-msg" className="mp-meta text-jade-700">
          {analyzeMsg}
        </span>
      )}

      {hasFilter && (
        <Chip onClick={clearFilter} className="!border-coral-500/30 !text-coral-500" title="一键清除全部筛选条件">
          <X size={11} /> 清除筛选
        </Chip>
      )}

      {/* 模块内不得出现第二组同类筛选控件，因此把当前模块的匹配口径显式标注出来 */}
      <Badge tone="neutral" className="hidden xl:inline-flex">
        <button type="button" onClick={() => setModule(filter.module)} className="cursor-default">
          关键词匹配：{KEYWORD_SCOPE[filter.module]}
        </button>
      </Badge>
    </div>
  );
}
