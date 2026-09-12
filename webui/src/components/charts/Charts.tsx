/**
 * 各模块共用的 ECharts 图表（HLD 决策 2）
 * 每张图都直接消费契约里的数据，不含自研图表逻辑。
 */
import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';
import type { ActivityBreakdown, InterestCategory, LifecycleRow, MonthlyBucket, PersonalityTrait } from '@/types';
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

/**
 * 梗生命周期总览（REQ-025、REQ-030）
 * =============================================================================
 * 原先是「每梗一行、各自一条独立条形图」：行与行之间没有共同的横轴，
 * 既看不出「同一时间段在流行哪些梗」，也看不清「一个梗从初现到沉寂过了多久」。
 * 改为**一张热力图**：横轴 = 月份（各梗共享），纵轴 = 梗，
 * 单元格亮度 = 当月出现强度（顺序色阶），并在首现/峰值/沉寂月份加标记。
 */
export function LifecycleHeatmap({
  rows,
  leaders,
  height,
  onPick,
}: {
  rows: LifecycleRow[];
  /**
   * 当月领跑梗。**不在图内绘制**：原先用 ECharts 的 graphic 组件画在横轴下方，
   * 该组件一旦未注册或配置异常会让整张热力图静默不绘制（表现为「格子空白」）。
   * 现改为由调用方用 HTML 渲染，图表只负责画格子。
   */
  leaders?: { month: string; name: string }[];
  height?: number;
  onPick?: (memeId: string) => void;
}) {
  void leaders;
  const months = useMemo(() => [...new Set(rows.flatMap((r) => r.monthlyIntensity.map((m) => m.month)))].sort(), [rows]);
  /** 只展示活跃天数最长的若干梗，避免纵轴过长；其余通过表格视图查看 */
  const shown = useMemo(() => [...rows].sort((a, b) => b.activeDays - a.activeDays).slice(0, 12), [rows]);

  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
      tooltip: {
        confine: true,
        backgroundColor: 'rgba(11,15,23,0.92)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: unknown) => {
          const d = p as { value: [number, number, number] };
          const [mi, ri, count] = d.value;
          const row = shown[ri];
          if (!row) return '';
          return [
            `<b>${row.name}</b>`,
            `${months[mi]}：出现 <b>${count}</b> 次`,
            `首现 ${row.firstSeenAt.slice(0, 10)}　峰值 ${row.peakAt.slice(0, 10)}　沉寂 ${row.silentAt.slice(0, 10)}`,
            `活跃 ${row.activeDays} 天`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'category',
        data: months.map((m) => m.slice(2)),
        axisLabel: { fontSize: 10, color: '#77839a' },
        axisLine: { lineStyle: { color: 'rgba(11,15,23,0.1)' } },
      },
      yAxis: {
        type: 'category',
        data: shown.map((r) => r.name),
        axisLabel: { fontSize: 11, color: '#556074' },
        axisLine: { lineStyle: { color: 'rgba(11,15,23,0.1)' } },
      },
      visualMap: {
        /**
         * ⚠️ min/max 必须覆盖**真实次数**的取值范围。
         * 早前写成 0–1（当成强度比例），而格子里是当月次数（3~14）：
         * 超出范围的值不会被赋予颜色，会直接渲染成透明。
         */
        min: 0,
        max: Math.max(...shown.flatMap((r) => r.monthlyIntensity.map((m) => m.count)), 1),
        show: false,
        inRange: { color: ['#eef7f1', '#0b5c33'] },
      },
      series: [
        {
          type: 'heatmap',
          /**
           * ⚠️ value 必须是**三元组** [x 索引, y 索引, 数值]。
           * 早前把它写成四元组 [x, y, 次数, 梗名]（想把梗名带进 tooltip）：
           * ECharts 不报错，但会把所有数据退化到同一行绘制 —— 表现为
           * 「只有最下面一行有格子、其余全是空白，且颜色几乎没有渐变」。
           * 梗名改由 tooltip 的 formatter 用 y 索引反查（见上），不放数据里。
           */
          data: shown.flatMap((r, ri) =>
            r.monthlyIntensity.map((m) => [months.indexOf(m.month), ri, m.count] as [number, number, number]),
          ),
          label: { show: true, fontSize: 10, color: '#fff', formatter: (p: unknown) => String((p as { value: [number, number, number] }).value[2] || '') },
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
          emphasis: { itemStyle: { borderColor: '#2b3242', borderWidth: 2 } },
        },
      ],
    }),
    // leaders 由调用方用 HTML 渲染（不放进 option，避免依赖 graphic 组件）
    [shown, months],
  );

  const onEvents = useMemo(
    () =>
      onPick
        ? {
            click: (p: unknown) => {
              const d = p as { value: [number, number, number] };
              const row = shown[d.value?.[1] ?? -1];
              if (row) onPick(row.memeId);
            },
          }
        : undefined,
    [onPick, shown],
  );

  return <EChart option={option} height={height ?? Math.max(260, shown.length * 38 + 90)} onEvents={onEvents} />;
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
  activity,
  activityOf,
  compareName,
  height = 300,
  onAxisClick,
}: {
  /** 一级五类维度分（契约固定五类，来自 DM-013/DM-020） */
  scores: Record<InterestCategory, number>;
  /** 可选：叠加对比（两人逐维度差值 —— REQ-059） */
  compare?: { name: string; scores: Record<InterestCategory, number>; activity?: ActivityBreakdown };
  /** 本人的活跃度综合分（展示在第五根轴上，替代原「社交」轴的读法） */
  activity?: ActivityBreakdown;
  /** 对比对象的活跃度（叠加对比时使用） */
  activityOf?: ActivityBreakdown;
  compareName?: string;
  height?: number;
  onAxisClick?: (c: InterestCategory) => void;
}) {
  const cats: InterestCategory[] = ['sports', 'art', 'game', 'entertainment', 'social'];

  /**
   * 第五根轴：数据层仍是契约固定的 social 维度，但**界面按活跃度展示**。
   * 活跃度是 0–100 的综合分，与其它四轴（置信度求和，量级 0~4）不同量纲，
   * 因此把五轴统一到一个 0–100 的显示刻度：前四轴按各自最大值放大，第五轴直接用综合分。
   */
  const interestMax = Math.max(1, ...cats.slice(0, 4).map((c) => Math.max(scores[c], compare?.scores[c] ?? 0)));
  const toDisplay = (v: number, c: InterestCategory) => (c === 'social' ? 0 : Math.round((v / interestMax) * 100));

  const axisNames = cats.map((c) => (c === 'social' ? '活跃度' : INTEREST_CATEGORY_LABEL[c]));

  /** 悬停明细：活跃度轴展示三项原始指标，其余轴展示维度分构成 */
  const detailOf = (c: InterestCategory, which: 'self' | 'compare'): string => {
    if (c !== 'social') {
      const value = which === 'self' ? scores[c] : (compare?.scores[c] ?? 0);
      return `${INTEREST_CATEGORY_LABEL[c]}<br/>维度分（该维度下二级标签置信度之和）：<b>${value.toFixed(1)}</b>`;
    }
    const a = which === 'self' ? activity : activityOf;
    if (!a || a.insufficient)
      return `活跃度<br/><b>数据不足</b><br/>发言少于 ${10} 条，不做推测`;
    const lines = a.metrics.map(
      (m) => `${m.label}：<b>${m.raw}</b>${m.normalized === null ? '（无样本）' : `　→ 归一化 ${m.normalized}`}<br/><span style="opacity:.7">群内最大 ${m.groupMax} · 有效权重 ${(m.effectiveWeight * 100).toFixed(0)}%</span>${m.note ? `<br/><span style="opacity:.7">${m.note}</span>` : ''}`,
    );
    return `活跃度综合分：<b>${a.score}</b><br/><span style="opacity:.8">消息条数 50% + 回复时长 30% + 新鲜度 20%</span><br/><br/>${lines.join('<br/><br/>')}`;
  };

  const selfValue = cats.map((c) => (c === 'social' ? (activity && !activity.insufficient ? activity.score : 0) : toDisplay(scores[c], c)));
  const compareValue = compare ? cats.map((c) => (c === 'social' ? (compare.activity && !compare.activity.insufficient ? compare.activity.score : 0) : toDisplay(compare.scores[c], c))) : [];

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        confine: true,
        backgroundColor: 'rgba(11,15,23,0.92)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12, lineHeight: 18 },
        formatter: (p: unknown) => {
          const d = p as { name?: string; dataIndex?: number; seriesName?: string; value?: number[] };
          const c = cats[d.dataIndex ?? 0];
          const which = compare && d.seriesName === compareName ? 'compare' : 'self';
          const head = `${axisNames[d.dataIndex ?? 0]}${which === 'compare' ? `（${compareName}）` : ''}<br/>`;
          return head + detailOf(c, which);
        },
      },
      legend: compare ? { bottom: 0, textStyle: { fontSize: 11 } } : undefined,
      radar: {
        // 五轴统一为 0–100 显示刻度：前四轴按维度分最大值放大，第五轴为活跃度综合分。
        // 这样活跃度与兴趣维度可同图比较，且不改变各自的原始数值（悬停明细给出原始值）。
        // 显式给出刻度数：否则 ECharts 会在 0–100 的小刻度下提示 ticks may be not readable
        indicator: axisNames.map((name) => ({ name, max: 100, min: 0 })),
        splitNumber: 5,
        radius: '62%',
        splitLine: { lineStyle: { color: 'rgba(11,15,23,0.08)' } },
        axisName: { fontSize: 11, color: '#556074' },
      },
      series: [
        {
          type: 'radar',
          data: [
            { value: selfValue, name: '本次', areaStyle: { opacity: 0.22 }, lineStyle: { color: '#07C160' }, itemStyle: { color: '#07C160' } },
            ...(compare
              ? [{ value: compareValue, name: compareName ?? '对比', areaStyle: { opacity: 0.16 }, lineStyle: { color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } }]
              : []),
          ],
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scores, compare, activity, activityOf, compareName, cats],
  );

  const onEvents = useMemo(
    () =>
      onAxisClick
        ? {
            click: (p: unknown) => {
              const d = p as { dataIndex?: number };
              const c = cats[d.dataIndex ?? -1];
              if (c) onAxisClick(c);
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
