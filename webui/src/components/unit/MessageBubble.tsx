/** 群消息气泡：文字 / 图片 / 表情包三类（DM-003），支持回跳原文 */
import { Image as ImageIcon, Smile } from 'lucide-react';
import { fmtMD } from '@/lib/format';
import { MESSAGE_KIND_LABEL, type RawMessage } from '@/types';
import { Avatar, Badge } from '@/components/ui';

export function MessageBubble({ message, showGroup = true }: { message: RawMessage; showGroup?: boolean }) {
  const Icon = message.kind === 'image' ? ImageIcon : message.kind === 'sticker' ? Smile : null;
  return (
    <div className="flex gap-3">
      <Avatar name={message.senderName} size={30} className="z-10 shrink-0" />
      <div className="min-w-0 flex-1 rounded-xl border border-ink-900/[0.06] bg-white/80 px-3 py-2">
        <div className="mp-meta flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink-600">{message.senderName}</span>
          <span className="tabular-nums">{fmtMD(message.sentAt)}</span>
          {showGroup && message.groupId && <span className="rounded bg-ink-900/[0.05] px-1.5 py-0.5">{message.groupId}</span>}
          <Badge tone={message.kind === 'text' ? 'neutral' : 'amber'}>
            {Icon && <Icon size={10} />}
            {MESSAGE_KIND_LABEL[message.kind]}
          </Badge>

        </div>
        {message.kind === 'text' ? (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-700">{message.text}</p>
        ) : message.mediaUrl ? (
          <div className="mt-2">
            <img src={message.mediaUrl} alt={MESSAGE_KIND_LABEL[message.kind]} className="h-28 w-28 rounded-lg border border-ink-900/[0.08] bg-ink-900/[0.03] object-cover" />
            <p className="mp-meta mt-1">媒体按需解密并缓存（决策 8）；首次预览可能触发一次解密。</p>
          </div>
        ) : (
          <p className="mp-meta mt-1">[{MESSAGE_KIND_LABEL[message.kind]}] 媒体尚未解密</p>
        )}
        {message.mentionedIds?.length ? <p className="mp-meta mt-1">提及 {message.mentionedIds.length} 人</p> : null}
      </div>
    </div>
  );
}
