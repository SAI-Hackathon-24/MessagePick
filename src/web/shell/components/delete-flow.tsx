/**
 * 删除交互（`TASK-011`；`AC-025` ~ `AC-029`）。
 *
 * 顺序：选择范围（全量 / 按群）→ 预检（展示受影响实体与计数）→ 二次确认 → 执行。
 * 未确认时不发执行请求；中断只给「不可恢复 + 续做」；删除完成后由使用方刷新数据状态回落引导。
 */

import type { EntityCount, Group } from '@shared'

import { entityCountLines } from '../present/entity-labels'
import { ErrorNotice } from '../present/notice'
import type { DeleteFlowEvent, DeleteFlowState } from '../state/delete-flow'
import type { GroupsPhase } from './global-filter-bar'

/** 删除交互入参。 */
export interface DeleteFlowProps {
  state: DeleteFlowState
  groups: readonly Group[]
  groupsPhase: GroupsPhase
  /** 等待 / 进行提示（由数据更新进度推导，可为空）。 */
  note: string | null
  onEvent(event: DeleteFlowEvent): void
  onReloadGroups(): void
}

function ScopeCounts({ items }: { items: readonly EntityCount[] }) {
  const lines = entityCountLines(items)
  if (lines.length === 0) return <p className="shell-delete__hint">预检未返回受影响实体。</p>
  return (
    <ul className="shell-delete__counts">
      {lines.map((line) => (
        <li key={line.label}>
          {line.label}：{line.count}
        </li>
      ))}
    </ul>
  )
}

/** 删除面板。 */
export function DeleteFlow({ state, groups, groupsPhase, note, onEvent, onReloadGroups }: DeleteFlowProps) {
  if (state.step === 'closed') {
    return (
      <section className="shell-delete">
        <h3 className="shell-delete__title">删除数据</h3>
        <p className="shell-delete__hint">删除前会先展示受影响的实体与计数，确认后才会执行；已删除部分不可恢复。</p>
        <button type="button" className="shell-button" onClick={() => onEvent({ type: 'open' })}>
          发起删除
        </button>
      </section>
    )
  }

  return (
    <section className="shell-delete">
      <h3 className="shell-delete__title">删除数据</h3>

      {state.step === 'choose' ? (
        <div className="shell-delete__choose">
          <label className="shell-check">
            <input
              type="radio"
              name="shell-delete-scope"
              checked={state.scope?.kind === 'all'}
              onChange={() => onEvent({ type: 'pickScope', scope: { kind: 'all' } })}
            />
            <span>全量清空</span>
          </label>
          {groupsPhase === 'failed' ? (
            <p className="shell-delete__hint">
              群清单读取失败。
              <button type="button" className="shell-button shell-button--link" onClick={onReloadGroups}>
                重试
              </button>
            </p>
          ) : null}
          {groupsPhase === 'ready' && groups.length === 0 ? (
            <p className="shell-delete__hint">尚未采集到群，只能全量清空。</p>
          ) : null}
          {groups.length > 0 ? (
            <ul className="shell-delete__groups">
              {groups.map((group) => (
                <li key={group.groupId}>
                  <label className="shell-check">
                    <input
                      type="radio"
                      name="shell-delete-scope"
                      checked={state.scope?.kind === 'group' && state.scope.groupId === group.groupId}
                      onChange={() =>
                        onEvent({ type: 'pickScope', scope: { kind: 'group', groupId: group.groupId } })
                      }
                    />
                    <span>按群删除：{group.groupName}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="shell-delete__actions">
            <button
              type="button"
              className="shell-button shell-button--primary"
              disabled={state.scope === null}
              onClick={() => onEvent({ type: 'preflightStart' })}
            >
              执行预检
            </button>
            <button type="button" className="shell-button" onClick={() => onEvent({ type: 'close' })}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'preflight' ? (
        <div className="shell-delete__progress">
          <p>正在预检受影响范围…</p>
          {note ? <p className="shell-delete__hint">{note}</p> : null}
        </div>
      ) : null}

      {state.step === 'confirm' ? (
        <div className="shell-delete__confirm">
          <p className="shell-delete__lead">
            {state.scope.kind === 'all' ? '将删除全部数据。' : '将删除所选群的数据。'}
            受影响范围如下（含派生结果与生成历史）：
          </p>
          <ScopeCounts items={state.preflight.items} />
          <p className="shell-delete__hint">删除不可恢复；确认后立即开始执行。</p>
          <div className="shell-delete__actions">
            <button
              type="button"
              className="shell-button shell-button--danger"
              onClick={() => onEvent({ type: 'confirm' })}
            >
              确认删除
            </button>
            <button type="button" className="shell-button" onClick={() => onEvent({ type: 'cancel' })}>
              返回
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'execute' ? (
        <div className="shell-delete__progress">
          <p>{note ?? '正在删除…'}</p>
        </div>
      ) : null}

      {state.step === 'interrupted' ? (
        <div className="shell-delete__interrupted">
          {state.failure ? <ErrorNotice failure={{ envelope: state.failure, requestId: null }} compact /> : null}
          <p className="shell-delete__hint">已删除的部分不可恢复；可重新发起，继续删除剩余数据。</p>
          {state.result ? (
            <>
              <p className="shell-delete__lead">已删除：</p>
              <ScopeCounts items={state.result.items} />
            </>
          ) : null}
          <div className="shell-delete__actions">
            <button type="button" className="shell-button" onClick={() => onEvent({ type: 'resume' })}>
              继续删除剩余数据
            </button>
            <button type="button" className="shell-button" onClick={() => onEvent({ type: 'dismiss' })}>
              稍后处理
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'failed' ? (
        <div className="shell-delete__failed">
          <ErrorNotice failure={state.failure} onAction={() => onEvent({ type: 'retry' })} compact />
          <div className="shell-delete__actions">
            <button type="button" className="shell-button" onClick={() => onEvent({ type: 'cancel' })}>
              返回
            </button>
          </div>
        </div>
      ) : null}

      {state.step === 'done' ? (
        <div className="shell-delete__done">
          <p>删除完成。</p>
          {state.result ? <ScopeCounts items={state.result.items} /> : null}
          <div className="shell-delete__actions">
            <button type="button" className="shell-button" onClick={() => onEvent({ type: 'dismiss' })}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
