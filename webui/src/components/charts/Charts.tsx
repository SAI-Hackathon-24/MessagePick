/**
 * 各模块共用的 ECharts 图表（HLD 决策 2）
 * 每张图都直接消费契约里的数据，不含自研图表逻辑。
 */
import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';
import type { InterestCategory, LifecycleRow, MonthlyBucket, PersonalityTrait } from '@/types';
import { INTEREST_CATEGORY_LABEL, MEME_TYPE_COLOR, PERSONALITY_LABEL } from '@/types';
import { EChart } from './EChart';

/** 月度分布柱状图（REQ-029、AC-054：标注不完整月份） */
export function MonthlyBars({ buckets, height = 200 }: { buckets: MonthlyBucket[]; height?: number }) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: (p: unknown) => {
          const arr = p as { name: string; value: number; dataIndex: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const b = buckets[i];
          return `${b.month}<br/>出现 ${b.count} 次${b.incomplete ? '<br/><b>该月数据不完整</b>' : ''}`;
        },
      },
      xAxis: {
        type: 'category',
        data: buckets.map((b) => (b.incomplete ? `${b.month}*` : b.month)),
        axisLabel: { fontSize: 10, color: '#77839a' },
        axisLine: { lineStyle: { color: 'rgba(11,15,23,0.1)' } },
      },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#77839a' }, splitLine: { lineStyle: { color: 'rgba(11,15,23,0.06)' } } },
      series: [
        {
          type: 'bar',
          data: buckets.map((b) => ({
            value: b.count,
            itemStyle: { color: b.incomplete ? '#a8b1c1' : '#07C160', borderRadius: [4, 4, 0, 0] },
          })),
          barMaxWidth: 28,
        },
      ],
    }),
    [buckets],
  );
  return (
    <div>
      <EChart option={option} height={height} />
      {buckets.some((b) => b.incomplete) && <p className="mp-meta mt-1">带 * 的月份为不完整月份（数据未覆盖整月）。</p>}
    </div>
  );
}

/** 生命周期条带（REQ-025、REQ-030：条带长度 = 生命周期跨度，按月显示强度） */
export function LifecycleStrip({ row, height = 26 }: { row: LifecycleRow; height?: number }) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'category', show: false, data: row.monthlyIntensity.map((m) => m.month) },
      yAxis: { type: 'value', show: false, max: 1 },
      tooltip: {
        confine: true,
        formatter: () => `${row.name}<br/>活跃天数 ${row.activeDays} 天<br/>峰值 ${row.peakAt.slice(0, 10)}<br/>沉寂 ${row.silentAt.slice(0, 10)}`,
      },
      series: [
        {
          type: 'bar',
          data: row.monthlyIntensity.map((m) => ({
            value: m.intensity,
            itemStyle: { color: intensityColor(m.intensity), borderRadius: 2 },
          })),
          barCategoryGap: '12%',
        },
      ],
    }),
    [row],
  );
  return <EChart option={option} height={height} />;
}

/** 强度 → 顺序色阶（浅玉 → 微信绿 → 琥珀） */
function intensityColor(v: number): string {
  if (v >= 0.75) return '#f59e0b';
  if (v >= 0.45) return '#059a4d';
  if (v >= 0.2) return '#45bd87';
  return '#d6f5e3';
}

