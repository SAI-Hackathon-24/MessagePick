import { useCallback, useMemo, useState } from 'react';
import { Filter, Layers3, RefreshCw, SlidersHorizontal, Sparkles, Timer, Zap } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/app/appState';
import { MEME_CATEGORY_LABEL, type MemeCard, type MemeCategory, type WordCloudItem, type WordCloudLayout } from '@/types';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { MemeCardView } from '@/components/meme/MemeCardView';
import { MemeDetailDrawer } from '@/components/meme/MemeDetailDrawer';
import { MemeTimeline, TimelineIntro } from '@/components/meme/MemeTimeline';
import { WordCloud } from '@/components/meme/WordCloud';
import { CouplingNote, ModuleScaffold } from '@/components/scaffold/ModuleScaffold';
import { Chip, EmptyState, ErrorState, LoadingState, SectionHeading, Stat } from '@/components/ui';

type SortKey = 'hot' | 'recent' | 'lifespan';

/**
 * 功能一 · 群聊梗分析（MemeRadar）
 * ---------------------------------------------------------------------------
 * 页面结构（对应目标.md）：
 *   ① 顶部指标条 —— 提炼规模 / 生命周期 / 活跃梗
 *   ② 可点击词云 —— 支持 词云 / 热度排行 / 按出现时间 三种布局
 *   ③ 梗卡片网格 —— 首现时间、最近调用、分布图、再生成入口
 *   ④ 梗时间轴 —— 生命线（甘特）+ 热度编组
 *   ⑤ 再生成等未定稿能力的挂载点
 */
