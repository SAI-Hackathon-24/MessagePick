/**
 * 群消息来源适配器（mod-001 §3.1「sources/group-messages.ts」）。
 *
 * 串行流程（决策 3）：`sessions` 取群 → 逐群（串行）：`members` → `history`（分页 + 时间窗）。
 * 写入顺序受立即外键约束：`DM-002`（群）→ `DM-004`（成员，含 Me / 占位）→ `DM-003`（消息）。
 *
 * - 首次全量：不带时间窗，按 `ingest.pageSize` 逐页拉（深 `--offset` 慢，但首次全量只能翻页）；
 *   之后增量：窗口 = 上次成功时间 − 重叠量（决策 4），窗口内的数据量小，重叠量吸收时钟偏移与迟到消息。
 * - 部分失败不阻塞：单群 / 单分页 / 单写入批失败进 `subFailures`，其余群继续（详设 §2.5）。
 * - 来源状态 = `succeeded` ⇔ **全部子分项成功**（§5.2）：任一子分项失败则不推进「记录更新至 X」。
 */

import type { EntityRecord, EntityType } from '@shared'
import type { Store } from '@server/store'

import type { CommandOutcome } from '../cli/retry'
import { RetryBreaker, runCliCommand, type RetryPolicy } from '../cli/retry'
import type { CliRunner } from '../cli/runner'
import { formatCliTime, type HistoryPayload, type MembersPayload, type ParseRunner, type SessionItem } from '../cli/parse'
import type { IngestLogger } from '../errors'
import { failure, type IngestFailure } from '../errors'
import { groupRecordFromMembers, memberRecordsFromMembers, messageRecordsFromHistory, type MemberIndex } from '../mapping/records'
import { readMeMarked } from '../state/source-state'
import { pickSourceFailure, statusOfCode } from './source'
import type { CollectContext, CollectOutcome, SourceAdapter, SourceCheckpoint, SourceProgress, SourceStatus } from './source'

/** 页级防御上限：单个群一次运行最多拉取的页数（防止游标异常导致死循环）。 */
export const MAX_PAGES_PER_GROUP = 2_000

export interface GroupMessagesOptions {
  store: Store
  runner: CliRunner
  parse: ParseRunner
  policy: RetryPolicy
  breaker: RetryBreaker
  /** 退避等待（测试注入空实现） */
  sleep: (ms: number) => Promise<void>
  clock: () => number
  /** 单条 CLI 命令超时（`timeouts.cliCommandMs`） */
  timeoutMs: number
  /** 采集分页大小（`ingest.pageSize`） */
  pageSize: number
  /** 会话列表条数上限（群清单来源；本机群数量级 5–20） */
  sessionLimit: number
  logger?: IngestLogger
}

interface GroupResult {
  written: number
  nextOffset?: number
  failure?: IngestFailure
}

