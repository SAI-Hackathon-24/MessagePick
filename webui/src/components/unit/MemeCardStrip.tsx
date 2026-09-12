/**
 * 梗速览条（梗词云视图的配套展示单元）
 * =============================================================================
 * 词云解决「哪个梗大」，卡片解决「这个梗是什么、火过多久、谁在带」。
 * 卡片内容直接取自与梗单元同源的数据（`MemeCloudEntry`），点卡片即打开完整梗单元：
 *   · 梗名 + 类型 + 热度状态（REQ-020、REQ-028）
 *   · 解读一句话（REQ-026）
 *   · 首现时间 / 最近调用（REQ-027）
 *   · 累计次数 + 周环比（REQ-028）
 */
import { Flame } from 'lucide-react';
import { MEME_TYPE_COLOR, MEME_TYPE_LABEL, type MemeCloudEntry } from '@/types';
import { cn } from '@/lib/cn';
import { fmtMD, num } from '@/lib/format';
import { Card } from '@/components/ui';

export function MemeCardStrip({
  entries,
  onPick,
  limit = 6,
  className,
}: {
  entries: MemeCloudEntry[];
  onPick: (e: MemeCloudEntry) => void;
  limit?: number;
  className?: string;
}) {
  if (!entries.length) return null;
  const shown = entries.slice(0, limit);

  return (
    <div className={cn('space-y-3', className)} data-testid="meme-card-strip">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-ink-800">梗速览</h3>
          <p className="mp-meta mt-0.5">
            按当前排序取前 {shown.length} 个梗；内容与梗单元同源，点击任意一张展开完整梗单元
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((e) => (
          <Card key={e.memeId} hover onClick={() => onPick(e)} className="flex flex-col gap-2.5 p-4" data-testid="meme-card">
            {/* 头部：梗名 + 类型 + 热度状态 */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[16px] font-bold text-ink-800">{e.name}</span>
                  <span
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ color: MEME_TYPE_COLOR[e.type], background: `${MEME_TYPE_COLOR[e.type]}1a` }}
                  >
                    {MEME_TYPE_LABEL[e.type]}
                  </span>

                </div>
                {e.mine && <span className="mp-meta mt-0.5 inline-block">我用过</span>}
              </div>
              <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-1 text-[17px] font-bold tabular-nums text-jade-700">
                  <Flame size={13} className="text-amber-500" />
                  {num(e.occurrences)}
                </div>
                <div className="mp-meta">次</div>
              </div>
            </div>

            {/* 契约里词云条目只有基础字段；解读 / 热度 / 梗王等在梗单元内，点开即得 */}
            <dl className="grid grid-cols-3 gap-1.5 rounded-xl bg-ink-900/[0.03] px-2.5 py-2">
              <div>
                <dt className="mp-meta">首次出现</dt>
                <dd className="text-[11.5px] font-medium tabular-nums text-ink-700">{fmtMD(e.firstSeenAt)}</dd>
              </div>
              <div>
                <dt className="mp-meta">最近调用</dt>
                <dd className="text-[11.5px] font-medium tabular-nums text-ink-700">{fmtMD(e.lastUsedAt)}</dd>
              </div>
              <div>
                <dt className="mp-meta">频率值</dt>
                <dd className="text-[11.5px] font-medium tabular-nums text-ink-700">{e.frequency}</dd>
              </div>
            </dl>
            <p className="mp-meta leading-relaxed">解读、热度状态、梗王与精华消息在梗单元内查看。</p>

            <div className="mt-auto mp-meta text-jade-700">展开梗单元 →</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
