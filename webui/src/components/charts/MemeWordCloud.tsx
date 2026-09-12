/**
 * 梗词云（REQ-020 ~ REQ-024）
 * · 字号 = 该梗出现频率（口径可切换：累计 / 指定时间窗）
 * · 颜色 = 梗类型（口头禅 / 内部梗 / 表情包梗，≤3 类）并带图例
 * · 悬停显示：出现次数、首现时间、最近调用、类型（REQ-024）
 * · 布局切换：按热度 / 按首次出现时间（后者每个词下标注首现日期 —— REQ-023）
 * · 点击任意词 → 在该词位置展开梗单元（REQ-022，由调用方处理定位）
 * 词云是 ECharts 的扩展图表（echarts-wordcloud），同样按需懒加载。
 */
import { useCallback, useMemo } from 'react';
import type { CloudLayout, MemeCloudEntry, MemeType } from '@/types';
import { MEME_TYPE_COLOR, MEME_TYPE_LABEL } from '@/types';
import { fmtMD } from '@/lib/format';
import { EChart } from './EChart';

/** echarts-wordcloud 依赖 echarts 全局注册，故在绘制前动态引入 */
const prepareWordCloud = async () => {
  await import('echarts-wordcloud');
};

export function MemeWordCloud({
  entries,
  layout,
  onPick,
  height = 420,
}: {
  entries: MemeCloudEntry[];
  layout: CloudLayout;
  onPick: (e: MemeCloudEntry, position?: { x: number; y: number }) => void;
  height?: number;
}) {
  const option = useMemo(() => {
    const max = Math.max(...entries.map((e) => e.frequency), 1);
    const min = Math.min(...entries.map((e) => e.frequency), 0);
    return {
      tooltip: {
        confine: true,
        backgroundColor: 'rgba(11,15,23,0.92)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: unknown) => {
          const e = (p as { data: { entry: MemeCloudEntry } }).data.entry;
          // REQ-024：悬停显示四项
          return [
            `<b style="font-size:13px">${e.name}</b>`,
            `出现次数：${e.occurrences} 次（本口径 ${e.frequency}）`,
            `首次出现：${fmtMD(e.firstSeenAt)}`,
            `最近调用：${fmtMD(e.lastUsedAt)}`,
            `类型：${MEME_TYPE_LABEL[e.type]}`,
          ].join('<br/>');
        },
      },
      series: [
        {
          type: 'wordCloud',
          shape: 'circle',
          left: 0,
          right: 0,
          top: 8,
          bottom: 8,
          sizeRange: [14, 58],
          rotationRange: layout === 'firstSeen' ? [0, 0] : [-45, 45],
          rotationStep: 45,
          gridSize: 10,
          drawOutOfBound: false,
          layoutAnimation: true,
          textStyle: {
            fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
            fontWeight: 700,
            color: (p: unknown) => MEME_TYPE_COLOR[(p as { data: { entry: MemeCloudEntry } }).data.entry.type as MemeType],
          },
          // 按首次出现时间布局时，在词下标注首现日期（REQ-023）
          data: entries.map((e) => ({
            name: layout === 'firstSeen' ? `${e.name}\n${e.firstSeenAt.slice(5, 10)}` : e.name,
            value: e.frequency,
            entry: e,
          })),
          emphasis: { textStyle: { textShadowBlur: 12, textShadowColor: 'rgba(7,193,96,0.45)' } },
        },
      ],
      aria: { enabled: true, description: `梗词云，共 ${entries.length} 个梗，取值范围 ${min}~${max} 次` },
    } as Record<string, unknown>;
  }, [entries, layout]);

  const onEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const p = params as { data?: { entry?: MemeCloudEntry }; event?: { offsetX: number; offsetY: number } };
        if (p.data?.entry) onPick(p.data.entry, p.event ? { x: p.event.offsetX, y: p.event.offsetY } : undefined);
      },
    }),
    [onPick],
  );

  const prepare = useCallback(() => prepareWordCloud().then(() => undefined), []);

  return <EChart option={option} height={height} onEvents={onEvents} prepare={prepare} />;
}
