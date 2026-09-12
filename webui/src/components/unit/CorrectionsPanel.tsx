/**
 * 已改判记录（本地黑名单）面板
 * =============================================================================
 * 纠正结果写在本地状态里，优先于后端模型的周期结论 —— 后端再次返回结果时，
 * 这些条目仍按本地口径处理（不会被「纠正回去」）。本面板用于查看与撤销。
 *
 * 同时展示「与后端建议冲突」的条目，让人一眼看到分歧在哪、以谁为准。
 */
import { AlertTriangle, Undo2 } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { fmtMD } from '@/lib/format';
import { CORRECTION_LABEL } from '@/types';
import { Badge, Card, CardHeader, NoticeBar } from '@/components/ui';
import { Button } from '@/components/shell/Button';

export function CorrectionsPanel({ version = 0, onChanged }: { version?: number; onChanged?: () => void }) {
  /**
   * version 由调用方在每次改判后自增，用于触发重新取数。
   * 这类数据在 mock 里是就地修改的，`refetch()` 不会让外部组件重渲染，
   * 所以必须由「发生改判」这件事驱动依赖变化。
   */
  const corrections = useApi(() => api.listCorrections(), [version]);
  const conflicts = useApi(() => api.correctionConflicts(), [version]);

  const items = corrections.data ?? [];
  const conflictItems = conflicts.data ?? [];

  const revert = async (memeId: string) => {
    const res = await api.revertCorrection(memeId);
    if (res.ok) {
      corrections.refetch();
      conflicts.refetch();
      onChanged?.();
    }
  };

  if (!items.length && !conflictItems.length) return null;

  return (
    <Card data-testid="corrections-panel">
      <CardHeader
        title="已改判记录（本地黑名单）"
        icon={Undo2}
        subtitle="这些改判优先于模型结论：后端再次总结时不会把它们改回去，可随时撤销"
        right={<Badge tone="coral">{items.length} 条</Badge>}
      />
      <div className="space-y-3 px-4 py-3.5">
        {conflictItems.length > 0 && (
          <NoticeBar tone="amber" className="flex items-start gap-2" data-testid="correction-conflicts">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              有 {conflictItems.length} 条与后端建议不一致，**以你的改判为准**：
              {conflictItems.map((c) => (
                <span key={c.memeId} className="ml-1">
                  「{c.memeName}」后端建议「{CORRECTION_LABEL[c.backendMark]}」，你改判为
                  「{CORRECTION_LABEL[items.find((i) => i.memeId === c.memeId)?.mark ?? 'none']}」
                </span>
              ))}
            </span>
          </NoticeBar>
        )}

        {items.length > 0 && (
          <ul className="space-y-1.5">
            {items.map((c) => (
              <li key={c.memeId} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                <span className="text-xs font-medium text-ink-700">{c.memeName}</span>
                <Badge tone="coral">{CORRECTION_LABEL[c.mark]}</Badge>
                {c.mark === 'merged' && c.mergeTargetName && <span className="mp-meta">→ 已并入「{c.mergeTargetName}」</span>}
                {c.mark === 'king_wrong' && c.kingOverride && <span className="mp-meta">→ 指定梗王：{c.kingOverride.name}</span>}
                <span className="mp-meta tabular-nums">{fmtMD(c.correctedAt)}</span>
                <Button size="sm" variant="outline" icon={Undo2} className="ml-auto" onClick={() => void revert(c.memeId)}>
                  撤销
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
