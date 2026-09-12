/**
 * 更新入口（`TASK-008`；`AC-005` ~ `AC-007`）。
 *
 * - 「更新数据」是全应用唯一的数据来源入口（`AC-009`）：不做演示数据 / 演示模式（`AC-010` / `REQ-019`）。
 * - 分来源展示结果；失败 / 无授权 / 超时给原因与分项重试入口，已成功来源照常可用（不阻塞）。
 * - 置灰依据：只读模式、删除进行中（门控，`mod-004` §4.4）、更新进行中。
 */

import type { Api001Response, IngestSource } from '@shared'

import type { FailureLike } from '../present/error-presentation'
import { ErrorNotice } from '../present/notice'
import { TERMS } from '../terminology'
import { failedSourceLines, summarizeIngest } from '../state/update-flow'

/** 更新入口入参。 */
export interface UpdateEntryProps {
  /** 置灰原因（`null` = 可用）。 */
  blockedReason: string | null
  /** 是否正在更新（来自进度事件）。 */
  running: boolean
  /** 本次更新结果（分项展示）。 */
  result: Api001Response | null
  /** 本次更新的失败对象（整单失败时）。 */
  failure: FailureLike | null
  onTrigger(source: IngestSource | null): void
}

/** 更新入口。 */
export function UpdateEntry({ blockedReason, running, result, failure, onTrigger }: UpdateEntryProps) {
  const summary = summarizeIngest(result)
  const failed = failedSourceLines(summary)

  return (
    <section className="shell-update">
      <div className="shell-update__actions">
        <button
          type="button"
          className="shell-button shell-button--primary"
          disabled={blockedReason !== null || running}
          onClick={() => onTrigger(null)}
        >
          {running ? '正在更新…' : TERMS.actions.updateData}
        </button>
        {blockedReason ? <p className="shell-update__blocked">{blockedReason}</p> : null}
      </div>

      {summary.sources.length > 0 ? (
        <ul className="shell-update__sources" data-testid="update-sources">
          {summary.sources.map((source) => (
            <li key={source.source} data-status={source.status}>
              <span className="shell-update__source-name">{source.source}</span>
              <span className="shell-update__source-status">{source.status}</span>
              {source.status === '成功' ? <span className="shell-update__count">写入 {source.written} 条</span> : null}
              {source.status === '成功' ? null : (
                <button
                  type="button"
                  className="shell-button shell-button--link"
                  disabled={blockedReason !== null || running}
                  onClick={() => onTrigger(source.source)}
                >
                  重试该来源
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {failed.length > 0 ? (
        <div className="shell-update__failures">
          {failed.map((line) => (
            <p key={`${line.source}-${line.status}`} className="shell-update__failure">
              {line.source}：{line.status}（{line.reason}）
            </p>
          ))}
        </div>
      ) : null}

      {failure ? <ErrorNotice failure={failure} onAction={() => onTrigger(null)} compact /> : null}
    </section>
  )
}
