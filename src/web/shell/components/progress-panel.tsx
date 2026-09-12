/**
 * 进度面板（长任务进度；`mod-004` §4.5 / §4.8、CHG-026）。
 *
 * 只展示**外壳发起操作**的排队与在途数量、逐条状态与失败边界；模块内部队列深度不在此出现。
 * 失败操作给手动重试入口（同参数再次触发由使用方决定，组件只上报）。
 */

import type { OperationsConnection } from '../api/events'
import { OPERATION_KIND_LABELS, operationSummary, type ShellOperation } from '../state/operations'

/** 进度面板入参。 */
export interface ProgressPanelProps {
  operations: readonly ShellOperation[]
  connection: OperationsConnection
  onRetry(operation: ShellOperation): void
}

const CONNECTION_LABELS: Record<OperationsConnection, string> = {
  live: '实时更新',
  connecting: '正在连接',
  polling: '轮询中（每 5 秒）',
  offline: '未连接',
}

/** 进度面板。 */
export function ProgressPanel({ operations, connection, onRetry }: ProgressPanelProps) {
  const summary = operationSummary(operations)
  return (
    <section className="shell-progress">
      <h3 className="shell-progress__title">进行中的操作</h3>
      <p className="shell-progress__summary">
        排队 {summary.queued} · 进行中 {summary.running} · 失败 {summary.failed}（{CONNECTION_LABELS[connection]}）
      </p>
      {operations.length === 0 ? <p className="shell-progress__hint">当前没有由本应用发起的操作。</p> : null}
      <ul className="shell-progress__list">
        {operations.map((operation) => (
          <li key={operation.id} data-state={operation.state}>
            <span className="shell-progress__kind">{OPERATION_KIND_LABELS[operation.kind]}</span>
            <span className="shell-progress__scope">{operation.scope}</span>
            <span className="shell-progress__state">
              {operation.state === 'queued' ? '排队中' : null}
              {operation.state === 'running' ? '进行中' : null}
              {operation.state === 'succeeded' ? '已完成' : null}
              {operation.state === 'partial' ? '部分完成' : null}
              {operation.state === 'failed' ? '已失败' : null}
              {typeof operation.counts.total === 'number'
                ? `（${operation.counts.done}/${operation.counts.total}）`
                : operation.counts.done > 0
                  ? `（已完成 ${operation.counts.done}）`
                  : null}
            </span>
            {operation.state === 'failed' ? (
              <button type="button" className="shell-button shell-button--link" onClick={() => onRetry(operation)}>
                重试
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
