/**
 * ECharts 通用容器（HLD 决策 2：图表统一走 ECharts 配置）
 * 仅负责实例生命周期与尺寸自适应，具体配置由调用方给出。
 */
import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export function EChart({ option, height = 320, className, onEvents }: { option: echarts.EChartsOption; height?: number; className?: string; onEvents?: Record<string, (params: unknown) => void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

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
  }, [onEvents]);

  return <div ref={ref} className={cn('w-full', className)} style={{ height }} />;
}
