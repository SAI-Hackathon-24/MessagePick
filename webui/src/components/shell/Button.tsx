import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** 统一按钮：外壳与三个模块共用，保证同一种操作在三处呈现一致（REQ-016） */
export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  spin,
  disabled,
  className,
  title,
  'data-testid': testId,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  spin?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  'data-testid'?: string;
}) {
  const variants = {
    primary: 'bg-jade-600 text-white hover:bg-jade-700',
    ghost: 'text-ink-600 hover:bg-ink-900/[0.05]',
    outline: 'border border-ink-900/[0.08] bg-white text-ink-600 hover:border-jade-500/40 hover:text-jade-700',
    danger: 'bg-coral-500 text-white hover:brightness-95',
  };
  const sizes = { sm: 'px-2.5 py-1 text-[11px]', md: 'px-3 py-1.5 text-xs' };
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn('inline-flex items-center gap-1.5 rounded-xl font-medium transition-colors disabled:opacity-60', variants[variant], sizes[size], className)}
    >
      {Icon && <Icon size={size === 'sm' ? 11 : 13} className={cn(spin && 'animate-spin')} />}
      {children}
    </button>
  );
}