export default function MemePage() {
  const { chats } = useAppState();
  const [layout, setLayout] = useState<WordCloudLayout>('cloud');
  const [sort, setSort] = useState<SortKey>('hot');
  const [category, setCategory] = useState<MemeCategory | 'all'>('all');
  const [minCount, setMinCount] = useState(0);
  const [selected, setSelected] = useState<MemeCard | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const cloud = useApi(() => api.getWordCloud(chats, layout), [chats.join(','), layout]);
  const memes = useApi(() => api.listMemes(chats, sort), [chats.join(','), sort]);

  const all = memes.data ?? [];
  const filtered = useMemo(
    () => all.filter((m) => (category === 'all' || m.category === category) && m.count >= minCount),
    [all, category, minCount],
  );

  const cloudItems = useMemo(() => {
    const base = cloud.data ?? [];
    const allowed = new Set(filtered.map((m) => m.term));
    return base.filter((i) => allowed.has(i.term));
  }, [cloud.data, filtered]);

  const openMeme = useCallback(
    (m: MemeCard) => {
      setSelected(m);
      setDrawerOpen(true);
    },
    [],
  );

  const openByWord = useCallback(
    (item: WordCloudItem) => {
      const found = all.find((m) => m.id === item.meme_id || m.term === item.term);
      if (found) openMeme(found);
    },
    [all, openMeme],
  );

  const stats = useMemo(() => {
    if (!all.length) return null;
    const totalUse = all.reduce((s, m) => s + m.count, 0);
    const avgLife = Math.round(all.reduce((s, m) => s + m.lifespan_days, 0) / all.length);
    const alive = all.filter((m) => m.lifespan_days >= 30).length;
    const top = all.reduce((a, b) => (b.count > a.count ? b : a), all[0]);
    return { totalUse, avgLife, alive, top };
  }, [all]);

  const categoryCounts = useMemo(() => {
    const map = new Map<MemeCategory, number>();
    all.forEach((m) => map.set(m.category, (map.get(m.category) ?? 0) + 1));
    return map;
  }, [all]);

  const loading = cloud.loading || memes.loading;
  const error = cloud.error ?? memes.error;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* ① 顶部指标条 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="提炼出的梗" value={all.length} unit="个" hint={chats.length ? `范围：${chats.length} 个群` : '范围：全部群聊'} icon={Sparkles} />
        <Stat label="梗提及总量" value={stats ? num(stats.totalUse) : '—'} unit="次" hint="用于计算词云字号权重" icon={Zap} tone="amber" />
        <Stat label="平均生命周期" value={stats?.avgLife ?? '—'} unit="天" hint="首现 → 最近一次被调用" icon={Timer} tone="ink" />
        <Stat label="存活超过 30 天的梗" value={stats?.alive ?? '—'} unit="个" hint="仍在群文化中循环使用" icon={Layers3} tone="jade" />
      </section>

      {error && <ErrorState code={error.code} message={error.message} hint={error.hint} onRetry={() => { cloud.refetch(); memes.refetch(); }} />}

      {/* ② 可点击词云 */}
      <section>
        <SectionHeading
          title="梗词云"
          hint="字号 = 使用频次；点任意词条打开梗卡片。可切换为「按出现时间」排序，看梗的诞生顺序"
          right={
            <div className="flex items-center gap-2">
              <span className="mp-meta hidden sm:inline">上次分析 {cloud.data ? `${cloud.data.length} 个候选词` : '—'}</span>
              <button
                type="button"
                onClick={() => {
                  cloud.refetch();
                  memes.refetch();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700"
              >
                <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
                重新提炼
              </button>
            </div>
          }
        />
        {loading && !cloud.data ? (
          <LoadingState label="正在从群消息中提炼热梗…" rows={2} />
        ) : (
          <WordCloud items={cloudItems} layout={layout} onLayoutChange={setLayout} onSelect={openByWord} activeTerm={selected?.term} />
        )}
      </section>

      {/* ③ 梗卡片网格 */}
      <section>
        <SectionHeading
          title="梗卡片"
          hint="每张卡片都包含：首次出现时间、最近一次调用时间、按时间划分的使用分布，以及再生成入口"
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mp-meta inline-flex items-center gap-1">
                <Filter size={11} /> 类别
              </span>
              <Chip active={category === 'all'} onClick={() => setCategory('all')} count={all.length}>
                全部
              </Chip>
              {(Object.keys(MEME_CATEGORY_LABEL) as MemeCategory[]).map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)} count={categoryCounts.get(c) ?? 0}>
                  {MEME_CATEGORY_LABEL[c]}
                </Chip>
              ))}
              <span className="mx-1 h-4 w-px bg-ink-900/10" />
              <span className="mp-meta inline-flex items-center gap-1">
                <SlidersHorizontal size={11} /> 排序
              </span>
              {(
                [
                  { k: 'hot', label: '最热' },
                  { k: 'recent', label: '最近仍在用' },
                  { k: 'lifespan', label: '活得最久' },
                ] as { k: SortKey; label: string }[]
              ).map((s) => (
                <Chip key={s.k} active={sort === s.k} onClick={() => setSort(s.k)}>
                  {s.label}
                </Chip>
              ))}
              <span className="mp-meta inline-flex items-center gap-1">
                最少提及
                <select
                  value={minCount}
                  onChange={(e) => setMinCount(Number(e.target.value))}
                  className="ml-1 rounded-lg border border-ink-900/[0.1] bg-white px-1.5 py-0.5 text-[11px] tabular-nums text-ink-600 outline-none"
                >
                  {[0, 50, 100, 200, 400].map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? '不限' : `${v} 次`}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          }
        />

        {loading && !memes.data ? (
          <LoadingState label="正在生成梗卡片…" rows={3} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={all.length ? '当前筛选条件下没有梗卡片' : '还没有提炼出梗'}
            description={all.length ? '试着放宽「类别」或把「最少提及」调低。' : '换一个时间范围或群聊；群消息量太少时模型置信度会偏低，属于预期行为。'}
            action={
              all.length ? (
                <button type="button" onClick={() => { setCategory('all'); setMinCount(0); }} className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800">
                  重置筛选
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m) => (
              <MemeCardView key={m.id} meme={m} active={selected?.id === m.id} onOpen={() => openMeme(m)} onRemix={() => openMeme(m)} />
            ))}
          </div>
        )}
      </section>

      {/* ④ 梗时间轴 */}
      <section>
        <TimelineIntro />
        <MemeTimeline memes={filtered} onSelect={openMeme} />
      </section>

      {/* ⑤ 未定稿能力的挂载点 */}
      <ModuleScaffold
        title="梗的再生成 · 更多形态"
        subtitle="目标.md 中「梗的再生成：1. 生成表情包 2. ……」尚未写完，此处预留可扩展位"
        planned={['表情包（多帧/配文）', '群文化海报', '月度梗总结卡', '梗关系图谱', '跨群梗迁移追踪']}
        note="新增形态时：在 types.ts 的 RemixKind 里加枚举 → REMIX_KIND_LABEL 加中文名 → 抽屉里自动出现新按钮，无需改布局。"
      />

      <CouplingNote module="core / LLM 接口" />

      {/* 梗详情抽屉 */}
      <MemeDetailDrawer meme={selected} allMemes={all} open={drawerOpen} onClose={() => setDrawerOpen(false)} onSelectMeme={(m) => setSelected(m)} />
    </div>
  );
}
