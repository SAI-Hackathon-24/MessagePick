import { useEffect, useState } from 'react';
import { Image as ImageIcon, Layers, MessageSquareQuote, Sparkles, Wand2 } from 'lucide-react';
import { api } from '@/api';
import { MEME_CATEGORY_LABEL, REMIX_KIND_LABEL, type MemeCard, type MemeRemixJob, type RemixKind } from '@/types';
import { cn } from '@/lib/cn';
import { fmtMD, num } from '@/lib/format';
import { DistributionBars, MiniStat, TrendArea } from '@/components/charts';
import { Badge, Drawer, LoadingState, NoticeBar } from '@/components/ui';

const REMIX_STYLES = ['默认群聊风', '赛博霓虹', '水墨聊斋', '像素复古', '极简黑白'];

/**
 * 梗详情抽屉 —— 点词云 / 点卡片后的落地页
 * 包含：分布图、生命周期、贡献者、代表消息、再创作（目标.md：生成表情包 ……）
 */
export function MemeDetailDrawer({
  meme,
  allMemes,
  open,
  onClose,
  onSelectMeme,
}: {
  meme: MemeCard | null;
  allMemes: MemeCard[];
  open: boolean;
  onClose: () => void;
  onSelectMeme: (m: MemeCard) => void;
}) {
  const [kind, setKind] = useState<RemixKind>('sticker');
  const [style, setStyle] = useState(REMIX_STYLES[0]);
  const [job, setJob] = useState<MemeRemixJob | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setJob(null);
  }, [meme?.id]);

  if (!meme) return null;

  const runRemix = async () => {
    setBusy(true);
    const res = await api.remixMeme(meme.id, kind, style);
    setBusy(false);
    if (res.ok) setJob(res.data);
    else setJob({ id: 'err', meme_id: meme.id, kind, status: 'failed', results: [], created_at: new Date().toISOString(), error: res.error });
  };

  const related = allMemes.filter((m) => meme.related_ids?.includes(m.id)).slice(0, 4);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={
        <span className="flex items-center gap-2">
          <span className="text-lg font-bold">{meme.term}</span>
          <Badge tone="jade">{MEME_CATEGORY_LABEL[meme.category]}</Badge>
          {meme.confidence !== undefined && <Badge tone={meme.confidence >= 0.75 ? 'sky' : 'amber'}>置信度 {(meme.confidence * 100).toFixed(0)}%</Badge>}
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>首现 {fmtMD(meme.first_seen)}</span>
          <span>最近 {fmtMD(meme.last_seen)}</span>
          <span>生命 {meme.lifespan_days} 天</span>
          <span>{num(meme.count)} 次使用</span>
          <span>来源：{[...new Set(meme.chats)].join('、')}</span>
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="mp-meta">再创作产物可用于微信表情、收藏或直接发回群聊（接口：POST /api/remix）</span>
          <button
            type="button"
            onClick={runRemix}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-jade-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-jade-700 disabled:opacity-60"
          >
            <Wand2 size={13} />
            {busy ? '生成中…' : `生成${REMIX_KIND_LABEL[kind]}`}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* AI 释义 */}
        <section className="rounded-2xl border border-jade-500/20 bg-jade-500/[0.06] px-4 py-3">
          <div className="mp-meta mb-1 inline-flex items-center gap-1 text-jade-700">
            <Sparkles size={12} /> AI 释义
          </div>
          <p className="text-sm leading-relaxed text-ink-700">{meme.meaning}</p>
          {meme.context && <p className="mp-meta mt-2">常见语境：{meme.context}</p>}
        </section>

        {/* 核心指标 */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="总使用次数" value={num(meme.count)} tone="jade" />
          <MiniStat label="生命周期" value={`${meme.lifespan_days} 天`} tone={meme.lifespan_days < 14 ? 'coral' : 'ink'} />
          <MiniStat label="活跃时段数" value={meme.timeline.length} />
          <MiniStat label="主要贡献者" value={meme.top_contributors[0]?.name ?? '—'} />
        </section>

        {/* 趋势 + 时间分布（目标.md 明确要求「按时间划分的分布图」） */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="mp-panel p-3.5">
            <div className="mp-section-title mb-2">使用趋势</div>
            <TrendArea points={meme.trend} />
          </div>
          <div className="mp-panel p-3.5">
            <div className="mp-section-title mb-2">按时间划分的分布</div>
            <DistributionBars buckets={meme.timeline} />
          </div>
        </section>

        {/* 贡献者 */}
        <section className="mp-panel p-3.5">
          <div className="mp-section-title mb-2">谁在推动这个梗</div>
          <div className="flex flex-wrap gap-2">
            {meme.top_contributors.map((c) => (
              <span key={c.name} className="mp-chip">
                {c.name}
                <span className="tabular-nums text-ink-400">{c.count}</span>
              </span>
            ))}
          </div>
        </section>

        {/* 代表消息 */}
        <section>
          <div className="mp-section-title mb-2 inline-flex items-center gap-1.5">
            <MessageSquareQuote size={13} /> 代表性原始消息
          </div>
          <ul className="space-y-2">
            {meme.samples.map((s, i) => (
              <li key={i} className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3.5 py-2.5">
                <div className="mp-meta flex items-center gap-2">
                  <span className="font-medium text-ink-600">{s.sender}</span>
                  <span>{s.time}</span>
                  <span className="rounded bg-ink-900/[0.05] px-1.5 py-0.5">{s.chat}</span>
                </div>
                <p className="mt-1 text-sm text-ink-700">{s.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 再创作 */}
        <section className="mp-panel p-3.5">
          <div className="mp-section-title mb-2 inline-flex items-center gap-1.5">
            <Wand2 size={13} /> 梗的再生成
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(REMIX_KIND_LABEL) as RemixKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn('mp-chip', kind === k && 'mp-chip-active')}
              >
                {REMIX_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mp-meta mr-1">风格</span>
            {REMIX_STYLES.map((s) => (
              <button key={s} type="button" onClick={() => setStyle(s)} className={cn('mp-chip', style === s && 'mp-chip-active')}>
                {s}
              </button>
            ))}
          </div>

          {busy && <LoadingState label={`正在生成${REMIX_KIND_LABEL[kind]}…`} rows={1} className="mt-3" />}

          {job?.status === 'done' && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {job.results.map((r, i) => (
                  <figure key={i} className="overflow-hidden rounded-xl border border-ink-900/[0.08] bg-white">
                    <img src={r.url} alt={`${meme.term} ${r.label ?? ''}`} className="aspect-square w-full object-cover" />
                    <figcaption className="mp-meta flex items-center justify-between px-2 py-1.5">
                      <span>{r.label}</span>
                      <span className="inline-flex items-center gap-1 text-jade-700">
                        <ImageIcon size={10} /> 保存
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
              <NoticeBar className="mt-3">
                这是演示占位图（后端接入 llm 出图后替换为真实产物）。prompt：<span className="font-mono">{job.prompt}</span>
              </NoticeBar>
            </>
          )}

          {job?.status === 'failed' && (
            <NoticeBar className="mt-3">生成失败：{job.error?.message ?? '未知错误'}（可重试或更换风格）</NoticeBar>
          )}
        </section>

        {/* 相关梗 */}
        {related.length > 0 && (
          <section>
            <div className="mp-section-title mb-2 inline-flex items-center gap-1.5">
              <Layers size={13} /> 相关梗
            </div>
            <div className="flex flex-wrap gap-1.5">
              {related.map((m) => (
                <button key={m.id} type="button" onClick={() => onSelectMeme(m)} className="mp-chip hover:border-jade-500/40 hover:text-jade-700">
                  {m.term}
                  <span className="text-[10px] text-ink-400">{num(m.count)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}