/** 爱好雷达图（REQ-071）：五轴 = 运动 / 艺术 / 游戏 / 娱乐 / 社交 */
export function HobbyRadar({
  scores,
  compare,
  height = 300,
  onAxisClick,
}: {
  scores: Record<InterestCategory, number>;
  /** 可选：叠加对比（两人逐维度差值 —— REQ-059） */
  compare?: { name: string; scores: Record<InterestCategory, number> };
  height?: number;
  onAxisClick?: (c: InterestCategory) => void;
}) {
  const cats: InterestCategory[] = ['sports', 'art', 'game', 'entertainment', 'social'];
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { confine: true },
      legend: compare ? { bottom: 0, textStyle: { fontSize: 11 } } : undefined,
      radar: {
        indicator: cats.map((c) => ({ name: INTEREST_CATEGORY_LABEL[c], max: Math.max(4, ...cats.map((k) => Math.max(scores[k], compare?.scores[k] ?? 0))) })),
        radius: '62%',
        splitLine: { lineStyle: { color: 'rgba(11,15,23,0.08)' } },
        axisName: { fontSize: 11, color: '#556074' },
      },
      series: [
        {
          type: 'radar',
          data: [
            { value: cats.map((c) => Number(scores[c].toFixed(2))), name: '本次', areaStyle: { opacity: 0.22 }, lineStyle: { color: '#07C160' }, itemStyle: { color: '#07C160' } },
            ...(compare
              ? [
                  {
                    value: cats.map((c) => Number(compare.scores[c].toFixed(2))),
                    name: compare.name,
                    areaStyle: { opacity: 0.16 },
                    lineStyle: { color: '#f59e0b' },
                    itemStyle: { color: '#f59e0b' },
                  },
                ]
              : []),
          ],
        },
      ],
    }),
    [scores, compare, cats],
  );
  const onEvents = useMemo(
    () => (onAxisClick ? { click: () => cats.forEach((c) => void c) } : undefined),
    [onAxisClick, cats],
  );
  return <EChart option={option} height={height} onEvents={onEvents} />;
}

/** 性格雷达图（REQ-072）：六轴闭集固定 */
export function PersonalityRadar({ scores, height = 280 }: { scores: Partial<Record<PersonalityTrait, number>>; height?: number }) {
  const traits: PersonalityTrait[] = ['leadership', 'lively', 'humorous', 'calm', 'rational', 'judgement'];
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { confine: true },
      radar: {
        indicator: traits.map((t) => ({ name: PERSONALITY_LABEL[t], max: 100 })),
        radius: '64%',
        splitLine: { lineStyle: { color: 'rgba(11,15,23,0.08)' } },
        axisName: { fontSize: 11, color: '#556074' },
      },
      series: [
        {
          type: 'radar',
          data: [{ value: traits.map((t) => scores[t] ?? 0), name: '性格维度分', areaStyle: { opacity: 0.2 }, lineStyle: { color: '#0ea5e9' }, itemStyle: { color: '#0ea5e9' } }],
        },
      ],
    }),
    [scores, traits],
  );
  return <EChart option={option} height={height} />;
}

/** 人-人关系图谱（REQ-069）：节点 = 人，连线 = 共同爱好；未知成员零连线 */
export function RelationGraphChart({
  graph,
  height = 460,
  onPick,
}: {
  graph: { nodes: { personId: string; name: string; unknown: boolean; activity: number; isMe: boolean }[]; links: { source: string; target: string; sharedCount: number; sharedInterests: string[] }[] };
  height?: number;
  onPick?: (personId: string) => void;
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        confine: true,
        formatter: (p: unknown) => {
          const d = p as { dataType: string; data: Record<string, unknown> };
          if (d.dataType === 'edge') {
            const interests = (d.data.sharedInterests as string[]) ?? [];
            return `共同爱好 ${d.data.sharedCount} 项<br/>${interests.join('、')}`;
          }
          return `${d.data.name}${d.data.unknown ? '（未知：发言不足，不做推测）' : ''}<br/>活跃度 ${d.data.activity}`;
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          force: { repulsion: 220, edgeLength: [60, 160], gravity: 0.08 },
          label: { show: true, fontSize: 11, color: '#2b3242' },
          lineStyle: { color: 'rgba(7,193,96,0.35)', width: 1.4, curveness: 0.08 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
          data: graph.nodes.map((n) => ({
            id: n.personId,
            name: n.name,
            // 未知成员：列入图谱但零连线（孤立节点）—— REQ-081
            symbolSize: n.isMe ? 46 : n.unknown ? 20 : Math.max(24, Math.min(46, 20 + n.activity / 24)),
            itemStyle: {
              color: n.isMe ? '#07C160' : n.unknown ? '#d4d9e2' : '#45bd87',
              borderColor: n.unknown ? '#a8b1c1' : '#fff',
              borderWidth: 2,
              opacity: n.unknown ? 0.75 : 1,
            },
            unknown: n.unknown,
            activity: n.activity,
          })),
          links: graph.links.map((l) => ({ source: l.source, target: l.target, sharedCount: l.sharedCount, sharedInterests: l.sharedInterests })),
        },
      ],
    }),
    [graph],
  );
  const onEvents = useMemo(
    () => (onPick ? { click: (p: unknown) => { const d = p as { dataType: string; data?: { id?: string } }; if (d.dataType === 'node' && d.data?.id) onPick(d.data.id); } } : undefined),
    [onPick],
  );
  return <EChart option={option} height={height} onEvents={onEvents} />;
}

