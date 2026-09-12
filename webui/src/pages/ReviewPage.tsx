/**
 * 梗年鉴 · 全屏翻页回顾（模块一）
 * =============================================================================
 * 交互（使用者要求）：滚轮 / 方向键 / 左右滑动切页，带过渡动画，
 * 底部页码圆点，可随时退出（右上角按钮或 Esc）。
 *
 * 共 6 页：封面 → 总量 → 最热的梗 → 它的诞生 → 一个凉掉的梗 → 结尾（分享卡片）
 * 数据一次取齐（`api.memeYearbook`），翻页不再请求。
 * 数据不足时显示「数据还不够写年鉴」，不报错。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Download, Film, Sparkles, X } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { fmtMD, num } from '@/lib/format';

/** 时间范围只取日期部分（直接切字符串，避免 UTC 与本地时区换算导致差一天） */
const fmtDay = (iso: string) => iso.slice(0, 10);
import { Button } from '@/components/shell/Button';
import type { MemeYearbook } from '@/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';

const PAGE_COUNT = 6;

export default function ReviewPage() {
  const navigate = useNavigate();
  const { filter } = useAppState();
  const yearbook = useApi(() => api.memeYearbook(filter), [JSON.stringify(filter)]);

  const [page, setPage] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [titleLoading, setTitleLoading] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const data = yearbook.data;
  /** 称号的缓存键：群 + 时间范围（使用者要求按此缓存） */
  const groupKey = `${filter.groupIds.join(',') || 'all'}|${filter.timeRange.start ?? ''}~${filter.timeRange.end ?? ''}`;

  const go = useCallback((next: number) => {
    setPage(Math.max(0, Math.min(PAGE_COUNT - 1, next)));
  }, []);

  /* 键盘：方向键 / PgUp / PgDn / Esc */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/meme/cloud');
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        go(page + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        go(page - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, go, navigate]);

  /* 滚轮：React 对同一事件循环内的多次 setState 会批处理，因此连续滚动只前进一页 */
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 12) return;
    go(page + (e.deltaY > 0 ? 1 : -1));
  };

  /* 触屏：左右滑动 */
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) go(page + (dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > 50) go(page + (dy < 0 ? 1 : -1));
    touchStart.current = null;
  };

  /* 第 6 页才生成称号（并命中缓存） */
  useEffect(() => {
    if (page !== PAGE_COUNT - 1 || !data?.enough || title || titleLoading) return;
    setTitleLoading(true);
    void api
      .yearbookTitle(groupKey, (data.topMemes ?? []).map((m) => m.name))
      .then((res) => {
        if (res.ok && res.data) setTitle(res.data.title);
      })
      .finally(() => setTitleLoading(false));
  }, [page, data, title, titleLoading, groupKey]);

  const pages = useMemo(() => {
    if (!data) return [];
    return [
      <Cover key="cover" data={data} onStart={() => go(1)} />,
      <Totals key="totals" data={data} />,
      <TopMeme key="top" data={data} />,
      <Birth key="birth" data={data} />,
      <Faded key="faded" data={data} />,
      <Ending key="ending" data={data} title={title} loading={titleLoading} />,
    ];
  }, [data, title, titleLoading, go]);

  if (yearbook.loading && !data) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <LoadingState label="正在整理这一期的群文化…" rows={2} />
      </div>
    );
  }
  if (yearbook.error) {
    return <ErrorState error={yearbook.error} onRetry={yearbook.refetch} onBack={() => navigate('/meme/cloud')} />;
  }
  if (!data) return null;

  if (!data.enough) {
    return (
      <div className="mx-auto max-w-2xl py-16" data-testid="yearbook-insufficient">
        <EmptyState
          title="数据还不够写年鉴"
          description="要写年鉴至少需要 3 个梗、且最热的梗被使用过 5 次以上。可以扩大时间范围或选择更活跃的群。"
          action={
            <Button onClick={() => navigate('/meme/cloud')} icon={ArrowRight}>
              回到梗词云
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-br from-ink-950 via-ink-900 to-jade-900 text-white"
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      data-testid="yearbook"
    >
      {/* 退出 */}
      <button
        type="button"
        data-testid="yearbook-exit"
        onClick={() => navigate('/meme/cloud')}
        className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur transition-colors hover:bg-white/20"
      >
        <X size={13} /> 退出（Esc）
      </button>

      {/* 页眉：群名 + 页码 */}
      <header className="flex items-center justify-between px-6 pt-5 text-xs text-white/60">
        <span className="truncate">{data.groupName}</span>
        <span className="tabular-nums">
          {page + 1} / {PAGE_COUNT}
        </span>
      </header>

      {/* 页面主体：切换时按方向做淡入 + 位移过渡 */}
      <main className="relative flex min-h-0 flex-1 items-center justify-center px-6">
        {pages.map((node, i) => (
          <section
            key={i}
            aria-hidden={i !== page}
            className={cn(
              'absolute inset-0 flex items-center justify-center px-6 transition-all duration-500 ease-out',
              i === page ? 'pointer-events-auto translate-x-0 opacity-100' : 'pointer-events-none opacity-0',
              i !== page && (i < page ? '-translate-x-6' : 'translate-x-6'),
            )}
          >
            <div className="w-full max-w-3xl">{node}</div>
          </section>
        ))}
      </main>

      {/* 底部：页码圆点 + 左右提示 */}
      <footer className="flex items-center justify-center gap-4 pb-6">
        <button type="button" onClick={() => go(page - 1)} disabled={page === 0} className="text-xs text-white/50 disabled:opacity-30">
          ← 上一页
        </button>
        <div className="flex items-center gap-2" data-testid="yearbook-dots">
          {Array.from({ length: PAGE_COUNT }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 页`}
              onClick={() => go(i)}
              className={cn('h-2 rounded-full transition-all', i === page ? 'w-6 bg-white' : 'w-2 bg-white/35 hover:bg-white/60')}
            />
          ))}
        </div>
        <button type="button" onClick={() => go(page + 1)} disabled={page === PAGE_COUNT - 1} className="text-xs text-white/50 disabled:opacity-30">
          下一页 →
        </button>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 六页内容                                                                    */
/* -------------------------------------------------------------------------- */

function Cover({ data, onStart }: { data: MemeYearbook; onStart: () => void }) {
  const d = data;
  return (
    <div className="text-center">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
        <Film size={12} /> 群聊梗年鉴
      </div>
      <h1 className="text-4xl font-bold leading-tight sm:text-6xl">{d.groupName}</h1>
      <p className="mt-4 text-sm text-white/60">
        {fmtDay(d.range.start)} ~ {fmtDay(d.range.end)}
      </p>
      <Button onClick={onStart} className="mt-10 !bg-white !px-6 !py-2.5 !text-sm !text-ink-900 hover:!bg-white/90" icon={ArrowRight}>
        开始
      </Button>
      <p className="mp-meta mt-4 text-white/40">滚轮 / 方向键 / 左右滑动翻页</p>
    </div>
  );
}

function Totals({ data }: { data: { totalMessages: number; memeMessages: number } }) {
  const ratio = data.totalMessages ? Math.round((data.memeMessages / data.totalMessages) * 100) : 0;
  return (
    <div className="grid gap-10 text-center sm:grid-cols-2">
      <BigNumber label="这段时间的消息总数" value={data.totalMessages} unit="条" />
      <BigNumber label="其中玩梗消息" value={data.memeMessages} unit="条" hint={`占全部消息的 ${ratio}%`} />
    </div>
  );
}

function TopMeme({ data }: { data: { topMeme?: { name: string; occurrences: number } } }) {
  if (!data.topMeme) return <Fallback />;
  return (
    <div className="text-center">
      <div className="text-xs uppercase tracking-widest text-white/50">最热的梗</div>
      <h2 className="mt-4 break-all text-5xl font-black leading-tight sm:text-7xl">{data.topMeme.name}</h2>
      <p className="mt-6 text-lg text-white/70">
        被说了 <span className="text-3xl font-bold tabular-nums text-amber-300">{num(data.topMeme.occurrences)}</span> 次
      </p>
    </div>
  );
}

function Birth({ data }: { data: { topMemeBirth?: { memeName: string; senderName: string; text: string; sentAt: string; groupName: string } } }) {
  const b = data.topMemeBirth;
  if (!b) return <Fallback />;
  return (
    <div>
      <div className="mb-6 text-center text-xs uppercase tracking-widest text-white/50">它的诞生</div>
      <div className="mx-auto max-w-xl">
        {/* 聊天气泡样式：昵称 + 原文 + 日期 */}
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jade-500/25 text-sm font-semibold">
            {b.senderName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
              <span className="font-medium text-white/85">{b.senderName}</span>
              <span className="tabular-nums">{fmtMD(b.sentAt)}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5">{b.groupName}</span>
            </div>
            <div className="relative rounded-2xl rounded-tl-sm bg-white/12 px-4 py-3 text-[15px] leading-relaxed backdrop-blur">
              {b.text}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-white/60">
          这是「{b.memeName}」在群里的第一次出现。
        </p>
      </div>
    </div>
  );
}

function Faded({ data }: { data: { fadedMeme?: { name: string; peakLabel: string; occurrences: number; silentDays: number } } }) {
  const m = data.fadedMeme;
  if (!m) return <Fallback />;
  const [y, mo] = m.peakLabel.split('-');
  const peakText = y && mo ? `${Number(mo)} 月` : m.peakLabel;
  return (
    <div className="text-center" data-testid="yearbook-faded">
      <div className="text-xs uppercase tracking-widest text-white/50">一个凉掉的梗</div>
      <h2 className="mt-4 break-all text-4xl font-black leading-tight text-white/85 sm:text-6xl">{m.name}</h2>
      <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/60">
        它在 <span className="font-semibold text-amber-300">{peakText}</span> 达到高潮，之后再也无人问津。
      </p>
      <p className="mt-4 text-sm text-white/45">
        共出现 {num(m.occurrences)} 次 · 已沉寂 {m.silentDays} 天
      </p>
    </div>
  );
}

function Ending({ data, title, loading }: { data: { groupName: string; topMemes: { name: string }[] }; title: string | null; loading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** 导出分享卡片（canvas → PNG）。纯前端绘制，不依赖后端。 */
  const exportCard = () => {
    const W = 1080;
    const H = 1440;
    const cv = canvasRef.current ?? document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return;
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0b0f17');
    grad.addColorStop(1, '#06502d');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText('群聊梗年鉴', 80, 140);

    g.fillStyle = '#ffffff';
    g.font = 'bold 60px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(data.groupName.slice(0, 14), 80, 240);

    g.fillStyle = '#fbbf24';
    g.font = 'bold 84px "PingFang SC", "Microsoft YaHei", sans-serif';
    const t = title ?? '这一期还写不出称号';
    g.fillText(t.slice(0, 9), 80, 420);
    if (t.length > 9) g.fillText(t.slice(9, 18), 80, 520);

    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = '34px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText('本期 Top 梗', 80, 640);
    g.fillStyle = '#ffffff';
    g.font = '40px "PingFang SC", "Microsoft YaHei", sans-serif';
    data.topMemes.slice(0, 10).forEach((m, i) => {
      g.fillText(`${i + 1}. ${m.name}`, 80, 710 + i * 58);
    });

    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText('聊斋 MessagePick · 本机生成', 80, H - 80);

    const url = cv.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `梗年鉴-${data.groupName}.png`;
    a.click();
  };

  return (
    <div className="text-center" data-testid="yearbook-ending">
      <div className="text-xs uppercase tracking-widest text-white/50">这一期的群称号</div>
      {loading ? (
        <p className="mt-6 text-lg text-white/60">正在根据 Top10 梗生成称号…</p>
      ) : (
        <h2 className="mx-auto mt-6 max-w-2xl break-all text-4xl font-black leading-tight text-amber-300 sm:text-6xl">{title ?? '这一期还写不出称号'}</h2>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {data.topMemes.slice(0, 6).map((m) => (
          <span key={m.name} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white/70">
            {m.name}
          </span>
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={exportCard} data-testid="yearbook-export" icon={Download} className="!bg-white !px-4 !py-2 !text-ink-900 hover:!bg-white/90">
          保存分享卡片
        </Button>
        <span className="mp-meta text-white/40">导出为 PNG，可用于群内分享</span>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

function Fallback() {
  return (
    <div className="text-center text-white/60">
      <Sparkles size={22} className="mx-auto mb-3 opacity-60" />
      <p className="text-lg">这一页还需要更多数据</p>
    </div>
  );
}

function BigNumber({ label, value, unit, hint }: { label: string; value: number; unit: string; hint?: string }) {
  const [shown, setShown] = useState(0);
  /* 数字动效：进入后 700ms 内从 0 递增到目标值 */
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tickFn = (now: number) => {
      const k = Math.min(1, (now - start) / 700);
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tickFn);
    };
    raf = requestAnimationFrame(tickFn);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-white/50">{label}</div>
      <div className="mt-3 text-6xl font-black tabular-nums sm:text-7xl">{num(shown)}</div>
      <div className="mt-1 text-sm text-white/60">{unit}</div>
      {hint && <div className="mt-1 text-xs text-white/45">{hint}</div>}
    </div>
  );
}
