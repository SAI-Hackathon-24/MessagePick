/**
 * ECharts 按需加载容器（HLD 决策 2：图表统一走 ECharts 配置）
 * =============================================================================
 * REQ-010 要求「万条级消息首屏渲染 < 2s」。ECharts 全量包体积较大，
 * 因此这里只 `use()` 实际用到的图表类型与组件，并把图表模块做成
 * **懒加载**：首屏不加载 ECharts，进入含图表的视图时才拉取对应 chunk。
 * 仅负责实例生命周期与尺寸自适应，具体配置由调用方给出。
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui';

/** 按需注册：只在第一次需要绘图时才加载 echarts 与其用到的模块 */
type ECharts = typeof import('echarts/core');
let corePromise: Promise<ECharts> | null = null;

async function loadECharts() {
  if (!corePromise) {
    corePromise = (async () => {
      const [core, charts, components, renderers] = await Promise.all([
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
      ]);
      core.use([
        charts.BarChart,
        charts.RadarChart,
        charts.GraphChart,
        charts.ScatterChart,
        // 梗生命周期视图用热力图。⚠️ 未注册的系列类型 ECharts 不报错、只是不绘制，
        // 表现为「行名与月份轴都在、格子却是空的」——排查成本极高，务必逐一核对。
        charts.HeatmapChart,
        components.GridComponent,
        components.TooltipComponent,
        components.LegendComponent,
        components.AriaComponent,
        components.TitleComponent,
        // 以下是「漏注册会静默变形」的组件（均已在实践中踩过）：
        // · VisualMapComponent —— 热力图给单元格上色
        // · GraphicComponent   —— 图内标注
        components.VisualMapComponent,
        components.GraphicComponent,
        components.MarkLineComponent,
        renderers.CanvasRenderer,
      ]);
      return core;
    })();
  }
  return corePromise;
}

export interface EChartProps {
  /** 直接给出 ECharts option（图表模块已按需注册后可用） */
  option: Record<string, unknown>;
  height?: number;
  className?: string;
  onEvents?: Record<string, (params: unknown) => void>;
  /** 词云等扩展图表在绘制前需要先注册，故支持一个准备钩子 */
  prepare?: () => Promise<void>;
}

export function EChart({ option, height = 320, className, onEvents, prepare }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ setOption: (o: unknown, notMerge?: boolean) => void; resize: () => void; dispose: () => void; on: (e: string, h: (p: unknown) => void) => void; off: (e: string) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  /* 懒加载 ECharts + 注册所需模块 */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (prepare) await prepare();
        await loadECharts();
        if (alive) setReady(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [prepare]);

  useEffect(() => {
    if (!ready || !ref.current) return;
    let disposed = false;
    (async () => {
      const echarts = await loadECharts();
      if (disposed || !ref.current) return;
      const chart = echarts.init(ref.current);
      chartRef.current = chart as unknown as typeof chartRef.current;
      chart.setOption(option, true);
      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(ref.current);
      const cleanup = () => {
        ro.disconnect();
        chart.dispose();
        chartRef.current = null;
      };
      /* 组件卸载时清理 */
      (ref.current as unknown as { __cleanup?: () => void }).__cleanup = cleanup;
    })();
    return () => {
      disposed = true;
      const el = ref.current as unknown as { __cleanup?: () => void } | null;
      el?.__cleanup?.();
    };
    // option 变化只更新配置，不重建实例（见下一个 effect）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    Object.entries(onEvents).forEach(([evt, handler]) => chart.on(evt, handler));
    return () => {
      Object.keys(onEvents).forEach((evt) => chart.off(evt));
    };
  }, [onEvents, ready]);

  if (failed) {
    return (
      <div className={cn('flex items-center justify-center rounded-xl border border-dashed border-ink-900/15 text-xs text-ink-400', className)} style={{ height }}>
        图表组件加载失败：请检查网络或刷新页面重试（已缓存内容仍可浏览）。
      </div>
    );
  }

  return (
    <div className={cn('relative w-full', className)} style={{ height }}>
      {!ready && <Skeleton className="absolute inset-0 rounded-xl" />}
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