export function createGroupMessagesAdapter(options: GroupMessagesOptions): SourceAdapter {
  const { store, clock, logger } = options

  return {
    source: '群消息',
    async collect(ctx: CollectContext): Promise<CollectOutcome> {
      const startedAt = clock()
      const subFailures: IngestFailure[] = []
      const doneGroups = new Set<string>(ctx.checkpoint?.doneGroups ?? [])
      const offsets: Record<string, number> = { ...(ctx.checkpoint?.offsets ?? {}) }
      let written = 0
      let commandCount = 0
      let skippedLines = 0
      let mediaUnavailable = 0
      let meMarked = readMeMarked(store)
      const markMe = (): boolean => {
        if (meMarked) return false
        meMarked = true
        return true
      }

      const report = (progress: Omit<SourceProgress, 'source' | 'written'>): void => {
        ctx.onProgress({ source: '群消息', written, ...progress })
      }

      const command = async <T>(
        kind: 'sessions' | 'history' | 'members',
        args: string[],
        scope: string,
        exit1MeansNoAuth: boolean,
      ): Promise<CommandOutcome<T>> => {
        commandCount += 1
        return await runCliCommand<T>(
          {
            runner: options.runner,
            parse: options.parse,
            policy: options.policy,
            breaker: options.breaker,
            sleep: options.sleep,
            clock,
            onRetry: (info) => logger?.warn?.('ingest.source.failed', { module: 'MOD-001', source: '群消息', ...info }),
          },
          { kind, args, scope, timeoutMs: options.timeoutMs, breakerKey: `${kind}:${scope}`, exit1MeansNoAuth },
        )
      }

      const write = <T extends EntityType>(type: T, records: readonly EntityRecord<T>[], scope: string): void => {
        if (records.length === 0) return
        const result = store.write(type, records)
        written += result.written
        for (const detail of result.failures) {
          subFailures.push(
            failure(
              'STORAGE_UNAVAILABLE',
              `写入失败（${type}：${detail.reason}）`,
              scope,
              false,
            ),
          )
        }
      }

      // 1) 群清单：`sessions` 返回裸数组（含私聊条目，按 `is_group` 过滤）。
      const sessions = await command<SessionItem[]>('sessions', ['sessions', '--limit', String(options.sessionLimit)], '群消息:sessions', true)
      if (!sessions.ok) {
        logger?.error?.('ingest.source.failed', {
          module: 'MOD-001',
          source: '群消息',
          code: sessions.failure.code,
          attempts: sessions.attempts,
        })
        return finish(sessions.status, [sessions.failure], undefined, sessions.failure)
      }
      const groups = sessions.value.filter((session) => session.isGroup)
      report({ phase: 'list', processed: 0, total: groups.length })

      // 2) 逐群串行采集。
      for (const [index, session] of groups.entries()) {
        const groupId = session.username
        if (doneGroups.has(groupId)) continue
        report({ phase: 'group', scope: groupId, processed: index, total: groups.length })
        /**
         * ⚠️ 完成判定必须把**写失败**也算进去。
         * `write()` 把落库失败推进 `subFailures`，但 `collectGroup` 本身仍会正常返回；
         * 若只看 `result.failure`，写失败的群会被记成「已完成」并**删掉断点**，
         * 用户按来源重试时 `if (doneGroups.has(groupId)) continue` 直接跳过该群，
         * 来源却报成功、`updatedUntilX` 照常推进 —— 数据永久缺失且重试无法补救。
         */
        const failuresBefore = subFailures.length
        const result = await collectGroup(session)
        const writeFailed = subFailures.length > failuresBefore
        if (result.failure === undefined && !writeFailed) {
          doneGroups.add(groupId)
          delete offsets[groupId]
        } else {
          if (result.failure !== undefined) subFailures.push(result.failure)
          // 保留断点：下次重试从该群的断点续采，而不是整群跳过
          offsets[groupId] = result.nextOffset ?? 0
        }
      }

      const failureTop = pickSourceFailure(subFailures)
      const status: SourceStatus =
        subFailures.length === 0 ? 'succeeded' : failureTop === undefined ? 'failed' : statusOfCode(failureTop.code)
      const completedAt = status === 'succeeded' ? clock() : undefined
      logger?.info?.(status === 'succeeded' ? 'ingest.source.done' : 'ingest.source.failed', {
        module: 'MOD-001',
        source: '群消息',
        groups: groups.length,
        written,
        failures: subFailures.length,
        commands: commandCount,
        skippedLines,
        mediaUnavailable,
        durationMs: clock() - startedAt,
        ...(failureTop === undefined ? {} : { code: failureTop.code }),
      })
      report({ phase: 'group', processed: groups.length, total: groups.length })
      return {
        source: '群消息',
        status,
        written,
        ...(failureTop === undefined ? {} : { failure: failureTop }),
        subFailures,
        ...(completedAt === undefined ? {} : { completedAt }),
        checkpoint: checkpointOf(doneGroups, offsets, ctx.window),
      }

      async function collectGroup(session: SessionItem): Promise<GroupResult> {
        const groupId = session.username
        const scope = `群消息:${groupId}`
        const membersCommand = await command<MembersPayload>('members', ['members', groupId], scope, false)
        if (!membersCommand.ok) return { written: 0, nextOffset: 0, failure: membersCommand.failure }

        const members = memberRecordsFromMembers(membersCommand.value)
        for (const item of members.failures) subFailures.push(item)
        write('DM-002', [groupRecordFromMembers(membersCommand.value, session.chat)], scope)
        write('DM-004', members.records, scope)

        const index: MemberIndex = members.index
        let offset = ctx.checkpoint?.offsets?.[groupId] ?? 0
        let pages = 0
        for (;;) {
          const args = ['history', groupId, '--limit', String(options.pageSize), '--offset', String(offset)]
          if (ctx.window !== undefined) {
            args.push('--start-time', formatCliTime(ctx.window.from), '--end-time', formatCliTime(ctx.window.to))
          }
          const page = await command<HistoryPayload>('history', args, scope, false)
          if (!page.ok) return { written: 0, nextOffset: offset, failure: page.failure }

          const mapped = messageRecordsFromHistory(page.value, { index, markMe })
          skippedLines += mapped.skippedLines
          mediaUnavailable += mapped.mediaUnavailable
          // 立即外键：占位成员（含 Me）必须先落库，再写消息。
          write('DM-004', mapped.placeholderMembers, scope)
          write('DM-003', mapped.records, scope)
          if (page.value.failures.length > 0) {
            subFailures.push(
              failure(
                'SOURCE_UNAVAILABLE',
                `CLI 逐条失败 ${page.value.failures.length} 条（内容不进日志）`,
                scope,
                true,
              ),
            )
          }
          report({ phase: 'page', scope: groupId, processed: offset + page.value.messages.length })

          const received = page.value.messages.length
          if (received === 0 || received < options.pageSize) break
          offset += received
          pages += 1
          if (pages >= MAX_PAGES_PER_GROUP) {
            logger?.warn?.('ingest.source.failed', { module: 'MOD-001', source: '群消息', scope, reason: 'paging-cap' })
            break
          }
        }
        return { written: 0 }
      }

      /** 结局装配（失败返回用）。 */
      function finish(
        status: SourceStatus,
        subFailures: IngestFailure[],
        checkpoint: SourceCheckpoint | undefined,
        top?: IngestFailure,
      ): CollectOutcome {
        return {
          source: '群消息',
          status,
          written,
          ...(top === undefined ? {} : { failure: top }),
          subFailures,
          ...(checkpoint === undefined ? {} : { checkpoint }),
        }
      }
    },
  }
}

/** 断点装配（窗口随断点一起带走，指定来源重试时复用，保证分页游标仍然成立）。 */function checkpointOf(
  doneGroups: Set<string>,
  offsets: Record<string, number>,
  window: { from: number; to: number } | undefined,
): SourceCheckpoint {
  return {
    source: '群消息',
    ...(window === undefined ? {} : { window }),
    doneGroups: [...doneGroups].sort(),
    offsets: { ...offsets },
  }
}

/** 分项失败优先级与来源状态映射由 `./source` 的 `pickSourceFailure` / `statusOfCode` 提供。 */