/** 兴趣时间轴 / 事件流（REQ-067）：仅可视化，不参与权重（REQ-087） */
export function InterestEventTimeline({ streams, height = 260, onPick }: { streams: { tagId: string; name: string; category: InterestCategory; firstSeenAt: string; events: { at: string; intensity: number; personName: string }[] }[]; height?: number; onPick?: (tagId: string) => void }) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        confine: true,
        formatter: (p: unknown) => {
          const d = p as { value: [number, number, string, string] };
          return `${d.value[3]}<br/>${new Date(d.value[1]).toLocaleDateString()}<br/>来源成员：${d.value[2]}`;
        },
      },
      xAxis: { type: 'time', axisLabel: { fontSize: 10, color: '#77839a' }, splitLine: { show: false } },
      yAxis: {
        type: 'category',
        data: streams.map((s) => s.name),
        axisLabel: { fontSize: 11, color: '#556074' },
        axisLine: { lineStyle: { color: 'rgba(11,15,23,0.1)' } },
      },
      series: streams.map((s) => ({
        type: 'scatter' as const,
        name: s.name,
        symbolSize: 10,
        data: s.events.map((e) => ({ value: [e.at, s.name, e.personName, s.name] as [string, string, string, string], itemStyle: { color: '#45bd87' } })),
      })),
    }),
    [streams],
  );
  const onEvents = useMemo(() => (onPick ? { click: (p: unknown) => { const d = p as { seriesName?: string }; const hit = streams.find((s) => s.name === d.seriesName); if (hit) onPick(hit.tagId); } } : undefined), [onPick, streams]);
  return <EChart option={option} height={height} onEvents={onEvents} />;
}

/** 24 小时活跃分布（外壳 / 设置页展示；口径沿用 stats.hourly） */
export function HourBars({ hourly, height = 120 }: { hourly: Record<string, number>; height?: number }) {
  const entries = Array.from({ length: 24 }, (_, h) => ({ h, v: Number(hourly[String(h)] ?? 0) }));
  const max = Math.max(...entries.map((e) => e.v), 1);
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 4, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', confine: true, formatter: (p: unknown) => `${(p as { name: string }[])[0].name}:00 · ${(p as { value: number }[])[0].value} 条` },
      xAxis: { type: 'category', data: entries.map((e) => `${e.h}`), axisLabel: { fontSize: 9, color: '#77839a', interval: 3 }, axisLine: { lineStyle: { color: 'rgba(11,15,23,0.1)' } } },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'bar',
          data: entries.map((e) => ({ value: e.v, itemStyle: { color: e.v === max ? '#f59e0b' : 'rgba(7,193,96,0.55)', borderRadius: [3, 3, 0, 0] } })),
          barCategoryGap: '20%',
        },
      ],
    }),
    [entries, max],
  );
  return <EChart option={option} height={height} />;
}

export { intensityColor, MEME_TYPE_COLOR };
