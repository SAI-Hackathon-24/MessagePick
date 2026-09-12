import { ArrowRight, Clock, Flame, Timer, TrendingUp, Users, Wand2 } from 'lucide-react';
import { MEME_CATEGORY_LABEL, type MemeCard as MemeCardType } from '@/types';
import { cn } from '@/lib/cn';
import { fmtMD, num } from '@/lib/format';
import { Sparkline } from '@/components/charts';
import { Badge, Card } from '@/components/ui';

/**
 * 梗卡片单元（Meme Card Unit）
 * 字段直接对应 目标.md 对梗卡片的要求：
 *   首次出现时间 / 最近一次调用时间 / 按时间划分的分布图
 * 额外展示：生命周期、趋势迷你图、主要贡献者、代表消息 —— 全部可选渲染，
 * 后端字段缺失时自动隐藏对应区块（可扩展）。
 */
export function MemeCardView({
  meme,
  active,
  onOpen,
  onRemix,
  className,
}: {
  meme: MemeCardType;
  active?: boolean;
  onOpen: () => void;
  onRemix?: () => void;
  className?: string;
}) {
  const peak = meme.trend.reduce((best, p) => (p.count > best.count ? p : best), meme.trend[0] ?? { date: '—', count: 0 });
  const trendValues = meme.trend.map((t) => t.count);

  return (
    <Card
      hover
      className={cn('flex flex-col gap-3 p-4', active && 'border-jade-500/50 ring-2 ring-jade-500/15', className)}
      onClick={onOpen}
    >
      {/* 头部：词 + 类别 + 次数 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[17px] font-bold text-ink-800">{meme.term}</h3>
            <Badge tone="jade">{MEME_CATEGORY_LABEL[meme.category]}</Badge>
            {meme.confidence !== undefined && meme.confidence < 0.75 && <Badge tone="amber">置信度低</Badge>}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-500">{meme.meaning}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1 text-lg font-bold tabular-nums text-jade-700">
            <Flame size={14} className="text-amber-500" />
            {num(meme.count)}
          </div>
          <div className="mp-meta">次使用</div>
        </div>
      </div>

      {/* 趋势迷你图 */}
      {trendValues.length > 1 && (
        <div className="flex items-end justify-between gap-3">
          <Sparkline data={trendValues} width={150} height={30} />
          <div className="mp-meta text-right">
            峰值 {peak?.date} · {peak?.count} 次
          </div>
        </div>
      )}

      {/* 时间指标：目标.md 的核心要求 */}
      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-ink-900/[0.03] px-3 py-2">
        <div>
          <dt className="mp-meta inline-flex items-center gap-1">
            <Clock size={10} /> 首次出现
          </dt>
          <dd className="mt-0.5 text-[12px] font-medium tabular-nums text-ink-700">{fmtMD(meme.first_seen)}</dd>
        </div>
        <div>
          <dt className="mp-meta inline-flex items-center gap-1">
            <TrendingUp size={10} /> 最近调用
          </dt>
          <dd className="mt-0.5 text-[12px] font-medium tabular-nums text-ink-700">{fmtMD(meme.last_seen)}</dd>
        </div>
        <div>
          <dt className="mp-meta inline-flex items-center gap-1">
            <Timer size={10} /> 生命周期
          </dt>
          <dd className="mt-0.5 text-[12px] font-medium tabular-nums text-ink-700">
            {meme.lifespan_days} 天{meme.lifespan_days < 14 && <span className="ml-1 text-coral-500">已凉</span>}
          </dd>
        </div>
      </dl>

      {/* 来源群 + 贡献者 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="mp-meta inline-flex items-center gap-1">
          <Users size={11} />
          {meme.chats.slice(0, 2).join('、')}
          {meme.chats.length > 2 && ` 等 ${meme.chats.length} 个群`}
        </span>
        <span className="mp-meta">主推：{meme.top_contributors.slice(0, 2).map((c) => c.name).join('、') || '—'}</span>
      </div>

      {/* 操作区（阻止冒泡，避免误触卡片） */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink-900/[0.06] pt-2.5">
        <span className="mp-meta inline-flex items-center gap-1 text-jade-700">
          查看梗卡片 <ArrowRight size={11} />
        </span>
        {onRemix && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemix();
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-jade-500/30 bg-jade-500/[0.08] px-2.5 py-1 text-[11px] font-medium text-jade-700 transition-colors hover:bg-jade-500/15"
          >
            <Wand2 size={11} />
            再生成
          </button>
        )}
      </div>
    </Card>
  );
}
