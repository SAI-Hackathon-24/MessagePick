/**
 * 消息上下文（REQ-007「回跳原文」的落点）
 * =============================================================================
 * 从梗单元（首现 / 最近调用 / 精华消息 / 来源消息）或消息详情点「回原文」时打开：
 * 目标消息 + 同群前后各 8 条，目标消息高亮；按时间正序。
 * 数据面：非契约 `/api/messages/:messageId`（外壳组装，只读 DM-003 / DM-002 / DM-004）。
 */
import { useEffect } from 'react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { Drawer, ErrorState, LoadingState } from '@/components/ui';
import { MessageBubble } from './MessageBubble';

export function MessageContextDrawer({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const { claimDrawer, releaseDrawer } = useAppState();
  const ctx = useApi(() => (id ? api.messageContext(id) : Promise.resolve({ ok: true, data: null } as never)), [id]);
  const d = ctx.data;

  useEffect(() => {
    if (!open || !id) return;
    const key = `message-context:${id}`;
    claimDrawer(key);
    return () => releaseDrawer(key);
  }, [open, id, claimDrawer, releaseDrawer]);

  if (!open) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      kind="message-context"
      title="原始消息上下文"
      subtitle={
        d && (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="mp-chip !py-0.5 !text-[11px]">{d.groupName}</span>
            <span className="tabular-nums">共 {d.messages.length} 条（高亮条为目标消息）</span>
          </span>
        )
      }
      footer={<span className="mp-meta">按时间正序；同群前后各 8 条，目标消息已高亮。</span>}
    >
      {ctx.loading && !d ? (
        <LoadingState label="正在读取消息上下文…" rows={3} />
      ) : ctx.error ? (
        <ErrorState error={ctx.error} onRetry={ctx.refetch} onBack={onClose} />
      ) : d ? (
        <ol className="space-y-3">
          {d.messages.map((m) => (
            <li key={m.id}>
              <MessageBubble message={m} showGroup={false} highlight={m.id === d.targetId} />
            </li>
          ))}
        </ol>
      ) : null}
    </Drawer>
  );
}
