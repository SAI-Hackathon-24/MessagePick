/**
 * 已改判记录（本地黑名单）面板
 * =============================================================================
 * 纠正结果写在本地状态里，优先于后端模型的周期结论 —— 后端再次返回结果时，
 * 这些条目仍按本地口径处理（不会被「纠正回去」）。本面板用于查看与撤销。
 *
 * 同时展示「与后端建议冲突」的条目，让人一眼看到分歧在哪、以谁为准。
 */
import { Undo2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { api } from '@/api';
import { listCorrections, type LocalCorrectionRecord } from '@/api/map';
import { fmtMD } from '@/lib/format';
import { CORRECTION_LABEL } from '@/types';
import { Badge, Card, CardHeader } from '@/components/ui';
import { Button } from '@/components/shell/Button';

export function CorrectionsPanel({ version = 0, onChanged }: { version?: number; onChanged?: () => void }) {
  /**
   * 后端只提供「提交改判」（`API-012`）与随梗单元返回的改判标记，
   * **没有**「列出我的全部改判」查询接口。因此本面板读本地记录
   * （`map.ts` 的 `listCorrections`，持久化在 localStorage，即黑名单）。
   * version 由调用方在每次改判后自增，用于触发重新读取。
   */
  const [rows, setRows] = useState<LocalCorrectionRecord[]>(() => listCorrections());
  const [lastVersion, setLastVersion] = useState(version);

  // 依赖变化时同步（改判后调用方自增 version）
  if (lastVersion !== version) {
    setLastVersion(version);
    setRows(listCorrections());
  }

  const revert = useCallback(
    async (memeId: string) => {
      // 撤销 = 提交「无」改判；后端接受后本地记录随之清除
      const res = await api.submitCorrection(memeId, 'none');
      if (res.ok) {
        setRows(listCorrections());
        onChanged?.();
      }
    },
    [onChanged],
  );

  if (rows.length === 0) return null;

  return (
    <Card data-testid="corrections-panel">
      <CardHeader
        title="已改判记录（本地黑名单）"
        icon={Undo2}
        subtitle="改判优先于模型结论：后端下次总结时不会把它们改回去；记录保存在本机，刷新页面后仍生效"
        right={<Badge tone="coral">{rows.length} 条</Badge>}
      />
      <div className="space-y-3 px-4 py-3.5">
        <ul className="space-y-1.5">
          {rows.map((c) => (
            <li key={c.memeId} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
              <span className="text-xs font-medium text-ink-700">{c.memeName}</span>
              <Badge tone="coral">{CORRECTION_LABEL[c.mark]}</Badge>
              {c.mark === 'merged' && c.mergeTargetName !== undefined && <span className="mp-meta">→ 已并入「{c.mergeTargetName}」</span>}
              {c.mark === 'king_wrong' && c.kingOverrideName !== undefined && <span className="mp-meta">→ 指定梗王：{c.kingOverrideName}</span>}
              <span className="mp-meta tabular-nums">{fmtMD(c.correctedAt)}</span>
              <Button size="sm" variant="outline" icon={Undo2} className="ml-auto" onClick={() => void revert(c.memeId)}>
                撤销
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
