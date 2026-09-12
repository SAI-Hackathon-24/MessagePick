/**
 * 顶栏：应用标题、「记录更新至 X」常驻、来源状态、只读模式与存储不可用提示（`TASK-008`）。
 *
 * 口径：
 * - 「记录更新至 X」始终可见；无值显示「尚未更新」，不隐藏（`AC-002` / `AC-003`）。
 * - 存储不可用显示「本地存储不可用」而不是「无数据」（`AC-038`）。
 * - 只读模式（缺启动令牌）：可浏览，写入口置灰并提示重新打开页面（`mod-004` §6.2）。
 */

import type { UpdateStatus } from '@shared'

import type { OperationsConnection } from '../api/events'
import { updatedUntilText } from '../state/data-status-store'
import { TERMS } from '../terminology'

/** 顶栏入参。 */
export interface DataStatusHeaderProps {
  view: 'loading' | 'unavailable' | 'onboarding' | 'main' | 'settings'
  status: UpdateStatus | null
  readOnly: boolean
  storageUnavailable: boolean
  counts: { queued: number; running: number }
  connection: OperationsConnection
}

const CONNECTION_NOTES: Record<OperationsConnection, string | null> = {
  live: null,
  connecting: '正在连接进度通道…',
  polling: '进度通道已降级为轮询（每 5 秒）。',
  offline: '进度通道未连接；任务仍由本机服务执行。',
}

/** 顶栏。 */
export function DataStatusHeader({
  view,
  status,
  readOnly,
  storageUnavailable,
  counts,
  connection,
}: DataStatusHeaderProps) {
  const connectionNote = CONNECTION_NOTES[connection]
  const updatedUntil = updatedUntilText(status?.updatedUntilX ?? null)

  return (
    <header className="shell-header">
      <div className="shell-header__top">
        <h1 className="shell-header__title">{TERMS.appName}</h1>
        <p className="shell-header__updated" data-testid="updated-until">
          {TERMS.dataStatus.updatedUntilLabel} {updatedUntil}
        </p>
      </div>
      <div className="shell-header__badges">
        {readOnly ? (
          <span className="shell-badge shell-badge--warn">
            {TERMS.dataStatus.readOnly}：{TERMS.dataStatus.readOnlyHint}
          </span>
        ) : null}
        {storageUnavailable ? (
          <span className="shell-badge shell-badge--error">{TERMS.dataStatus.storageUnavailable}（不是「无数据」）</span>
        ) : null}
        {counts.queued > 0 || counts.running > 0 ? (
          <span className="shell-badge">
            排队 {counts.queued} · 进行中 {counts.running}
          </span>
        ) : null}
        {connectionNote && view !== 'onboarding' ? <span className="shell-badge">{connectionNote}</span> : null}
      </div>
      {status && status.sourceStatuses.length > 0 ? (
        <ul className="shell-header__sources">
          {status.sourceStatuses.map((entry) => (
            <li key={entry.source}>
              {entry.source}：{entry.status}
              {entry.at === null ? '' : `（${updatedUntilText(entry.at)}）`}
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  )
}
