/**
 * 梗纠正菜单（模块一）
 * =============================================================================
 * 四类动作（`REQ-035`），可就地撤销：
 *   · 这不是梗        从梗库移除 → 词云与统计都不再包含
 *   · 不感兴趣        隐藏但保留数据 → 不参与呈现，仍可撤销
 *   · 合并到其他梗    出现记录并入目标梗（只允许同群，不做跨群自动合并 —— REQ-040）
 *   · 梗王标注有误    手动指定正确的梗王
 *
 * 机制与兴趣标签的增删改保持一致：**本地状态立即生效**，随后刷新词云与列表；
 * 本地记录同时充当**黑名单**，后端模型再次总结时不会把这些条目改回去。
 * 同一条梗可重新选择动作或撤销，撤销后恢复原始呈现。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, EyeOff, GitMerge, Crown, Undo2, XCircle } from 'lucide-react';
import { api } from '@/api';
import { forgetCorrection, rememberCorrection } from '@/api/map';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { CORRECTION_LABEL, type CorrectionMark } from '@/types';

const ACTIONS: { mark: Exclude<CorrectionMark, 'none'>; icon: typeof XCircle; hint: string }[] = [
  { mark: 'not_meme', icon: XCircle, hint: '从梗库移除，词云与统计都不再包含它' },
  { mark: 'not_interested', icon: EyeOff, hint: '隐藏该梗，但保留数据，可随时撤销' },
  { mark: 'merged', icon: GitMerge, hint: '把它的出现记录并入另一个梗（仅限同群）' },
  { mark: 'king_wrong', icon: Crown, hint: '手动指定正确的梗王' },
];

export function MemeCorrectMenu({
  memeId,
  memeName,
  groupId,
  current,
  onDone,
}: {
  memeId: string;
  memeName: string;
  /** 限定合并目标只在本群内（REQ-040） */
  groupId?: string;
  /** 当前改判状态，用于显示已生效的标记 */
  current?: CorrectionMark;
  /** 改判成功后回调：由调用方刷新词云 / 列表 */
  onDone?: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<'merged' | 'king_wrong' | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /** 合并目标候选（同群其他梗）与成员候选（用于指定梗王） */
  const cloud = useApi(() => api.memeCloud({ groupIds: groupId ? [groupId] : [], timeRange: {}, keyword: '', module: 'meme' }, 'heat', 'cumulative'), [groupId]);
  const members = useApi(() => api.relationGraph(), []);
  const candidates = (cloud.data?.entries ?? []).filter((e) => e.memeId !== memeId);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPicking(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const submit = async (mark: CorrectionMark, payload?: { mergeTargetId?: string; kingOverride?: { memberId: string; name: string } }) => {
    setBusy(true);
    /**
     * 后端 `POST /api/memes/:memeId/correction` 只接 `{ correction, mergeTargetId? }`
     * （`correction` 是中文闭集：不是梗 / 不感兴趣 / 合并到其他梗 / 梗王标注有误）。
     * 「梗王标注有误」的具体人选后端暂不收，先记在本地黑名单里，界面照常生效。
     */
    const res = await api.submitCorrection(memeId, mark, payload?.mergeTargetId);
    if (res.ok && mark !== 'none') {
      rememberCorrection({
        memeId,
        memeName,
        mark,
        ...(payload?.mergeTargetId === undefined ? {} : { mergeTargetId: payload.mergeTargetId }),
        ...(candidates.find((c) => c.memeId === payload?.mergeTargetId) === undefined
          ? {}
          : { mergeTargetName: candidates.find((c) => c.memeId === payload?.mergeTargetId)!.name }),
        ...(payload?.kingOverride === undefined ? {} : { kingOverrideName: payload.kingOverride.name }),
      });
    }
    if (res.ok && mark === 'none') forgetCorrection(memeId);
    setBusy(false);
    setOpen(false);
    setPicking(null);
    if (res.ok) onDone?.(`「${memeName}」已改判为「${CORRECTION_LABEL[mark]}」，词云与列表已同步刷新。`);
    else onDone?.(`改判失败：${res.error?.message ?? '未知错误'}（${res.error?.code ?? 'UNKNOWN'}）`);
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        data-testid={`correct-menu-${memeId}`}
        onClick={() => {
          setOpen((v) => !v);
          setPicking(null);
        }}
        title="纠正 AI 的判断（这不是梗 / 不感兴趣 / 合并到其他梗 / 梗王标注有误）"
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors',
          current && current !== 'none'
            ? 'border-coral-500/40 bg-coral-500/[0.08] text-coral-500'
            : 'border-ink-900/[0.1] text-ink-500 hover:border-jade-500/40 hover:text-jade-700',
        )}
      >
        {current && current !== 'none' ? CORRECTION_LABEL[current] : '纠正'}
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-[268px] animate-fade-up rounded-xl border border-ink-900/[0.08] bg-white p-1.5 shadow-card-hover">
          {!picking ? (
            <>
              {ACTIONS.map((a) => (
                <button
                  key={a.mark}
                  type="button"
                  data-testid={`correct-${a.mark}-${memeId}`}
                  disabled={busy}
                  onClick={() => {
                    if (a.mark === 'merged' || a.mark === 'king_wrong') setPicking(a.mark);
                    else void submit(a.mark);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-jade-500/[0.07] disabled:opacity-50"
                >
                  <a.icon size={14} className="mt-0.5 shrink-0 text-ink-400" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-ink-700">{CORRECTION_LABEL[a.mark]}</span>
                    <span className="mp-meta block leading-snug">{a.hint}</span>
                  </span>
                </button>
              ))}
              {current && current !== 'none' && (
                <button
                  type="button"
                  data-testid={`correct-revert-${memeId}`}
                  disabled={busy}
                  onClick={() => void submit('none')}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-lg border-t border-ink-900/[0.06] px-2.5 py-2 text-left text-xs text-jade-700 transition-colors hover:bg-jade-500/[0.07]"
                >
                  <Undo2 size={13} /> 撤销改判，恢复原始呈现
                </button>
              )}
            </>
          ) : picking === 'merged' ? (
            <div>
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="mp-meta">合并到（仅限同群）</span>
                <button type="button" onClick={() => setPicking(null)} className="mp-meta text-jade-700 hover:underline">
                  返回
                </button>
              </div>
              <ul className="max-h-[220px] overflow-y-auto">
                {candidates.slice(0, 30).map((c) => (
                  <li key={c.memeId}>
                    <button
                      type="button"
                      data-testid={`merge-target-${c.memeId}`}
                      disabled={busy}
                      onClick={() => void submit('merged', { mergeTargetId: c.memeId })}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-jade-500/[0.07]"
                    >
                      <span className="truncate text-ink-700">{c.name}</span>
                      <span className="mp-meta shrink-0">{c.occurrences} 次</span>
                    </button>
                  </li>
                ))}
                {!candidates.length && <li className="mp-meta px-2.5 py-2">同群内没有其他可合并的梗</li>}
              </ul>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="mp-meta">指定正确的梗王</span>
                <button type="button" onClick={() => setPicking(null)} className="mp-meta text-jade-700 hover:underline">
                  返回
                </button>
              </div>
              <ul className="max-h-[220px] overflow-y-auto">
                {(members.data?.nodes ?? [])
                  .filter((n) => !n.unknown)
                  .slice(0, 40)
                  .map((m) => (
                    <li key={m.personId}>
                      <button
                        type="button"
                        data-testid={`king-target-${m.personId}`}
                        disabled={busy}
                        onClick={() => void submit('king_wrong', { kingOverride: { memberId: m.personId, name: m.name } })}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-jade-500/[0.07]"
                      >
                        <Check size={12} className="shrink-0 text-ink-300" />
                        <span className="truncate text-ink-700">{m.name}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {busy && <div className="mp-meta px-2.5 py-1.5">正在保存改判…</div>}
        </div>
      )}
    </div>
  );
}
