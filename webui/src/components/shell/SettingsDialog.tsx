/**
 * 设置面板（外壳职责）
 * =============================================================================
 * · 数据去向说明（REQ-012 / AC-030）
 * · 按群删除 / 全量清空：预检 → 二次确认 → 级联删除（REQ-011 / AC-025 ~ AC-029）
 *   —— 缺少二次确认时后端拒绝执行（CONFIRMATION_REQUIRED / AC-027）
 */
import { useState } from 'react';
import { AlertTriangle, Info, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import type { DeletePrecheck, DeleteScope } from '@/types';
import { Button } from './Button';
import { AnalysisGroupPicker } from './AnalysisGroupPicker';
import { Badge, Card, CardHeader, Drawer, ErrorState, LoadingState, NoticeBar } from '@/components/ui';

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, groups, refreshStatus } = useAppState();
  const flow = useApi(() => api.dataFlowNotice(), []);
  const [scope, setScope] = useState<DeleteScope>({ kind: 'all' });
  const [precheck, setPrecheck] = useState<DeletePrecheck | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPrecheck = async (next: DeleteScope) => {
    setScope(next);
    setPrecheck(null);
    setConfirmed(false);
    setResult(null);
    setError(null);
    const res = await api.deletePrecheck(next);
    if (res.ok && res.data) setPrecheck(res.data);
    else setError(res.error?.message ?? '预检失败');
  };

  const execute = async () => {
    setBusy(true);
    setError(null);
    const res = await api.executeDelete(scope, confirmed);
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(`${res.error?.message ?? '删除未执行'}${res.error?.hint ? `（${res.error.hint}）` : ''} [${res.error?.code ?? 'UNKNOWN'}]`);
      return;
    }
    const total = res.data.items.reduce((s, i) => s + i.count, 0);
    setResult(`已删除 ${total} 条记录（含原始记录、派生结果与生成历史），不可恢复。`);
    setPrecheck(null);
    setConfirmed(false);
    refreshStatus();
  };

  if (!settingsOpen) return null;

  return (
    <Drawer
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      width="max-w-2xl"
      kind="settings"
      title="设置"
      subtitle="数据去向说明与隐私删除。本应用不提供任何对外分享 / 发送通道。"
    >
      <div className="space-y-5">
        {/*
          待分析群（产品口径：导入只入库、不默认分析）。
          放在最上面：它决定「更新之后会不会有结果」，是使用前最该先决定的一项。
        */}
        <AnalysisGroupPicker onSaved={() => refreshStatus()} />

        {/* 数据去向（REQ-012） */}
        <Card>
          <CardHeader title="数据去向" icon={ShieldCheck} subtitle="首次使用与设置页各展示一处（REQ-012 / AC-030）" />
          <ul className="space-y-2 px-4 py-4">
            {(flow.data?.statements ?? []).map((s) => (
              <li key={s} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-jade-500/60" />
                {s}
              </li>
            ))}
            <li className="mp-meta">模型服务地址：{flow.data?.modelEndpoint ?? '—'}（可在配置中修改）</li>
          </ul>
        </Card>

        {/* 删除（REQ-011） */}
        <Card>
          <CardHeader title="删除数据" icon={Trash2} subtitle="删除范围含原始记录及其全部派生结果；两种删除均不可恢复" />
          <div className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={scope.kind === 'all' ? 'primary' : 'outline'} onClick={() => void runPrecheck({ kind: 'all' })}>
                全量清空
              </Button>
              {groups.slice(0, 4).map((g) => (
                <Button key={g.id} variant={scope.kind === 'group' && scope.groupId === g.id ? 'primary' : 'outline'} onClick={() => void runPrecheck({ kind: 'group', groupId: g.id })}>
                  {g.name}
                </Button>
              ))}
            </div>

            {!precheck && !busy && (
              <NoticeBar tone="amber" className="flex items-start gap-2">
                <Info size={13} className="mt-0.5 shrink-0" />
                选择删除范围后会先做预检，列出将被删除的实体与条数，确认后才执行。
              </NoticeBar>
            )}

            {busy && <LoadingState label="正在执行删除…" rows={1} />}

            {precheck && (
              <div className="space-y-3">
                <div className="rounded-xl border border-coral-500/25 bg-coral-500/[0.05] px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle size={14} className="text-coral-500" />
                    <span className="text-sm font-semibold text-ink-800">将删除「{precheck.scopeLabel}」的 {precheck.total} 条记录</span>
                    <Badge tone="coral">不可恢复</Badge>
                  </div>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {precheck.items.map((i) => (
                      <li key={i.entity} className="flex items-center justify-between gap-2 text-[11.5px] text-ink-600">
                        <span>{i.label}</span>
                        <span className="tabular-nums text-ink-400">{i.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-ink-900/[0.08] px-3 py-2.5">
                  <input type="checkbox" data-testid="delete-confirm" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-jade-600" />
                  <span className="text-xs leading-relaxed text-ink-600">
                    我确认删除以上数据。删除后原始消息、梗与提取结果、兴趣与性格标签、以及生成历史都会被一并移除，且不可恢复。
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <Button variant="danger" data-testid="delete-execute" onClick={() => void execute()} disabled={!confirmed || busy}>
                    执行删除
                  </Button>
                  <Button variant="ghost" onClick={() => { setPrecheck(null); setConfirmed(false); }}>
                    取消
                  </Button>
                  {!confirmed && <span className="mp-meta">勾选确认后才能执行（后端会以 CONFIRMATION_REQUIRED 拒绝未确认的请求）</span>}
                </div>
              </div>
            )}

            {error && <ErrorState error={{ code: 'CONFIRMATION_REQUIRED', message: error }} className="!py-4" />}
            {result && <NoticeBar tone="jade">{result}</NoticeBar>}
          </div>
        </Card>

        <div className={cn('mp-meta leading-relaxed')}>
          术语口径（REQ-017）：梗的展示与操作单元统一称「梗单元」；模块一的词云称「梗词云」，模块三的称「个人标签词云」；
          模块一的「梗生命周期」与模块二的「消息时间轴」不共用名称。
        </div>
      </div>
    </Drawer>
  );
}
