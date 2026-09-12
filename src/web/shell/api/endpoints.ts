/**
 * 外壳消费的 HTTP 端点（mod-004 §4.1 路由表；路由名只在外壳内稳定，不进契约层）。
 *
 * 浏览器只经外壳访问服务端：读走 `GET`（无令牌），写走 `POST` / `PUT`（带启动令牌头）。
 */

/** 端点常量与路径构造函数。 */
export const ENDPOINTS = {
  /** `API-002` 查询更新状态 */
  updateStatus: '/api/update-status',
  /** `API-001` 触发更新（写） */
  update: '/api/update',
  /** `API-004`（实体类型 = 群）群清单读路径（全局筛选的群多选、按群删除的群选择项） */
  filterGroups: '/api/filter-options/groups',
  /** `API-005` 删除预检（写） */
  deletionPreflight: '/api/deletions/preflight',
  /** `API-006` 执行删除（写） */
  deletions: '/api/deletions',
  /** `API-019` + `API-029` 组装的消息详情 */
  messageDetail: (entryId: string) => `/api/message-detail/${encodeURIComponent(entryId)}`,
  /** 素材确认（转进程内 `submitMaterialConsent`，写） */
  materialConsents: '/api/generations/material-consents',
  /** 产物读取（产物随所属数据删除后返回不存在） */
  artifact: (ref: string) => `/api/artifacts/${encodeURIComponent(ref)}`,
  /** 媒体通道（按需解密；失败按「来源不可用」呈现） */
  media: (ref: string) => `/media/${encodeURIComponent(ref)}`,
  /** 进度事件流（长任务进度） */
  events: '/api/events',
  /** 进度快照（轮询降级与重连首取） */
  operations: '/api/operations',
  /** 应用配置读写（写需令牌） */
  settings: '/api/settings',
} as const
