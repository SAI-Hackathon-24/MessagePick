import { AlertCircle, Inbox, Loader2, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { avatarColor, hashCode } from '@/lib/format';

/* -------------------------------------------------------------------------- */
/* Card —— 所有「卡片 unit」的统一容器，可扩展 header / footer / 操作区          */
/* -------------------------------------------------------------------------- */
export function Card({
  children,
  className,
  hover,
  onClick,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  as?: 'div' | 'button';
}) {
  // 默认渲染为 div：卡片内部通常还有自己的按钮（如「再生成」「标记完成」），
  // 若默认渲染成 <button> 会产生 button 嵌套 button 的非法嵌套（React 会告警，
  // 且各浏览器对嵌套按钮的点击行为不一致）。需要语义化按钮时显式传 as="button"。
  const Comp = as === 'button' ? 'button' : 'div';
  return (
    <Comp
      type={Comp === 'button' ? 'button' : undefined}
      onClick={onClick}
      role={Comp === 'div' && onClick ? 'button' : undefined}
      tabIndex={Comp === 'div' && onClick ? 0 : undefined}
      onKeyDown={
        Comp === 'div' && onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn('mp-card', hover && 'mp-card-hover cursor-pointer', Comp === 'button' && 'text-left', className)}
    >
      {children}
    </Comp>
  );
}

export function CardHeader({ title, subtitle, right, icon: Icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-900/[0.06] px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-jade-500/10 text-jade-600">
            <Icon size={15} />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-800">{title}</div>
          {subtitle && <div className="mp-meta mt-0.5">{subtitle}</div>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chip / Badge                                                               */
/* -------------------------------------------------------------------------- */
export function Chip({
  children,
  active,
  onClick,
  className,
  count,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  count?: number;
}) {
  return (
    <button type="button" onClick={onClick} className={cn('mp-chip', active && 'mp-chip-active', onClick && 'hover:border-jade-500/30', className)}>
      {children}
      {count !== undefined && <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-jade-500/20' : 'bg-ink-900/[0.06]')}>{count}</span>}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'jade' | 'amber' | 'coral' | 'sky' | 'violet'; className?: string }) {
  const tones = {
    neutral: 'bg-ink-900/[0.06] text-ink-600',
    jade: 'bg-jade-500/12 text-jade-700',
    amber: 'bg-amber-500/15 text-amber-600',
    coral: 'bg-coral-500/12 text-coral-500',
    sky: 'bg-sky-500/12 text-sky-600',
    violet: 'bg-violet-500/12 text-violet-600',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>;
}

/* -------------------------------------------------------------------------- */
/* Avatar —— 无外部图片依赖，用首字 + 稳定配色                                   */
/* -------------------------------------------------------------------------- */
export function Avatar({ name, src, size = 32, className }: { name: string; src?: string; size?: number; className?: string }) {
  const color = avatarColor(name);
  return src ? (
    <img src={src} alt={name} width={size} height={size} className={cn('shrink-0 rounded-xl object-cover', className)} />
  ) : (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-xl font-semibold ring-1', color, className)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      title={name}
    >
      {name.slice(0, name.length > 2 ? 1 : 2)}
    </span>
  );
}

/** 姓名 → 稳定的头像色，供自定义容器复用 */
export const nameColorSeed = (name: string) => hashCode(name);

/* -------------------------------------------------------------------------- */
/* 状态：Loading / Empty / Error / Notice —— 异常分支一个都不落                  */
/* -------------------------------------------------------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('mp-skeleton', className)} />;
}

export function LoadingState({ label = '正在分析…', rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 size={15} className="animate-spin text-jade-500" />
        {label}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mp-card space-y-2.5 p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title = '还没有数据',
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mp-panel flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-900/[0.05] text-ink-400">
        <Inbox size={22} />
      </span>
      <div>
        <div className="text-sm font-semibold text-ink-700">{title}</div>
        {description && <div className="mp-meta mx-auto mt-1 max-w-md">{description}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ code, message, hint, onRetry, className }: { code?: string; message: string; hint?: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-coral-500/25 bg-coral-500/[0.06] px-5 py-6', className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-coral-500/15 text-coral-500">
          <AlertCircle size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-800">分析失败</span>
            {code && <Badge tone="coral">{code}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-600">{message}</p>
          {hint && <p className="mp-meta mt-1.5">{hint}</p>}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ink-800"
            >
              <RefreshCw size={13} />
              重新分析
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NoticeBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3.5 py-2 text-xs text-amber-700', className)}>{children}</div>
  );
}

/* -------------------------------------------------------------------------- */
/* 分组标题                                                                    */
/* -------------------------------------------------------------------------- */
export function SectionHeading({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink-800">{title}</h2>
        {hint && <p className="mp-meta mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 统计数字                                                                    */
/* -------------------------------------------------------------------------- */
export function Stat({ label, value, unit, hint, tone = 'jade', icon: Icon }: { label: string; value: ReactNode; unit?: string; hint?: string; tone?: 'jade' | 'amber' | 'coral' | 'ink'; icon?: LucideIcon }) {
  const tones = {
    jade: 'text-jade-600 bg-jade-500/10',
    amber: 'text-amber-600 bg-amber-500/12',
    coral: 'text-coral-500 bg-coral-500/10',
    ink: 'text-ink-600 bg-ink-900/[0.06]',
  };
  return (
    <div className="mp-card flex items-center gap-3 px-4 py-3.5">
      {Icon && (
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tones[tone])}>
          <Icon size={17} />
        </span>
      )}
      <div className="min-w-0">
        <div className="mp-meta truncate">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="text-xl font-semibold tabular-nums text-ink-800">{value}</span>
          {unit && <span className="text-xs text-ink-400">{unit}</span>}
        </div>
        {hint && <div className="mp-meta mt-0.5 truncate">{hint}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 进度（分析中）                                                              */
/* -------------------------------------------------------------------------- */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && <div className="mp-meta">{label}</div>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-900/[0.07]">
        <div className="h-full rounded-full bg-gradient-to-r from-jade-500 to-jade-400 transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 抽屉（梗详情 / 通知详情复用）                                                */
/* -------------------------------------------------------------------------- */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink-950/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        data-testid="drawer"
        className={cn('relative flex h-full w-full flex-col border-l border-ink-900/10 bg-white shadow-2xl animate-fade-up', width)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-900/[0.06] px-5 py-4">
          <div className="min-w-0">
            <div className="text-base font-semibold text-ink-800">{title}</div>
            {subtitle && <div className="mp-meta mt-1">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg px-2 py-1 text-sm text-ink-400 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-700"
          >
            关闭 ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-ink-900/[0.06] px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}
