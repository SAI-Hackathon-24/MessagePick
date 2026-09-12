/**
 * 梗速览条（梗词云视图的配套展示单元）
 * =============================================================================
 * 词云解决「哪个梗大」，卡片解决「这个梗是什么、火过多久、谁在带」。
 * 卡片内容直接取自与梗单元同源的数据（`MemeCloudEntry`），点卡片即打开完整梗单元：
 *   · 梗名 + 类型 + 热度状态（REQ-020、REQ-028）
 *   · 解读一句话（REQ-026）
 *   · 首现时间 / 最近调用（REQ-027）
 *   · 累计次数 + 周环比（REQ-028）
 *   · 月度分布迷你柱 + 生命周期强度条（REQ-029、REQ-030）
 *   · 梗王与主要使用者（REQ-031）
 *   · 精华消息预览（文字 / 梗图）（REQ-032）
 */
import { Flame, MessageSquareQuote, TrendingDown, TrendingUp, UserRound } from 'lucide-react';
import { HEAT_STATE_LABEL, MEME_TYPE_COLOR, MEME_TYPE_LABEL, type MemeCloudEntry } from '@/types';
import { cn } from '@/lib/cn';
import { fmtMD, num } from '@/lib/format';
import { Card } from '@/components/ui';

const HEAT_TONE = { active: 'text-jade-700 bg-jade-500/12', fading: 'text-amber-700 bg-amber-500/15', silent: 'text-ink-500 bg-ink-900/[0.06]' } as const;

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
                  {e.heatState && (
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', HEAT_TONE[e.heatState])}>{HEAT_STATE_LABEL[e.heatState]}</span>
                  )}
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

            {/* 解读（REQ-026） */}
            {e.interpretation && <p className="line-clamp-2 text-xs leading-relaxed text-ink-500">{e.interpretation}</p>}

            {/* 首现 / 最近调用（REQ-027）+ 周环比（REQ-028） */}
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
                <dt className="mp-meta">周环比</dt>
                <dd className={cn('inline-flex items-center gap-0.5 text-[11.5px] font-medium tabular-nums', (e.weekOverWeek ?? 0) >= 0 ? 'text-jade-700' : 'text-coral-500')}>
                  {(e.weekOverWeek ?? 0) >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {Math.round((e.weekOverWeek ?? 0) * 100)}%
                </dd>
              </div>
            </dl>

            {/* 月度分布迷你柱（REQ-029）：一眼看出起伏 */}
            {e.monthly && e.monthly.length > 0 && (
              <div>
                <div className="mp-meta mb-1 flex items-center justify-between">
                  <span>按月出现次数</span>
                  <span>共 {e.activeDays ?? 0} 天活跃</span>
                </div>
                <div className="flex h-10 items-end gap-[2px]">
                  {e.monthly.map((b) => {
                    const max = Math.max(...e.monthly!.map((x) => x.count), 1);
                    return (
                      <div
                        key={b.month}
                        title={`${b.month}：${b.count} 次${b.incomplete ? '（该月数据不完整）' : ''}`}
                        className="flex-1 rounded-t-[2px]"
                        style={{ height: `${Math.max(6, (b.count / max) * 100)}%`, background: b.incomplete ? '#a8b1c1' : '#45bd87' }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* 梗王与主要使用者（REQ-031） */}
            {e.king && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="mp-meta inline-flex items-center gap-1">
                  <UserRound size={11} /> 梗王
                </span>
                {e.king.members.slice(0, 2).map((k) => (
                  <span key={k.memberId} className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                    {k.name} {k.count} 次 · {Math.round(k.ratio * 100)}%
                  </span>
                ))}
                <span className="mp-meta">主推：{e.king.topUsers.slice(0, 3).map((u) => u.name).join('、') || '—'}</span>
              </div>
            )}

            {/* 精华消息预览（REQ-032）：文字与梗图都支持 */}
            {e.highlights && e.highlights.length > 0 && (
              <div className="border-t border-ink-900/[0.06] pt-2">
                <div className="mp-meta mb-1 inline-flex items-center gap-1">
                  <MessageSquareQuote size={11} /> 精华群消息
                </div>
                <ul className="space-y-1">
                  {e.highlights.slice(0, 2).map((h) => (
                    <li key={h.messageId} className="flex items-center gap-2">
                      {h.kind !== 'text' && h.mediaUrl && <img src={h.mediaUrl} alt="梗图" className="h-8 w-8 rounded-md border border-ink-900/[0.08] object-cover" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-ink-600">{h.kind === 'text' ? h.text : `[${h.kind === 'image' ? '图片' : '表情包'}]`}</span>
                        <span className="mp-meta">
                          {h.senderName} · {fmtMD(h.sentAt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-auto mp-meta text-jade-700">展开梗单元 →</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
