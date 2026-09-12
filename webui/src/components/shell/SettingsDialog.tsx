/**
 * 设置面板（外壳职责）
 * =============================================================================
 * · 数据去向说明（REQ-012 / AC-030）
 * · 按群删除 / 全量清空：预检 → 二次确认 → 级联删除（REQ-011 / AC-025 ~ AC-029）
 *   —— 缺少二次确认时后端拒绝执行（CONFIRMATION_REQUIRED / AC-027）
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Cpu, Info, ShieldCheck, Trash2 } from 'lucide-react';
import { api, type SettingsPatch } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import type { DeletePrecheck, DeleteScope } from '@/types';
import { Button } from './Button';
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

  // 模型服务设置（分析任务依赖；REQ-016：失败可见、不静默）
  const settings = useApi(() => api.settings(), [settingsOpen]);
  const [modelBaseUrl, setModelBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelApiKey, setModelApiKey] = useState('');
  const [taskConcurrency, setTaskConcurrency] = useState(4);
  const [autoTrigger, setAutoTrigger] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const view = settings.data;
    if (view === null) return;
    setModelBaseUrl(view.model.baseUrl);
    setModelName(view.model.name);
    setTaskConcurrency(view.model.taskConcurrency);
    setAutoTrigger(view.ingest.autoTriggerAfterIngest);
  }, [settings.data]);

  const saveModel = async () => {
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    const patch: SettingsPatch = {
      model: {
        baseUrl: modelBaseUrl.trim(),
        name: modelName.trim(),
        ...(modelApiKey.trim().length > 0 ? { apiKey: modelApiKey.trim() } : {}),
        taskConcurrency,
      },
      ingest: { autoTriggerAfterIngest: autoTrigger },
    };
    const res = await api.saveSettings(patch);
    setSaving(false);
    if (!res.ok || !res.data) {
      setSaveError(`${res.error?.message ?? '保存失败'}${res.error?.hint ? `（${res.error.hint}）` : ''}`);
      return;
    }
    setModelApiKey('');
    setSaveMsg(`已保存。模型服务：${res.data.model.baseUrl.length > 0 ? res.data.model.baseUrl : '未配置'}｜模型名：${res.data.model.name.length > 0 ? res.data.model.name : '未配置'}；密钥：${res.data.model.apiKeyConfigured ? '已配置' : '未配置'}。`);
    settings.refetch();
  };

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
            <li className="mp-meta">模型服务：{flow.data?.modelEndpoint ?? '—'}（在「设置 → 模型服务」中修改）</li>
          </ul>
        </Card>

        {/* 模型服务（分析任务依赖） */}
        <Card>
          <CardHeader title="模型服务" icon={Cpu} subtitle="梗分析 / 信息提取 / 社交画像走模型任务；地址 / 模型名 / 密钥三项缺一不可（未配置时采集仍可用，但自动分析会失败）" />
          <div className="space-y-3 px-4 py-4">
            <label className="block space-y-1">
              <span className="mp-meta">服务地址（OpenAI 兼容）</span>
              <input
                data-testid="settings-model-base-url"
                value={modelBaseUrl}
                onChange={(e) => setModelBaseUrl(e.target.value)}
                placeholder="例如 https://api.example.com/v1"
                className="w-full rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-1.5 text-xs text-ink-700 outline-none placeholder:text-ink-300 focus:border-jade-500/50"
              />
            </label>
            <label className="block space-y-1">
              <span className="mp-meta">模型名（请求体 `model` 字段，如 gpt-4o-mini / qwen2.5:7b）</span>
              <input
                data-testid="settings-model-name"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="例如 gpt-4o-mini"
                className="w-full rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-1.5 text-xs text-ink-700 outline-none placeholder:text-ink-300 focus:border-jade-500/50"
              />
            </label>
            <label className="block space-y-1">
              <span className="mp-meta">API 密钥（{settings.data?.model.apiKeyConfigured ? '已配置，留空保持不变' : '未配置'}；只写不读回）</span>
              <input
                data-testid="settings-model-api-key"
                type="password"
                value={modelApiKey}
                onChange={(e) => setModelApiKey(e.target.value)}
                placeholder={settings.data?.model.apiKeyConfigured ? '••••••••' : 'sk-…'}
                className="w-full rounded-xl border border-ink-900/[0.08] bg-white/80 px-3 py-1.5 text-xs text-ink-700 outline-none placeholder:text-ink-300 focus:border-jade-500/50"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-ink-600">
                <span className="mp-meta">分析任务并发</span>
                <select
                  value={taskConcurrency}
                  onChange={(e) => setTaskConcurrency(Number(e.target.value))}
                  className="rounded-lg border border-ink-900/[0.1] bg-white px-2 py-1 text-xs outline-none focus:border-jade-500/50"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
                <input
                  type="checkbox"
                  data-testid="settings-auto-trigger"
                  checked={autoTrigger}
                  onChange={(e) => setAutoTrigger(e.target.checked)}
                  className="accent-jade-600"
                />
                采集完成后自动触发分析（梗分析 / 信息提取）
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="settings-model-save" onClick={() => void saveModel()} disabled={saving}>
                {saving ? '保存中…' : '保存模型设置'}
              </Button>
              {saveMsg && <span className="mp-meta text-jade-700">{saveMsg}</span>}
              {saveError && <span className="mp-meta text-coral-500">{saveError}</span>}
            </div>
            {settings.error && <NoticeBar tone="amber">读取设置失败：{settings.error.message}</NoticeBar>}
          </div>
        </Card>

        {/* 删除（REQ-011） */}
        <Card>
          <CardHeader title="删除数据" icon={Trash2} subtitle="删除范围含原始记录及其全部派生结果；两种删除均不可恢复" />
          <div className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={scope.kind === 'all' ? 'primary' : 'outline'} onClick={() => void runPrecheck({ kind: 'all' })}>
                全量清空
              </Button>
              <span className="mp-meta">或按群删除（共 {groups.length} 个群，点选后先预检）</span>
            </div>

            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-ink-900/[0.06] bg-white/60 p-1.5">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  data-testid={`delete-group-${g.id}`}
                  onClick={() => void runPrecheck({ kind: 'group', groupId: g.id })}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-coral-500/[0.06]',
                    scope.kind === 'group' && scope.groupId === g.id && 'bg-coral-500/[0.08] ring-1 ring-coral-500/30',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-ink-700">{g.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-300">预检</span>
                </button>
              ))}
              {!groups.length && <div className="mp-meta px-2 py-2">尚未采集到群：请先完成一次「更新数据」。</div>}
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
