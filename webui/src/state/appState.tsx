/**
 * 全局状态（MOD-004 的浏览器侧）
 * =============================================================================
 * 依据：
 *   · REQ-004 / api-contract §1.3：全局筛选条是全应用唯一筛选控件
 *     （群多选 · 时间范围 · 关键词 · 身份），统一作用于三个模块的所有视图；
 *     各模块不得自建同类筛选控件（REQ-049）。
 *   · REQ-002：界面始终显示「记录更新至 X」。
 *   · REQ-003：未采集到任何数据时显示首屏引导。
 *   · REQ-006：身份取自 Me 标识，无需用户手工设置（界面不提供手工输入）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/api';
import type { GlobalFilter, Group, ModuleKey, UpdateStatus } from '@/types';

/** 身份视角：`global` = 不限（默认）；`me` = 只看与「我」相关的数据（REQ-006）。 */
export type IdentityMode = 'global' | 'me';

export interface AppState {
  /** 全局筛选条件：三个模块共用同一份 */
  filter: GlobalFilter;
  setFilter: (patch: Partial<GlobalFilter>) => void;
  /** 身份视角开关（REQ-006）：「我相关」/ 全局（不限） */
  identityMode: IdentityMode;
  setIdentityMode: (mode: IdentityMode) => void;
  /** 一键清除筛选（空态时使用 —— REQ-016） */
  clearFilter: () => void;
  /** 关键词匹配对象说明（随模块变化 —— REQ-005） */
  setModule: (m: ModuleKey) => void;
  /** 群列表（DM-002） */
  groups: Group[];
  /** 更新状态：是否有数据 + 记录更新至 X（API-002） */
  status: UpdateStatus | null;
  statusLoading: boolean;
  refreshStatus: () => void;
  /** 触发更新（API-001） */
  triggerUpdate: (target?: 'group_messages' | 'contacts') => Promise<void>;
  updating: boolean;
  /** 更新入口的最近一次结果提示 */
  updateNotice: string | null;
  dismissUpdateNotice: () => void;
  /**
   * 设置面板（含数据去向说明 —— REQ-012）。
   * 同一时刻只允许一个抽屉打开：打开设置会先关闭模块内的抽屉，
   * 避免两个 modal 叠加、导致焦点与可访问性错乱。
   */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** 记录当前打开的模块内抽屉（由 useExclusiveDrawer 使用） */
  activeDrawer: string | null;
  claimDrawer: (id: string) => void;
  releaseDrawer: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [module, setModuleKey] = useState<ModuleKey>('meme');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<{ start?: string; end?: string }>({});
  const [keyword, setKeyword] = useState('');
  const [identityMode, setIdentityMode] = useState<IdentityMode>('global');
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<string | null>(null);
  const [statusTick, setStatusTick] = useState(0);

  const claimDrawer = useCallback((id: string) => {
    setActiveDrawer(id);
    setSettingsOpen(false); // 打开模块内抽屉时关闭设置（互斥）
  }, []);
  const releaseDrawer = useCallback((id: string) => {
    setActiveDrawer((cur) => (cur === id ? null : cur));
  }, []);
  const openSettings = useCallback((open: boolean) => {
    setSettingsOpen(open);
    if (open) setActiveDrawer(null); // 打开设置时关闭模块内抽屉（互斥）
  }, []);

  /* 群列表 */
  useEffect(() => {
    void api.groups().then((res) => {
      if (res.ok && res.data) setGroups(res.data);
    });
  }, []);

  /* 更新状态（API-002）：首屏取一次，更新完成后重取 */
  useEffect(() => {
    setStatusLoading(true);
    void api.updateStatus().then((res) => {
      if (res.ok && res.data) setStatus(res.data);
      setStatusLoading(false);
    });
  }, [statusTick]);

  const filter: GlobalFilter = useMemo(
    () => ({
      groupIds,
      timeRange,
      keyword,
      /* 身份：值为 API-002 下发的 Me 标识（REQ-006；界面不提供手工输入）；视角可选「全局 / 我」。 */
      meId: identityMode === 'me' ? status?.meId ?? undefined : undefined,
      module,
    }),
    [groupIds, timeRange, keyword, module, identityMode, status?.meId],
  );

  const setFilter = useCallback((patch: Partial<GlobalFilter>) => {
    if (patch.groupIds) setGroupIds(patch.groupIds);
    if (patch.timeRange) setTimeRange(patch.timeRange);
    if (patch.keyword !== undefined) setKeyword(patch.keyword);
  }, []);

  const clearFilter = useCallback(() => {
    setGroupIds([]);
    setTimeRange({});
    setKeyword('');
    setIdentityMode('global');
  }, []);

  const setModule = useCallback((m: ModuleKey) => setModuleKey(m), []);
  const refreshStatus = useCallback(() => setStatusTick((t) => t + 1), []);

  const triggerUpdate = useCallback(
    async (target?: 'group_messages' | 'contacts') => {
      setUpdating(true);
      setUpdateNotice(null);
      const res = await api.triggerUpdate(target);
      setUpdating(false);
      if (!res.ok || !res.data) {
        setUpdateNotice(res.error ? `${res.error.message}${res.error.hint ? `（${res.error.hint}）` : ''}` : '更新失败');
        return;
      }
      // 分来源结果逐条提示；部分失败不阻塞其余来源（REQ-016）
      const parts = res.data.results.map((r) => {
        const label = r.source === 'group_messages' ? '群消息' : '通讯录与好友列表';
        if (r.status === 'success') return `${label}：成功${r.imported ? `（${r.imported} 条）` : ''}`;
        return `${label}：${r.failureReason ?? '失败'}`;
      });
      // 采集成功后外壳会按设置触发后台分析：如实提示下一步去向（REQ-016）
      const messagesOk = res.data.results.some((r) => r.source === 'group_messages' && r.status === 'success');
      const cfgRes = await api.settings();
      const cfg = cfgRes.ok ? cfgRes.data : null;
      const auto = cfg?.ingest.autoTriggerAfterIngest ?? true;
      const modelReady = cfg === null ? true : cfg.model.baseUrl.length > 0 && cfg.model.apiKeyConfigured;
      let suffix = '';
      if (messagesOk && auto) {
        suffix = modelReady
          ? '。已触发后台分析，稍后刷新即可看到梗 / 提取 / 兴趣结果'
          : '。已触发后台分析；但模型服务尚未配置（见「设置 → 模型服务」），分析任务会失败';
      } else if (messagesOk && !auto) {
        suffix = modelReady
          ? '。已按设置跳过自动分析（可在筛选条选群后点「分析」按需触发）'
          : '。已按设置跳过自动分析；提示：模型服务尚未配置（见「设置 → 模型服务」），分析任务需要它';
      }
      setUpdateNotice(`${parts.join('；')}${suffix}`);
      refreshStatus();
    },
    [refreshStatus],
  );

  const value: AppState = {
    filter,
    setFilter,
    identityMode,
    setIdentityMode,
    clearFilter,
    setModule,
    groups,
    status,
    statusLoading,
    refreshStatus,
    triggerUpdate,
    updating,
    updateNotice,
    dismissUpdateNotice: () => setUpdateNotice(null),
    settingsOpen,
    setSettingsOpen: openSettings,
    activeDrawer,
    claimDrawer,
    releaseDrawer,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState 必须在 AppStateProvider 内使用');
  return ctx;
}
