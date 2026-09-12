/**
 * 基础展示单元
 * 口径：REQ-016 要求四类异常（失败 / 超时 / 无结果 / 无授权）在三个模块与外壳
 * 呈现一致，因此异常与空态组件集中在这里，由外壳与各模块复用。
 */
import { AlertCircle, Inbox, Loader2, RefreshCw, ShieldAlert, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { avatarColor } from '@/lib/format';
import { ERROR_PRESENTATION, type ApiError, type ErrorCode } from '@/types';

export function Card({
  children,
  className,
  hover,
  onClick,
  'data-testid': testId,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  'data-testid'?: string;
}) {
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn('mp-card', hover && 'mp-card-hover cursor-pointer', className)}
    >
      {children}
    </div>
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

export function Chip({
  children,
  active,
  onClick,
  className,
  count,
  title,
  'data-testid': testId,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  count?: number;
  title?: string;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testId}
      onClick={onClick}
      className={cn('mp-chip', active && 'mp-chip-active', onClick && 'hover:border-jade-500/30', className)}
    >
      {children}
      {count !== undefined && <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-jade-500/20' : 'bg-ink-900/[0.06]')}>{count}</span>}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'jade' | 'amber' | 'coral' | 'sky' | 'violet'; className?: string }) {
  const tones = {
    neutral: 'bg-ink-900/[0.06] text-ink-600',
    jade: 'bg-jade-500/12 text-jade-700',
    amber: 'bg-amber-500/15 text-amber-700',
    coral: 'bg-coral-500/12 text-coral-500',
    sky: 'bg-sky-500/12 text-sky-700',
    violet: 'bg-violet-500/12 text-violet-700',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>;
}

export function Avatar({ name, src, size = 32, className }: { name: string; src?: string; size?: number; className?: string }) {
  return src ? (
    <img src={src} alt={name} width={size} height={size} className={cn('shrink-0 rounded-xl object-cover', className)} />
  ) : (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-xl font-semibold ring-1', avatarColor(name), className)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      title={name}
    >
      {name.slice(0, name.length > 2 ? 1 : 2)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('mp-skeleton', className)} />;
}

export function LoadingState({ label = '正在读取…', rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 size={15} className="animate-spin text-jade-500" />
        {label}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mp-card space-y-2.5 p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

/** 空态：REQ-016 —— 无结果时给「一键清除筛选」 */
export function EmptyState({
  title = '没有符合条件的结果',
  description,
  action,
  onAction,
  actionLabel = '清除筛选',
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  onAction?: () => void;
  actionLabel?: string;
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
      {action ?? (onAction && (
        <button type="button" onClick={onAction} className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800">
          {actionLabel}
        </button>
      ))}
    </div>
  );
}

/**
 * 失败态：按 api-contract §1.2 的错误标识决定呈现方式（REQ-016 统一口径）。
 * · retry        → 提示 + 重试
 * · clear-filter → 空态 + 一键清除筛选
 * · guide-update → 引导完成首次更新
 * · back         → 返回上一视图
 * · confirm      → 去完成确认
 */
export function ErrorState({
  error,
  onRetry,
  onClearFilter,
  onGuideUpdate,
  onBack,
  className,
}: {
  error: ApiError;
  onRetry?: () => void;
  onClearFilter?: () => void;
  onGuideUpdate?: () => void;
  onBack?: () => void;
  className?: string;
}) {
  const preset = ERROR_PRESENTATION[error.code as ErrorCode] ?? ERROR_PRESENTATION.ANALYSIS_FAILED;
  const isAuth = error.code === 'NO_AUTH';
  const Icon = isAuth ? ShieldAlert : AlertCircle;
  const tone = isAuth ? 'text-amber-600 bg-amber-500/12 border-amber-500/25' : 'text-coral-500 bg-coral-500/10 border-coral-500/25';

  const handlers: Record<string, (() => void) | undefined> = {
    retry: onRetry,
    'clear-filter': onClearFilter,
    'guide-update': onGuideUpdate,
    back: onBack,
    confirm: onRetry,
    inline: undefined,
  };
  const onClick = handlers[preset.kind];

  return (
    <div className={cn('rounded-2xl border px-5 py-6', tone, className)}>
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', isAuth ? 'bg-amber-500/15' : 'bg-coral-500/15')}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-800">{preset.title}</span>
            <Badge tone={isAuth ? 'amber' : 'coral'}>{error.code}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-600">{error.message}</p>
          {error.hint && <p className="mp-meta mt-1.5">{error.hint}</p>}
          {preset.action && onClick && (
            <button
              type="button"
              onClick={onClick}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ink-800"
            >
              <RefreshCw size={13} />
              {preset.action}
            </button>
          )}
          {isAuth && (
            <p className="mp-meta mt-2 leading-relaxed">
              若提示未初始化，请在终端先执行一次：<span className="font-mono text-ink-600">wechat-cli init</span>（需管理员 / root 权限），完成后回到本页重试。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function NoticeBar({ children, tone = 'amber', className }: { children: ReactNode; tone?: 'amber' | 'jade' | 'sky' | 'coral'; className?: string }) {
  const tones = {
    amber: 'border-amber-500/25 bg-amber-500/[0.08] text-amber-800',
    jade: 'border-jade-500/25 bg-jade-500/[0.07] text-jade-800',
    sky: 'border-sky-500/25 bg-sky-500/[0.07] text-sky-800',
    coral: 'border-coral-500/25 bg-coral-500/[0.07] text-coral-500',
  };
  return <div className={cn('rounded-xl border px-3.5 py-2 text-xs leading-relaxed', tones[tone], className)}>{children}</div>;
}

export function SectionHeading({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink-800">{title}</h2>
        {hint && <p className="mp-meta mt-0.5">{hint}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Stat({ label, value, unit, hint, tone = 'jade', icon: Icon }: { label: string; value: ReactNode; unit?: string; hint?: string; tone?: 'jade' | 'amber' | 'coral' | 'ink'; icon?: LucideIcon }) {
  const tones = {
    jade: 'text-jade-600 bg-jade-500/10',
    amber: 'text-amber-700 bg-amber-500/12',
    coral: 'text-coral-500 bg-coral-500/10',
    ink: 'text-ink-600 bg-ink-900/[0.06]',
  };
  return (
    <div className="mp-card flex items-center gap-3 px-4 py-3.5">
      {Icon && (
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tones[tone])}>
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

export function MiniStat({ label, value, tone = 'ink' }: { label: string; value: ReactNode; tone?: 'ink' | 'jade' | 'amber' | 'coral' }) {
  const tones = { ink: 'text-ink-700', jade: 'text-jade-600', amber: 'text-amber-700', coral: 'text-coral-500' };
  return (
    <div className="rounded-xl border border-ink-900/[0.06] bg-white/60 px-3 py-2">
      <div className="mp-meta">{label}</div>
      <div className={cn('mt-0.5 text-sm font-semibold tabular-nums', tones[tone])}>{value}</div>
    </div>
  );
}

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

/** 抽屉：梗单元 / 消息详情 / 成员画像复用 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
  kind = 'generic',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** 抽屉类型标识：同一页面可能存在多个抽屉，供精确断言与排障 */
  kind?: string;
}) {
  /* 打开时锁定背景滚动（避免抽屉与页面同时滚动） */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink-950/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        data-testid="drawer"
        data-drawer-kind={kind}
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

/** 术语提示：REQ-017 要求不混用两个「词云」与两个时间轴视图 */
export function TermHint({ children }: { children: ReactNode }) {
  return <span className="mp-meta" title={typeof children === 'string' ? children : undefined}>{children}</span>;
}

/**
 * 「正在构建」提示（社交画像首次构建期间）
 * =============================================================================
 * MOD-007 的索引快照在构建**阶段 8** 才物化，而构建是逐人模型调用
 * （真实数据实测：4035 人中 997 人需抽取，约 20 分钟）。构建完成前，
 * `API-020` ~ `API-029` 一律返回 `IDENTITY_NOT_READY` —— 这是**契约规定的
 * 正常中间态，不是失败**。
 *
 * 若把它当普通错误呈现，使用者看到的是「身份未就绪 / 没有任何结果」，
 * 完全不知道后台其实正在跑。因此这里把它单独做成等待态：
 * 说明正在发生什么、大约多久、以及为什么慢。
 */
export function BuildingState({
  what = '社交画像',
  minutes,
  onRetry,
  className,
}: {
  what?: string;
  /** 预计耗时（分钟）；由调用方按规模给出，给不出就不写 */
  minutes?: number;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-sky-500/25 bg-sky-500/[0.05] px-4 py-5', className)} aria-busy="true" data-testid="social-building">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 animate-pulse items-center justify-center rounded-lg bg-sky-500/15 text-sky-600">
          <Loader2 size={15} className="animate-spin" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-800">{what}正在构建，请稍候</div>
          <p className="mp-meta mt-1 leading-relaxed">
            首次构建要为每位成员单独调用一次模型（按本机数据规模，约
            {minutes === undefined ? '数分钟到二十分钟' : ` ${minutes} 分钟`}）。
            完成前相关接口会返回「身份未就绪」—— 这是**正常的中间态，不是出错**。
          </p>
          <p className="mp-meta mt-1 leading-relaxed">
            构建在后台进行，可以先去别的页面看；稍后回到本页会自动显示结果。
            {onRetry !== undefined && (
              <>
                {' '}
                <button type="button" onClick={onRetry} className="font-medium text-jade-700 hover:underline">
                  立即重新检查
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
