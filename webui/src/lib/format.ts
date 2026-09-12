import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export const d = dayjs;

/** 'MM-DD HH:mm' */
export const fmtMD = (input: string | number) => dayjs(input).format('MM-DD HH:mm');
/** 'YYYY-MM-DD' */
export const fmtYMD = (input: string | number) => dayjs(input).format('YYYY-MM-DD');
/** 'MM月DD日 dddd' */
export const fmtDayLabel = (input: string | number) => dayjs(input).format('MM月DD日 dddd');
/** 'HH:mm' */
export const fmtHM = (input: string | number) => dayjs(input).format('HH:mm');

/** 相对时间：'3 天前' */
export const fromNow = (input: string | number) => dayjs(input).fromNow();

/** 距今剩余时间：'还剩 2 天' / '已过期 3 小时' */
export function deadlineHint(deadline?: string | null): { text: string; overdue: boolean; urgent: boolean } | null {
  if (!deadline) return null;
  const target = dayjs(deadline);
  if (!target.isValid()) return null;
  const now = dayjs();
  const overdue = target.isBefore(now);
  const hours = Math.abs(target.diff(now, 'hour'));
  const days = Math.abs(target.diff(now, 'day'));
  const text = overdue
    ? `已过期 ${hours < 24 ? `${hours} 小时` : `${days} 天`}`
    : hours < 1
      ? '即将到期'
      : `还剩 ${hours < 48 ? `${hours} 小时` : `${days} 天`}`;
  return { text, overdue, urgent: !overdue && hours <= 48 };
}

/** 把 0~1 映射到色阶（用于时间轴热力） */
export function heatColor(intensity: number, alpha = 1): string {
  const t = Math.max(0, Math.min(1, intensity));
  // 浅玉 → 微信绿 → 琥珀
  const stops = [
    { p: 0, c: [214, 245, 227] },
    { p: 0.45, c: [69, 189, 135] },
    { p: 0.75, c: [5, 154, 77] },
    { p: 1, c: [245, 158, 11] },
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.p && t <= b.p) {
      const k = (t - a.p) / (b.p - a.p || 1);
      const rgb = a.c.map((v, idx) => Math.round(v + (b.c[idx] - v) * k));
      return `rgba(${rgb.join(',')}, ${alpha})`;
    }
  }
  const last = stops[stops.length - 1].c;
  return `rgba(${last.join(',')}, ${alpha})`;
}

/** 生成一个稳定的数字哈希（用于头像配色） */
export function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const AVATAR_COLORS = [
  'bg-jade-500/15 text-jade-700 ring-jade-500/25',
  'bg-amber-500/15 text-amber-600 ring-amber-500/25',
  'bg-coral-500/15 text-coral-500 ring-coral-500/25',
  'bg-sky-500/15 text-sky-600 ring-sky-500/25',
  'bg-violet-500/15 text-violet-600 ring-violet-500/25',
  'bg-ink-500/15 text-ink-600 ring-ink-500/25',
];

export const avatarColor = (key: string) => AVATAR_COLORS[hashCode(key) % AVATAR_COLORS.length];

/** 数字千分位 */
export const num = (n: number) => n.toLocaleString('zh-CN');

/** 紧凑数字：1.2k / 48.6w */
export function compactNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
