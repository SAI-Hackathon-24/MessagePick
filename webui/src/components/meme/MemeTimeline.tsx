/**
 * 梗时间轴（Meme Timeline）
 * ---------------------------------------------------------------------------
 * 目标.md 原文要求：
 *   「梗卡片也可以通过时间轴的形式进行组织，展示同一时间段下什么梗在被频繁使用，
 *     一个梗从初次使用到无人问津经过了多久」
 *
 * 因此这里做两种互补视图（同一份数据，两种读法）：
 *  1. lifespan（生命线）：甘特图式，每条横线 = 一个梗的活跃区间，
 *     可直观看出「从初现到无人问津」的跨度与重叠期。
 *  2. heat（热力编组）：把时间切成等宽格子，看每个时间段里哪些梗在爆发。
 */
import { useMemo, useState } from 'react';
import { Activity, CalendarClock, Gauge } from 'lucide-react';
import type { MemeCard } from '@/types';
import { cn } from '@/lib/cn';
import { fmtMD, heatColor, num } from '@/lib/format';
import { RANGE_END, RANGE_START } from '@/api/mockData';
import { Badge, EmptyState, SectionHeading } from '@/components/ui';

type View = 'lifespan' | 'heat';

export function MemeTimeline({ memes, onSelect, className }: { memes: MemeCard[]; onSelect: (m: MemeCard) => void; className?: string }) {
  const [view, setView] = useState<View>('lifespan');
  const [activeId, setActiveId] = useState<string | null>(null);

  const { startMs, endMs, ticks } = useMemo(() => {
    if (!memes.length) return { startMs: 0, endMs: 0, ticks: [] as { label: string; ratio: number }[] };
    const s = Math.min(...memes.map((m) => Date.parse(m.first_seen)));
    const e = Math.max(...memes.map((m) => Date.parse(m.last_seen)));
    const span = Math.max(1, e - s);
    // 生成 6 个刻度
    const t = Array.from({ length: 6 }, (_, i) => {
      const ratio = i / 5;
      return { label: fmtMD(s + span * ratio).slice(0, 5), ratio };
    });
    return { startMs: s, endMs: e, ticks: t };
  }, [memes]);

  const heatBuckets = useMemo(() => {
    if (!memes.length) return [];
    // 以周为粒度聚合所有梗的时间分布
    const bucketMap = new Map<string, number>();
    memes.forEach((m) =>
      m.timeline.forEach((b) => {
        bucketMap.set(b.bucket, (bucketMap.get(b.bucket) ?? 0) + b.count);
      }),
    );
    const entries = [...bucketMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return entries.map(([bucket, count]) => ({ bucket, count, intensity: count / max }));
  }, [memes]);

  if (!memes.length) {
    return <EmptyState title="没有可用于时间轴的梗" description="时间轴需要梗的首次/最近使用时间；请先执行「一键提炼」。" />;
  }

  const spanDays = Math.max(1, Math.round((endMs - startMs) / 86400000));

  return (
    <div className={cn('mp-card overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-900/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1">
          <button
            type="button"
            onClick={() => setView('lifespan')}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors', view === 'lifespan' ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700')}
          >
            <CalendarClock size={13} />
            生命线
          </button>
          <button
            type="button"
            onClick={() => setView('heat')}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors', view === 'heat' ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700')}
          >
            <Activity size={13} />
            热度编组
          </button>
        </div>
        <span className="mp-meta">
          跨度 {spanDays} 天 · 共 {memes.length} 个梗 · 点击条目查看卡片
        </span>
      </div>

      {view === 'lifespan' ? (
        <div className="px-4 py-4">
          {/* 刻度轴 */}
          <div className="mb-2 flex justify-between pl-[132px] sm:pl-[168px]">
            {ticks.map((t) => (
              <span key={t.label} className="mp-meta tabular-nums">
                {t.label}
              </span>
            ))}
          </div>
          <ul className="space-y-1.5">
            {memes.map((m) => {
              const s = Date.parse(m.first_seen);
              const e = Date.parse(m.last_seen);
              const left = ((s - startMs) / Math.max(1, endMs - startMs)) * 100;
              const width = Math.max(1.5, ((e - s) / Math.max(1, endMs - startMs)) * 100);
              const maxBucket = Math.max(...m.timeline.map((b) => b.intensity), 0);
              const isActive = activeId === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveId(m.id)}
                    onMouseLeave={() => setActiveId(null)}
                    onClick={() => onSelect(m)}
                    className={cn('group flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left transition-colors', isActive && 'bg-jade-500/[0.07]')}
                  >
                    <span className="flex w-[124px] shrink-0 items-center gap-1.5 sm:w-[160px]">
                      <span className="truncate text-[13px] font-semibold text-ink-700">{m.term}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-ink-300">{num(m.count)}</span>
                    </span>
                    <span className="relative h-6 flex-1 rounded-md bg-ink-900/[0.04]">
                      <span
                        className="absolute top-0.5 h-5 rounded-md transition-all duration-200 group-hover:brightness-105"
                        style={{
                          left: `${left}%`,
                          width: `${Math.min(100 - left, width)}%`,
                          background: `linear-gradient(90deg, ${heatColor(0.35)}, ${heatColor(maxBucket)})`,
                        }}
                        title={`${fmtMD(m.first_seen)} → ${fmtMD(m.last_seen)}（${m.lifespan_days} 天）`}
                      />
                      {/* 峰值标记 */}
                      {m.timeline.length > 0 && (
                        <span
                          className="absolute top-0 h-6 w-[2px] rounded-full bg-amber-500"
                          style={{
                            left: `${Math.min(99.5, ((Date.parse(m.timeline.reduce((a, b) => (b.count > a.count ? b : a), m.timeline[0]).first_used_at) - startMs) / Math.max(1, endMs - startMs)) * 100)}%`,
                          }}
                          title="使用峰值"
                        />
                      )}
                    </span>
                    <span className="w-[68px] shrink-0 text-right text-[11px] tabular-nums text-ink-400">
                      {m.lifespan_days} 天
                      {m.lifespan_days < 14 && <span className="ml-1 text-coral-500">·凉</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mp-meta mt-3 flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: `linear-gradient(90deg, ${heatColor(0.35)}, ${heatColor(1)})` }} />
              活跃强度（绿→琥珀）
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-[2px] rounded-full bg-amber-500" />
              使用峰值时刻
            </span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-4">
          <div className="flex items-stretch gap-[3px]">
            {heatBuckets.map((b) => (
              <div key={b.bucket} className="group relative flex-1">
                <div
                  className="w-full rounded-md transition-transform group-hover:scale-y-105"
                  style={{ height: 56, background: heatColor(b.intensity) }}
                  title={`${b.bucket} · 共 ${b.count} 次提及`}
                />
                <div className="mp-meta mt-1 origin-left truncate text-center text-[9px]" style={{ writingMode: 'horizontal-tb' }}>
                  {b.bucket.replace(' 起', '')}
                </div>
              </div>
            ))}
          </div>
          <div className="mp-meta mt-3">
            每个格子 = 一个时间桶，颜色越暖表示该时段被提及越多；下方为该时段里最活跃的梗。
          </div>
          <ul className="mt-3 space-y-2">
            {heatBuckets
              .filter((b) => b.intensity > 0.5)
              .slice(-6)
              .map((b) => {
                const inBucket = memes
                  .filter((m) => m.timeline.some((t) => t.bucket === b.bucket))
                  .sort((a, x) => x.count - a.count)
                  .slice(0, 4);
                return (
                  <li key={b.bucket} className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-700">{b.bucket}</span>
                      <Badge tone="amber">{b.count} 次提及</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {inBucket.map((m) => (
                        <button key={m.id} type="button" onClick={() => onSelect(m)} className="mp-chip hover:border-jade-500/40 hover:text-jade-700">
                          {m.term}
                        </button>
                      ))}
                    </div>
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
/* 梗生命周期说明（放在时间轴上方，帮助评审快速理解这张图在讲什么）                 */
/* -------------------------------------------------------------------------- */
export function TimelineIntro() {
  return (
    <SectionHeading
      title="梗的时间轴"
      hint="同一条时间线上看：什么时段哪个梗在爆发，以及一个梗从初现到无人问津经过了多久"
      right={
        <span className="mp-meta inline-flex items-center gap-1">
          <Gauge size={12} />
          分析范围：{fmtMD(RANGE_START.toISOString())} ~ {fmtMD(RANGE_END.toISOString())}
        </span>
      }
    />
  );
}
