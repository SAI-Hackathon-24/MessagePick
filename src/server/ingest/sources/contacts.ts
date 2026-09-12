/**
 * 通讯录与好友列表来源适配器（mod-001 §3.1「sources/contacts.ts」、`REQ-001`、`REQ-082`）。
 *
 * 两个子项（都写入 `DM-005`，来源字段区分）：
 * - `通讯录` ← CLI `contacts`（`--query` 不给 = 全量；`remark` 大多为空，显示名按 `remark → nick_name → username`）；
 * - `好友列表` ← CLI `sessions` 里的**私聊会话**（AGENTS.md 的 12 条命令里没有独立的「好友列表」命令，
 *   私聊会话是唯一可得的、有名称的好友集合；该口径已在实现报告中点出）。
 *
 * 本来源**永不推进「记录更新至 X」**（`AC-004`）：X 只由群消息来源的完整成功推进（§5.2、决策 5）。
 */

import type { EntityRecord, EntityType } from '@shared'
import type { Store } from '@server/store'

import { runCliCommand, type RetryPolicy, type RetryBreaker } from '../cli/retry'
import type { CliRunner } from '../cli/runner'
import type { ContactItem, ParseRunner, SessionItem } from '../cli/parse'
import type { IngestLogger } from '../errors'
import { failure, type IngestFailure } from '../errors'
import { contactRecordsFromContacts, contactRecordsFromSessions } from '../mapping/records'
import { pickSourceFailure, statusOfCode } from './source'
import type { CollectContext, CollectOutcome, SourceAdapter, SourceCheckpoint, SourceStatus } from './source'

/** 单批写入上限（`detailed-design.md` §3.2）。 */
export const WRITE_BATCH_ROWS = 1_000

export interface ContactsOptions {
  store: Store
  runner: CliRunner
  parse: ParseRunner
  policy: RetryPolicy
  breaker: RetryBreaker
  sleep: (ms: number) => Promise<void>
  clock: () => number
  timeoutMs: number
  /** 通讯录 / 会话列表的条数上限 */
  listLimit: number
  logger?: IngestLogger
}

export function createContactsAdapter(options: ContactsOptions): SourceAdapter {
  const { store, clock, logger } = options

  return {
    source: '通讯录与好友列表',
    async collect(ctx: CollectContext): Promise<CollectOutcome> {
      const startedAt = clock()
      const subFailures: IngestFailure[] = []
      const done = new Set<string>(ctx.checkpoint?.doneGroups ?? [])
      let written = 0

      const command = async <T>(
        kind: 'sessions' | 'contacts',
        args: string[],
        scope: string,
        breakerKey: string,
      ): Promise<ReturnType<typeof runCliCommand<T>>> => {
        return await runCliCommand<T>(
          {
            runner: options.runner,
            parse: options.parse,
            policy: options.policy,
            breaker: options.breaker,
            sleep: options.sleep,
            clock,
            onRetry: (info) =>
              logger?.warn?.('ingest.source.failed', { module: 'MOD-001', source: '通讯录与好友列表', ...info }),
          },
          { kind, args, scope, timeoutMs: options.timeoutMs, breakerKey },
        )
      }

      const writeAll = (records: readonly EntityRecord<'DM-005'>[], scope: string): void => {
        for (let start = 0; start < records.length; start += WRITE_BATCH_ROWS) {
          const batch = records.slice(start, start + WRITE_BATCH_ROWS)
          const result = store.write('DM-005', batch)
          written += result.written
          for (const detail of result.failures) {
            subFailures.push(failure('STORAGE_UNAVAILABLE', `写入失败（DM-005：${detail.reason}）`, scope, false))
          }
        }
      }

      // 1) 通讯录。
      if (!done.has('contacts')) {
        const contacts = await command<ContactItem[]>('contacts', ['contacts', '--limit', String(options.listLimit)], '通讯录与好友列表:contacts', 'contacts')
        if (!contacts.ok) {
          subFailures.push(contacts.failure)
        } else {
          const mapped = contactRecordsFromContacts(contacts.value, '通讯录')
          writeAll(mapped.records, '通讯录与好友列表:contacts')
          ctx.onProgress({
            source: '通讯录与好友列表',
            phase: 'write',
            scope: 'contacts',
            processed: mapped.records.length,
            written,
          })
          done.add('contacts')
        }
      }

      // 2) 好友列表（私聊会话）。
      if (!done.has('friends')) {
        const sessions = await command<SessionItem[]>('sessions', ['sessions', '--limit', String(options.listLimit)], '通讯录与好友列表:sessions', 'friends-sessions')
        if (!sessions.ok) {
          subFailures.push(sessions.failure)
        } else {
          const records = contactRecordsFromSessions(sessions.value, '好友列表')
          writeAll(records, '通讯录与好友列表:sessions')
          ctx.onProgress({
            source: '通讯录与好友列表',
            phase: 'write',
            scope: 'friends',
            processed: records.length,
            written,
          })
          done.add('friends')
        }
      }

      const failureTop = pickSourceFailure(subFailures)
      const status: SourceStatus = subFailures.length === 0 ? 'succeeded' : statusOfCode(failureTop?.code ?? 'SOURCE_UNAVAILABLE')
      const completedAt = status === 'succeeded' ? clock() : undefined
      logger?.info?.(status === 'succeeded' ? 'ingest.source.done' : 'ingest.source.failed', {
        module: 'MOD-001',
        source: '通讯录与好友列表',
        written,
        failures: subFailures.length,
        durationMs: clock() - startedAt,
        ...(failureTop === undefined ? {} : { code: failureTop.code }),
      })

      const checkpoint: SourceCheckpoint = {
        source: '通讯录与好友列表',
        ...(ctx.window === undefined ? {} : { window: ctx.window }),
        doneGroups: [...done].sort(),
        offsets: {},
      }
      return {
        source: '通讯录与好友列表',
        status,
        written,
        ...(failureTop === undefined ? {} : { failure: failureTop }),
        subFailures,
        ...(completedAt === undefined ? {} : { completedAt }),
        checkpoint,
      }
    },
  }
}

/** 类型别名：`DM-005` 记录（供来源层签名可读）。 */
export type ContactRow = EntityRecord<'DM-005'>
/** 类型占位：保持与 `EntityType` 的显式依赖（写入类型由 `store.write` 泛型推导）。 */
export type { EntityType }
