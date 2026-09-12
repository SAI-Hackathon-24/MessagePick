/**
 * 可点击词云（Meme Cloud）
 * ---------------------------------------------------------------------------
 * · 支持三种布局切换：cloud（词云）/ rank（热度排行）/ time（按出现时间排序）
 * · 词条可点击 → 回调选中梗（打开梗卡片抽屉）
 * · 放不下的长尾词条自动收纳到下方「长尾词」，不丢失信息
 * · 字号/颜色由权重映射；颜色按梗类别区分，形成可读的视觉分组
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Clock, ListOrdered } from 'lucide-react';
import { MEME_CATEGORY_LABEL, type MemeCategory, type WordCloudItem, type WordCloudLayout } from '@/types';
import { cn } from '@/lib/cn';
import { heatColor, num } from '@/lib/format';
import { layoutCloud } from '@/lib/wordcloud-layout';
import { BarList } from '@/components/charts';
import { EmptyState } from '@/components/ui';

const CATEGORY_COLOR: Record<MemeCategory, string> = {
  catchphrase: '#047a3f',
  slang: '#0ea5e9',
  sticker: '#f59e0b',
  event: '#8b5cf6',
  nickname: '#fb7185',
};

const LAYOUT_TABS: { key: WordCloudLayout; label: string; icon: typeof Cloud; hint: string }[] = [
  { key: 'cloud', label: '词云', icon: Cloud, hint: '字号 = 使用频次，可点击' },
  { key: 'rank', label: '热度排行', icon: ListOrdered, hint: '按使用次数降序' },
  { key: 'time', label: '按出现时间', icon: Clock, hint: '按首次出现时间排序' },
];

export function WordCloud({
  items,
  layout,
  onLayoutChange,
  onSelect,
  activeTerm,
  className,
}: {
  items: WordCloudItem[];
  layout: WordCloudLayout;
  onLayoutChange: (l: WordCloudLayout) => void;
  onSelect: (item: WordCloudItem) => void;
  activeTerm?: string;
  className?: string;
}) {
  if (!items.length) {
    return <EmptyState title="没有提炼到梗" description="换一个时间范围或群聊试试；也可能该群消息量不足，模型置信度低。" />;
  }
  return (
    <div className={cn('mp-card overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-900/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1">
          {LAYOUT_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onLayoutChange(t.key)}
              title={t.hint}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                layout === t.key ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700',
              )}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>
        <Legend />
      </div>

      {layout === 'cloud' && <CloudCanvas items={items} onSelect={onSelect} activeTerm={activeTerm} />}
      {layout === 'rank' && (
        <div className="px-4 py-4">
          <BarList items={items.map((i) => ({ label: i.term, value: i.count, hint: i.category ? MEME_CATEGORY_LABEL[i.category] : undefined, onClick: () => onSelect(i) }))} />
        </div>
      )}
      {layout === 'time' && (
        <ol className="relative px-4 py-4">
          <span className="absolute bottom-6 left-[26px] top-6 w-px bg-ink-900/[0.09]" aria-hidden />
          {items.map((i) => (
            <li key={i.term} className="relative flex items-center gap-3 py-2 pl-0">
              <span className="z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-white bg-jade-500 ring-1 ring-jade-500/30" />
              <button
                type="button"
                onClick={() => onSelect(i)}
                className={cn(
                  'flex flex-1 items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:border-jade-500/25 hover:bg-jade-500/[0.06]',
                  activeTerm === i.term && 'border-jade-500/40 bg-jade-500/[0.08]',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink-800">{i.term}</span>
                  {i.category && (
                    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ color: CATEGORY_COLOR[i.category], background: `${CATEGORY_COLOR[i.category]}1a` }}>
                      {MEME_CATEGORY_LABEL[i.category]}
                    </span>
                  )}
                </span>
                <span className="text-xs tabular-nums text-ink-400">
                  首现 {i.first_seen ?? '—'} · {num(i.count)} 次
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CloudCanvas({ items, onSelect, activeTerm }: { items: WordCloudItem[]; onSelect: (i: WordCloudItem) => void; activeTerm?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 360 });

  const measure = useCallback(() => {
    if (!ref.current) return;
    setSize({ w: ref.current.clientWidth, h: ref.current.clientHeight });
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure]);

  const { placed, overflow } = useMemo(() => {
    if (!size.w) return { placed: [], overflow: [] as WordCloudItem[] };
    const words = layoutCloud(
      items,
      (i) => i.term,
      (i) => i.count,
      { width: size.w, height: size.h, minSize: 13, maxSize: 56, rotateRatio: 0.16, scaleExponent: 1.15 },
    );
    return {
      placed: words.filter((w) => w.placed),
      overflow: words.filter((w) => !w.placed).map((w) => w.item),
    };
  }, [items, size]);

  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="px-4 py-3">
      <div ref={ref} className="relative h-[360px] w-full overflow-hidden rounded-xl bg-gradient-to-br from-jade-500/[0.04] via-transparent to-amber-500/[0.05]">
        {placed.map((w) => {
          const intensity = Math.pow(w.item.count / maxCount, 0.6);
          const color = w.item.category ? CATEGORY_COLOR[w.item.category] : heatColor(intensity);
          const isActive = activeTerm === w.item.term;
          return (
            <button
              key={w.item.term}
              type="button"
              onClick={() => onSelect(w.item)}
              title={`${w.item.term} · ${num(w.item.count)} 次${w.item.category ? ` · ${MEME_CATEGORY_LABEL[w.item.category]}` : ''}`}
              className={cn(
                'absolute origin-center select-none whitespace-nowrap font-semibold leading-none transition-all duration-200 hover:scale-[1.08] hover:opacity-100',
                isActive ? 'z-10 opacity-100' : 'opacity-90',
              )}
              style={{
                left: w.x,
                top: w.y,
                width: w.w,
                height: w.h,
                fontSize: w.size,
                color,
                transform: w.rotate === 90 ? 'rotate(90deg)' : undefined,
                textShadow: isActive ? `0 0 18px ${color}55` : undefined,
              }}
            >
              {w.item.term}
            </button>
          );
        })}
        {!placed.length && size.w > 0 && (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="词云区域太小" description="当前宽度放不下任何词条，已自动切换为长尾列表展示。" />
          </div>
        )}
      </div>

      {overflow.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mp-meta mr-1">长尾词（未放入词云）</span>
          {overflow.map((i) => (
            <button
              key={i.term}
              type="button"
              onClick={() => onSelect(i)}
              className="mp-chip hover:border-jade-500/40 hover:text-jade-700"
            >
              {i.term}
              <span className="text-[10px] text-ink-400">{i.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {(Object.keys(CATEGORY_COLOR) as MemeCategory[]).map((c) => (
        <span key={c} className="inline-flex items-center gap-1 text-[11px] text-ink-400">
          <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLOR[c] }} />
          {MEME_CATEGORY_LABEL[c]}
        </span>
      ))}
    </div>
  );
}
