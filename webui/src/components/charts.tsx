/**
 * 图表组件（纯 SVG 手写，无第三方图表库依赖 → 离线可跑，样式完全可控）
 * 都是「可复用展示单元」，后续 PRD 定稿加维度时直接复用。
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { heatColor, num } from '@/lib/format';
import type { TrendPoint } from '@/types';

/* -------------------------------------------------------------------------- */
/* Sparkline —— 卡片内嵌迷你折线                                                */
/* -------------------------------------------------------------------------- */
export function Sparkline({ data, width = 96, height = 28, className, stroke = '#07C160' }: { data: number[]; width?: number; height?: number; className?: string; stroke?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((v, i) => [i * stepX, height - ((v - min) / Math.max(1, max - min)) * (height - 4) - 2] as const);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <path d={area} fill={stroke} opacity={0.12} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* TrendArea —— 梗卡片的趋势分布图（带坐标轴与交互提示）                          */
/* -------------------------------------------------------------------------- */
export function TrendArea({ points, height = 132, className, accent = '#07C160' }: { points: TrendPoint[]; height?: number; className?: string; accent?: string }) {
  if (points.length < 2) return <div className={cn('mp-meta', className)}>数据点不足，无法绘制趋势</div>;
  const w = 100; // 使用百分比坐标
  const h = height;
  const max = Math.max(...points.map((p) => p.count), 1);
  const stepX = w / (points.length - 1);
  const xy = points.map((p, i) => [i * stepX, h - (p.count / max) * (h - 22) - 10] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const peakIdx = points.reduce((best, p, i) => (p.count > points[best].count ? i : best), 0);
  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-label="梗使用趋势">
        <defs>
          <linearGradient id={`grad-${accent.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="rgba(11,15,23,0.06)" strokeWidth="0.4" />
        ))}
        <path d={area} fill={`url(#grad-${accent.replace('#', '')})`} />
        <path d={line} fill="none" stroke={accent} strokeWidth="0.7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === peakIdx ? 1.6 : 0.9} fill={i === peakIdx ? '#f59e0b' : accent} vectorEffect="non-scaling-stroke">
            <title>{`${points[i].date} · ${points[i].count} 次`}</title>
          </circle>
        ))}
      </svg>
      <div className="mp-meta mt-1 flex justify-between">
        <span>{points[0].date}</span>
        <span className="text-amber-600">峰值 {points[peakIdx].date} · {points[peakIdx].count} 次</span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DistributionBars —— 按时间划分的分布图（梗卡片 / 详情页共用）                  */
/* -------------------------------------------------------------------------- */
export function DistributionBars({ buckets, height = 88, className }: { buckets: { bucket: string; count: number; intensity: number }[]; height?: number; className?: string }) {
  if (!buckets.length) return <div className={cn('mp-meta', className)}>暂无分布数据</div>;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {buckets.map((b) => (
          <div key={b.bucket} className="group relative flex-1" title={`${b.bucket} · ${b.count} 次`}>
            <div
              className="w-full rounded-t-[3px] transition-all duration-200 group-hover:opacity-100"
              style={{ height: Math.max(3, (b.count / max) * height), background: heatColor(b.intensity) }}
            />
          </div>
        ))}
      </div>
      <div className="mp-meta mt-1.5 flex justify-between">
        <span>{buckets[0].bucket}</span>
        <span>共 {buckets.length} 个时间段 · 峰值 {max} 次</span>
        <span>{buckets[buckets.length - 1].bucket}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut —— 消息类型分布                                                        */
/* -------------------------------------------------------------------------- */
const DONUT_COLORS = ['#07C160', '#45bd87', '#f59e0b', '#fb7185', '#0ea5e9', '#8b5cf6', '#94a3b8'];

export function Donut({ data, size = 148, thickness = 18, className }: { data: { label: string; value: number }[]; size?: number; thickness?: number; className?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-label="消息类型分布">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(11,15,23,0.06)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const len = (d.value / total) * c;
          const el = (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            >
              <title>{`${d.label}: ${num(d.value)} (${((d.value / total) * 100).toFixed(1)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-ink-600">{d.label}</span>
            <span className="tabular-nums text-ink-500">{((d.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Radar —— 性格画像多维雷达（功能三）                                           */
/* -------------------------------------------------------------------------- */
export function Radar({ axes, size = 220, className, accent = '#07C160' }: { axes: { label: string; score: number }[]; size?: number; className?: string; accent?: string }) {
  if (axes.length < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34;
  const point = (i: number, ratio: number) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [cx + Math.cos(angle) * r * ratio, cy + Math.sin(angle) * r * ratio] as const;
  };
  const rings = [0.25, 0.5, 0.75, 1];
  const poly = axes.map((a, i) => point(i, Math.max(0.04, a.score / 100)).join(',')).join(' ');
  return (
    <svg width={size} height={size} className={className} aria-label="性格维度雷达图">
      {rings.map((ring) => (
        <polygon key={ring} points={axes.map((_, i) => point(i, ring).join(',')).join(' ')} fill="none" stroke="rgba(11,15,23,0.08)" strokeWidth="1" />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(11,15,23,0.08)" strokeWidth="1" />;
      })}
      <polygon points={poly} fill={accent} fillOpacity="0.22" stroke={accent} strokeWidth="1.6" />
      {axes.map((a, i) => {
        const [x, y] = point(i, 1.2);
        return (
          <text key={a.label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-ink-500" style={{ fontSize: 10 }}>
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* HourBars —— 24 小时活跃分布（对齐 wechat-cli stats.hourly）                   */
/* -------------------------------------------------------------------------- */
export function HourBars({ hourly, height = 92, className }: { hourly: Record<string, number>; height?: number; className?: string }) {
  const entries = Array.from({ length: 24 }, (_, h) => ({ h, v: Number(hourly[String(h)] ?? hourly[h] ?? 0) }));
  const max = Math.max(...entries.map((e) => e.v), 1);
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {entries.map((e) => (
          <div key={e.h} className="group relative flex-1" title={`${e.h}:00 · ${num(e.v)} 条`}>
            <div
              className={cn('w-full rounded-t-[3px] transition-colors', e.v === max ? 'bg-amber-500' : 'bg-jade-500/55 group-hover:bg-jade-500')}
              style={{ height: Math.max(2, (e.v / max) * height) }}
            />
          </div>
        ))}
      </div>
      <div className="mp-meta mt-1.5 flex justify-between">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HeatStrip —— 时间轴热力条（梗时间轴 / 通知时间轴共用）                         */
/* -------------------------------------------------------------------------- */
export function HeatStrip({ cells, className, cellHeight = 26 }: { cells: { label: string; value: number; intensity: number; hint?: string; onClick?: () => void; active?: boolean }[]; className?: string; cellHeight?: number }) {
  return (
    <div className={cn('flex w-full items-stretch gap-[3px]', className)}>
      {cells.map((c, i) => (
        <button
          key={`${c.label}-${i}`}
          type="button"
          onClick={c.onClick}
          title={c.hint ?? `${c.label} · ${c.value}`}
          className={cn('group relative flex-1 overflow-hidden rounded-md border transition-all', c.active ? 'border-ink-900/40 ring-1 ring-ink-900/20' : 'border-transparent hover:border-ink-900/20')}
          style={{ height: cellHeight, background: heatColor(c.intensity) }}
        >
          <span className="sr-only">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TagCloud 布局无关的标签列表（用于「按时间排序」视图）                          */
/* -------------------------------------------------------------------------- */
export function BarList({ items, className, unit = '次' }: { items: { label: string; value: number; hint?: string; onClick?: () => void }[]; className?: string; unit?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((it) => (
        <li key={it.label}>
          <button type="button" onClick={it.onClick} className="group w-full text-left">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-medium text-ink-700 group-hover:text-jade-700">{it.label}</span>
              <span className="shrink-0 tabular-nums text-ink-400">
                {num(it.value)} {unit}
                {it.hint && <span className="ml-2 text-ink-300">{it.hint}</span>}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-900/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-jade-400 to-jade-600 transition-all" style={{ width: `${(it.value / max) * 100}%` }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* MiniStat —— 行内小指标                                                       */
/* -------------------------------------------------------------------------- */
export function MiniStat({ label, value, tone = 'ink' }: { label: string; value: ReactNode; tone?: 'ink' | 'jade' | 'amber' | 'coral' }) {
  const tones = { ink: 'text-ink-700', jade: 'text-jade-600', amber: 'text-amber-600', coral: 'text-coral-500' };
  return (
    <div className="rounded-xl border border-ink-900/[0.06] bg-white/60 px-3 py-2">
      <div className="mp-meta">{label}</div>
      <div className={cn('mt-0.5 text-sm font-semibold tabular-nums', tones[tone])}>{value}</div>
    </div>
  );
}
