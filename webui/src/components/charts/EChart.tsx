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
        components.GridComponent,
        components.TooltipComponent,
        components.LegendComponent,
        components.AriaComponent,
        components.TitleComponent,
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
  /** 实例与 observer 的清理函数（不挂在 DOM 上，避免污染元素类型） */
  const cleanupRef = useRef<(() => void) | null>(null);

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

  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    if (!ready || !ref.current) return;
    let disposed = false;
    let raf = 0;

    (async () => {
      const echarts = await loadECharts();
      if (disposed || !ref.current) return;
      const el = ref.current;

      /**
       * ⚠️ 必须在容器**已有非零尺寸**之后再 init + setOption。
       * ECharts 在尺寸为 0 时初始化会把 canvas 定成 0×0：
       * 普通直角坐标系图表会在后续 resize 时恢复，但**力导向图（人-人关系图谱）
       * 会因为布局阶段拿到 0×0 而直接不渲染**，表现为「有统计数字、画布空白」。
       * 懒加载 chunk 落地、父容器尚未布局、折叠面板刚展开等都会触发这种情况。
       */
      const hasSize = () => el.clientWidth > 0 && el.clientHeight > 0;

      const boot = () => {
        if (disposed || chartRef.current) return;
        if (!hasSize()) return; // 等 ResizeObserver 报出尺寸后再初始化
        try {
          const chart = echarts.init(el);
          chartRef.current = chart as unknown as typeof chartRef.current;
          chart.setOption(optionRef.current, true);
        } catch (e) {
          // 不吞异常：配置有问题时要能从控制台看到原因（此前静默失败会表现为「画布空白」）
          console.error('[EChart] 图表配置渲染失败：', e);
          setFailed(true);
          return;
        }
        // 再等一帧 resize 一次：字体 / 滚动条 / 折叠动画可能改变可用宽高
        raf = requestAnimationFrame(() => {
          if (!disposed) chartRef.current?.resize();
        });
      };

      boot();

      const ro = new ResizeObserver(() => {
        if (chartRef.current) chartRef.current.resize();
        else boot(); // 首次拿到尺寸时初始化
      });
      ro.observe(el);

      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        chartRef.current?.dispose();
        chartRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
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
    // ready 变化会重新执行本 effect：若初始化被推迟到拿到尺寸之后，事件仍能绑上
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
