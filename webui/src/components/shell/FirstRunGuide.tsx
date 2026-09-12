/**
 * 首屏引导（REQ-003 / AC-001、AC-029）
 * =============================================================================
 * 未采集到任何数据时显示：说明 + 「更新数据」入口 + 数据去向说明（REQ-012）。
 */
import { Cpu, Database, RefreshCw, ShieldCheck, UploadCloud } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { Button } from './Button';
import { Card, CardHeader, NoticeBar } from '@/components/ui';

export function FirstRunGuide() {
  const { triggerUpdate, updating, updateNotice, refreshStatus, setSettingsOpen } = useAppState();
  const flow = useApi(() => api.dataFlowNotice(), []);
  const status = useApi(() => api.updateStatus(), []);
  const settings = useApi(() => api.settings(), []);
  const cfgModel = settings.data?.model;
  const modelReady =
    cfgModel !== undefined && cfgModel.baseUrl.length > 0 && cfgModel.name.length > 0 && cfgModel.apiKeyConfigured;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-4 px-4 py-10">
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-jade-500 to-jade-700 text-white shadow-glow">
          <Database size={26} />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-ink-800">还没有采集到任何数据</h1>
        <p className="mp-meta mx-auto mt-2 max-w-xl leading-relaxed">
          聊斋基于你本机的微信记录工作。点下面的「更新数据」会调用本机的 <span className="font-mono">wechat-cli</span> 采集群消息与群成员身份，
          全过程只读、不出本机。采集完成后，三个模块（群聊梗分析 / 群聊信息提取 / 正向·反向社交）会基于这批记录给出结果。
        </p>
      </div>

      {updateNotice && <NoticeBar tone="sky">{updateNotice}</NoticeBar>}

      <Card>
        <CardHeader title="开始使用" icon={UploadCloud} subtitle="首次采集可能较慢（分页拉取历史消息），完成后可随时增量更新" />
        <div className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="first-run-update" onClick={() => void triggerUpdate()} disabled={updating} icon={updating ? RefreshCw : UploadCloud} spin={updating}>
              {updating ? '正在采集…' : '更新数据'}
            </Button>
            <Button variant="ghost" onClick={refreshStatus} icon={RefreshCw}>
              重新检查状态
            </Button>
          </div>
          <div className="space-y-1.5">
            {status.data?.sources.map((s) => (
              <div key={s.source} className="flex items-center gap-2 text-xs">
                <span className={s.status === 'success' ? 'text-jade-600' : 'text-coral-500'}>●</span>
                <span className="text-ink-600">{s.source === 'group_messages' ? '群消息' : '通讯录与好友列表'}</span>
                <span className="mp-meta">{s.status === 'success' ? '正常' : (s.failureReason ?? '未采集')}</span>
              </div>
            ))}
          </div>
          <p className="mp-meta leading-relaxed">
            若提示未初始化：请先在终端执行一次 <span className="font-mono text-ink-600">wechat-cli init</span>（需管理员 / root 权限，且微信桌面客户端保持运行），
            完成后回到本页重新检查。
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="配置模型服务" icon={Cpu} subtitle="梗分析 / 信息提取 / 社交画像的 AI 任务依赖模型服务；采集与浏览本身不需要" />
        <div className="space-y-2.5 px-4 py-4">
          {cfgModel === undefined ? (
            <p className="mp-meta">正在读取设置…</p>
          ) : modelReady ? (
            <p className="text-xs leading-relaxed text-ink-600">
              已配置：{cfgModel.baseUrl}（{cfgModel.name}；密钥已保存）——分析任务可以正常运行。
            </p>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-ink-600">
                尚未配置模型服务（<strong>服务地址 / 模型名 / API 密钥三项缺一不可</strong>）。未配置时「更新数据」仍可正常采集，
                但三个模块不会产出任何分析结果（分析任务会失败）。
              </p>
              <Button data-testid="first-run-model-config" onClick={() => setSettingsOpen(true)} icon={Cpu}>
                去配置模型服务
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="数据去向" icon={ShieldCheck} subtitle="首次使用与设置页各展示一处（REQ-012 / AC-030）" />
        <ul className="space-y-2 px-4 py-4">
          {(flow.data?.statements ?? []).map((s) => (
            <li key={s} className="flex gap-2 text-xs leading-relaxed text-ink-600">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-jade-500/60" />
              {s}
            </li>
          ))}
          <li className="mp-meta">模型服务地址：{flow.data?.modelEndpoint ?? '—'}</li>
        </ul>
      </Card>
    </div>
  );
}
