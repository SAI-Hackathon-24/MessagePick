/**
 * MOD-001 测试支撑（mod-001 §7「单测边界」）：
 *
 * - **不真调 wechat-cli**：`FakeCliRunner` 按命令匹配返回脚本化结果，并记录每次调用的参数与超时；
 * - **不真开库**：`FakeStore` 是 `API-003` / `API-004` 的进程内替身，身份去重、立即外键与
 *   「`is_me` 全库至多一条」的唯一索引口径与 `MOD-002` 对齐（`data-model.md` / 真实 schema）；
 * - 解析走真实代码（`createInlineParseRunner` = 小输出的常态路径），只有 `cli/runner.ts` 被替换；
 * - 时钟与退避等待注入：测试不真等、结果可复现。
 */

import type {
  CollectSourceStatus,
  ContactRecord,
  EntityRecord,
  EntityType,
  ErrorCode,
  FilterCondition,
  Group,
  GroupMember,
  Id,
  IngestSource,
  PageRequest,
  RawMessage,
  ReadResult,
  WriteResult,
} from '@shared'

import type { DeleteGate, Store } from '@server/store'
import { storageUnavailable } from '@server/store/errors'

import { createContactsAdapter } from '../sources/contacts'
import { createGroupMessagesAdapter } from '../sources/group-messages'
import type { CollectContext, CollectOutcome, SourceAdapter, SourceCheckpoint } from '../sources/source'
import { createIngestExecutor, type IngestExecutor, type RunReport } from '../run/executor'
import type { IngestProgressChannel, IngestProgressEvent } from '../run/progress'
import { createIngestProgress } from '../run/progress'
import { createRetryPolicy, RetryBreaker } from '../cli/retry'
import { createInlineParseRunner } from '../cli/parse'
import type { CliResult, CliRunner, CliProbeResult } from '../cli/runner'
import type { IngestLogger } from '../errors'
import { createIngestModule, type IngestConfigPatch, type IngestModule } from '../index'

// ---------------------------------------------------------------------------
// 常量与时钟
// ---------------------------------------------------------------------------

/** 固定基准时刻（2026-09-12T10:00:00Z）。 */
export const NOW: number = Date.UTC(2026, 8, 12, 10, 0, 0)

/** 可推进的手动时钟（不读真实时间）。 */
export class ManualClock {
  #now: number

  constructor(now: number = NOW) {
    this.#now = now
  }

  now = (): number => this.#now

  advance(ms: number): void {
    this.#now += ms
  }
}

/** 记录退避等待的 sleep 替身（不真等）。 */
export function sleepRecorder(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = []
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
  }
}

/** 收集日志事件的替身。 */
export function logRecorder(): { events: Array<{ event: string; fields?: Record<string, unknown> }>; logger: IngestLogger } {
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = []
  return {
    events,
    logger: {
      debug: (event, fields) => events.push({ event, ...(fields === undefined ? {} : { fields }) }),
      info: (event, fields) => events.push({ event, ...(fields === undefined ? {} : { fields }) }),
      warn: (event, fields) => events.push({ event, ...(fields === undefined ? {} : { fields }) }),
      error: (event, fields) => events.push({ event, ...(fields === undefined ? {} : { fields }) }),
    },
  }
}

// ---------------------------------------------------------------------------
// 存储替身（API-003 / API-004）
// ---------------------------------------------------------------------------

/** DM-004 的唯一索引冲突（「全库至多一条 is_me」）。 */
export const ME_UNIQUE_REASON = 'UNIQUE constraint failed: dm004_member.is_me'
/** 立即外键失败（DM-003 → DM-004 / DM-002）。 */
export const FK_REASON = 'FOREIGN KEY constraint failed'

function identityKey(...parts: readonly string[]): string {
  return parts.join('\u0000')
}

function identityOf(type: EntityType, record: Record<string, unknown>): string[] {
  switch (type) {
    case 'DM-001':
      return [String(record.source)]
    case 'DM-002':
      return [String(record.groupId)]
    case 'DM-003':
      return [String(record.messageId)]
    case 'DM-004':
      return [String(record.groupId), String(record.memberId)]
    case 'DM-005':
      return [String(record.contactId), String(record.source)]
    default:
      return []
  }
}

/**
 * 进程内存储替身：
 * - 身份去重（insert-only 忽略重复 / upsert 覆盖变异字段）与 `MOD-002` 的 `written` 口径一致
 *   （`written = 记录数 − 失败数`，“重复但不失败”仍计入 written）；
 * - 立即外键：`DM-003` 的 `(group_id, sender_key)` → `DM-004`、`DM-004` / `DM-003` 的群 → `DM-002`；
 * - 「我」的口径：DM-004 至多一条 `isMe = true`（第二条落单条失败明细；upsert 不改 `isMe` 与 `personId`）。
 */
export class FakeStore implements Store {
  readonly dataDir = '/tmp/messagepick-ingest-test'
  readonly deleteGate: DeleteGate = { enter: () => {}, leave: () => {}, isDeleting: () => false }
  readonly statuses = new Map<IngestSource, CollectSourceStatus>()
  readonly groups = new Map<Id, Group>()
  readonly messages = new Map<Id, RawMessage>()
  /** 键 = 群 + 成员标识 */
  readonly members = new Map<string, GroupMember>()
  /** 键 = 联系人标识 + 来源 */
  readonly contacts = new Map<string, ContactRecord>()
  readonly writeCalls: Array<{ type: EntityType; count: number }> = []
  readonly readCalls: Array<{ type: EntityType; filter: FilterCondition | null; page: PageRequest | null }> = []
  /** 置真时读取抛 `STORAGE_UNAVAILABLE`（`AC-038` 的注入点） */
  failReads = false
  /** 这些实体类型的写入整体失败（模拟存储不可用） */
  readonly failWrites = new Set<EntityType>()

  seedGroup(groupId: Id, groupName = groupId): void {
    this.groups.set(groupId, { groupId, groupName })
  }

  seedMessage(message: RawMessage): void {
    this.messages.set(message.messageId, message)
  }

  seedMember(member: GroupMember): void {
    this.members.set(identityKey(member.groupId, member.memberId), member)
  }

  meMembers(): GroupMember[] {
    return [...this.members.values()].filter((member) => member.isMe)
  }

  write<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    _options?: { bumpEpoch?: boolean },
  ): WriteResult {
    this.writeCalls.push({ type, count: records.length })
    const failures: WriteResult['failures'] = []
    let written = 0
    for (const record of records) {
      const values = record as unknown as Record<string, unknown>
      const reason = this.#writeOne(type, values)
      if (reason === null) written += 1
      else failures.push({ identity: identityOf(type, values), reason })
    }
    return { written, failures }
  }

  read<T extends EntityType>(
    type: T,
    filter?: FilterCondition | null,
    page?: PageRequest | null,
  ): ReadResult<T> {
    this.readCalls.push({ type, filter: filter ?? null, page: page ?? null })
    if (this.failReads) throw storageUnavailable('store:read', { retryable: false })
    const rows = this.#rows(type, filter ?? null)
    const pageNumber = Math.max(1, page?.page ?? 1)
    const pageSize = Math.max(1, page?.pageSize ?? 50)
    const start = (pageNumber - 1) * pageSize
    return {
      records: rows.slice(start, start + pageSize) as unknown as EntityRecord<T>[],
      pageInfo: { page: pageNumber, pageSize, total: rows.length },
    }
  }

  /** 未使用通道（采集侧不读媒体、不删除、不碰 epoch）。 */
  preflightDeletion(): never {
    throw new Error('FakeStore 未实现 preflightDeletion（采集侧不调用）')
  }

  executeDeletion(): never {
    throw new Error('FakeStore 未实现 executeDeletion（采集侧不调用）')
  }

  currentEpoch(): number {
    return 0
  }

  openMedia(): never {
    throw new Error('FakeStore 未实现 openMedia（采集侧不调用）')
  }

  writeMedia(): never {
    throw new Error('FakeStore 未实现 writeMedia（采集侧不调用）')
  }

  async resumeCleanup(): Promise<number> {
    return 0
  }

  close(): void {
    /* 无连接可关 */
  }

  #rows(type: EntityType, filter: FilterCondition | null): EntityRecord<EntityType>[] {
    switch (type) {
      case 'DM-001':
        return [...this.statuses.values()] as EntityRecord<EntityType>[]
      case 'DM-003': {
        const all = [...this.messages.values()] as EntityRecord<EntityType>[]
        const identity = filter?.identity ?? null
        if (identity == null) return all
        return all.filter((record) => 'senderMemberId' in record && record.senderMemberId === identity)
      }
      case 'DM-004': {
        const all = [...this.members.values()] as EntityRecord<EntityType>[]
        const identity = filter?.identity ?? null
        if (identity == null) return all
        return all.filter((record) => 'memberId' in record && record.memberId === identity)
      }
      case 'DM-002':
        return [...this.groups.values()] as EntityRecord<EntityType>[]
      case 'DM-005':
        return [...this.contacts.values()] as EntityRecord<EntityType>[]
      default:
        return []
    }
  }

  /** 返回 null = 成功；返回字符串 = 单条失败原因（口径对齐真实存储的单条失败明细）。 */
  #writeOne(type: EntityType, record: Record<string, unknown>): string | null {
    if (this.failWrites.has(type)) return '存储不可用（FakeStore 注入）'
    switch (type) {
      case 'DM-001': {
        this.statuses.set(record.source as IngestSource, record as unknown as CollectSourceStatus)
        return null
      }
      case 'DM-002': {
        const groupId = String(record.groupId)
        this.groups.set(groupId, { groupId, groupName: String(record.groupName) })
        return null
      }
      case 'DM-004': {
        const groupId = String(record.groupId)
        if (!this.groups.has(groupId)) return FK_REASON
        const memberId = String(record.memberId)
        const key = identityKey(groupId, memberId)
        const existing = this.members.get(key)
        const isMe = record.isMe === true
        if (isMe && [...this.members.values()].some((member) => member.isMe && member.memberId !== memberId)) {
          return ME_UNIQUE_REASON
        }
        if (existing !== undefined) {
          // upsert 只覆盖变异白名单（displayName）；isMe / personId 保持原值
          this.members.set(key, { ...existing, displayName: String(record.displayName) })
          return null
        }
        this.members.set(key, {
          memberId,
          groupId,
          displayName: String(record.displayName),
          isMe,
          personId: String(record.personId),
        })
        return null
      }
      case 'DM-003': {
        const groupId = String(record.groupId)
        const senderMemberId = String(record.senderMemberId)
        if (!this.groups.has(groupId)) return FK_REASON
        if (!this.members.has(identityKey(groupId, senderMemberId))) return FK_REASON
        const messageId = String(record.messageId)
        if (this.messages.has(messageId)) return null // insert-only：重复忽略且不计失败
        this.messages.set(messageId, record as unknown as RawMessage)
        return null
      }
      case 'DM-005': {
        const key = identityKey(String(record.contactId), String(record.source))
        if (!this.contacts.has(key)) this.contacts.set(key, record as unknown as ContactRecord)
        return null
      }
      default:
        return `FakeStore 不支持写入 ${type}`
    }
  }
}

// ---------------------------------------------------------------------------
// CLI 子进程替身
// ---------------------------------------------------------------------------

export interface CliCall {
  args: readonly string[]
  timeoutMs: number
}

export interface CliReply {
  exitCode?: number
  stdout?: string
  stderr?: string
  timedOut?: boolean
  spawnFailed?: boolean
  /** 挂起不返回，直到 `releaseNext` / `releaseAll`（并发路径测试用） */
  defer?: boolean
}

interface Rule {
  match: (args: readonly string[]) => boolean
  reply: CliReply | ((args: readonly string[]) => CliReply)
  once: boolean
}

function toResult(reply: CliReply): CliResult {
  return {
    exitCode: reply.exitCode ?? 0,
    stdout: reply.stdout ?? '',
    stderrTail: reply.stderr ?? '',
    durationMs: 1,
    timedOut: reply.timedOut ?? false,
    spawnFailed: reply.spawnFailed ?? false,
  }
}

/** 成功返回（stdout 为脚本给定的输出）。 */
export function okReply(stdout: string): CliReply {
  return { stdout }
}

/** 指定退出码的失败返回。 */
export function failReply(exitCode: number, stderr = ''): CliReply {
  return { exitCode, stderr }
}

/** 超时返回（子进程已被终止，不读残缺输出）。 */
export function timeoutReply(): CliReply {
  return { timedOut: true, exitCode: -1 }
}

/** 启动失败（可执行文件不存在）。 */
export function spawnFailReply(): CliReply {
  return { spawnFailed: true, exitCode: -1 }
}

/** 命令匹配器：第 1 个参数 = 命令名。 */
export function cmd(command: string): (args: readonly string[]) => boolean {
  return (args) => args[0] === command
}

/** 命令匹配器：命令名 + 目标（群 / 会话标识）。 */
export function cmdFor(command: string, target: string): (args: readonly string[]) => boolean {
  return (args) => args[0] === command && args[1] === target
}

/**
 * 进程内 CLI 子进程替身：优先消费 `queue`（FIFO），否则命中第一条匹配规则；
 * 缺脚本即抛错（暴露测试遗漏，不静默）。
 */
export class FakeCliRunner implements CliRunner {
  readonly calls: CliCall[] = []
  readonly queue: CliReply[] = []
  readonly pending: Array<{ args: readonly string[]; resolve: (result: CliResult) => void }> = []
  probeResult: CliProbeResult = {
    executable: '/fake/wechat-cli',
    available: true,
    version: null,
    initState: 'unknown',
  }

  #rules: Rule[] = []

  on(match: (args: readonly string[]) => boolean, reply: CliReply | ((args: readonly string[]) => CliReply), options: { once?: boolean } = {}): this {
    this.#rules.push({ match, reply, once: options.once ?? false })
    return this
  }

  /** 放行最早的挂起调用。 */
  releaseNext(reply: CliReply = okReply('[]')): boolean {
    const entry = this.pending.shift()
    if (entry === undefined) return false
    entry.resolve(toResult(reply))
    return true
  }

  /** 放行全部挂起调用。 */
  releaseAll(reply: CliReply = okReply('[]')): number {
    let count = 0
    while (this.releaseNext(reply)) count += 1
    return count
  }

  /** 某命令的全部调用（按发生顺序）。 */
  callsOf(command: string): CliCall[] {
    return this.calls.filter((call) => call.args[0] === command)
  }

  run(args: string[], timeoutMs: number): Promise<CliResult> {
    const frozen = [...args]
    this.calls.push({ args: frozen, timeoutMs })
    const queued = this.queue.shift()
    if (queued !== undefined) return this.#settle(frozen, queued)
    const index = this.#rules.findIndex((rule) => rule.match(frozen))
    if (index < 0) throw new Error(`FakeCliRunner 未编排命令：${frozen.join(' ')}`)
    const rule = this.#rules[index]!
    const reply = typeof rule.reply === 'function' ? rule.reply(frozen) : rule.reply
    if (rule.once) this.#rules.splice(index, 1)
    return this.#settle(frozen, reply)
  }

  #settle(args: readonly string[], reply: CliReply): Promise<CliResult> {
    if (reply.defer === true) {
      return new Promise<CliResult>((resolve) => {
        this.pending.push({ args, resolve })
      })
    }
    return Promise.resolve(toResult(reply))
  }

  async probe(): Promise<CliProbeResult> {
    return this.probeResult
  }
}

// ---------------------------------------------------------------------------
// CLI 输出构造（形状与 wechat-cli 的裸数组 / 字典口径一致）
// ---------------------------------------------------------------------------

export function makeMessageLine(at: string, sender: string, content: string): string {
  return `[${at}] ${sender}: ${content}`
}

export function sessionsJson(
  items: Array<{ chat: string; username: string; isGroup?: boolean; time?: string }>,
): string {
  return JSON.stringify(
    items.map((item) => ({
      chat: item.chat,
      username: item.username,
      is_group: item.isGroup ?? false,
      unread: null,
      last_message: null,
      msg_type: null,
      sender: null,
      timestamp: null,
      time: item.time ?? null,
    })),
  )
}

export function membersJson(input: {
  group: string
  username: string
  members: Array<{ username: string; displayName?: string | null; nickName?: string | null; remark?: string | null }>
}): string {
  return JSON.stringify({
    group: input.group,
    username: input.username,
    member_count: input.members.length,
    owner: null,
    members: input.members.map((member) => ({
      username: member.username,
      nick_name: member.nickName ?? null,
      remark: member.remark ?? null,
      display_name: member.displayName ?? null,
    })),
  })
}

export function historyJson(input: {
  username: string
  chat?: string
  isGroup?: boolean
  messages: readonly string[]
  failures?: readonly string[]
}): string {
  return JSON.stringify({
    chat: input.chat ?? input.username,
    username: input.username,
    is_group: input.isGroup ?? true,
    count: input.messages.length,
    offset: 0,
    limit: 1000,
    messages: [...input.messages],
    failures: [...(input.failures ?? [])],
  })
}

export function contactsJson(items: Array<{ username: string; nickName?: string | null; remark?: string | null }>): string {
  return JSON.stringify(
    items.map((item) => ({
      username: item.username,
      nick_name: item.nickName ?? null,
      remark: item.remark ?? null,
    })),
  )
}

// ---------------------------------------------------------------------------
// 适配器 / 执行器 / 模块装配
// ---------------------------------------------------------------------------

export interface HarnessOptions {
  /** 自动重试次数上限（默认 0：测试默认不自动重试，需要时显式给出） */
  maxAttempts?: number
  pageSize?: number
  sessionLimit?: number
  listLimit?: number
  sleep?: (ms: number) => Promise<void>
  logger?: IngestLogger
}

function sharedAdapterOptions(store: FakeStore, runner: FakeCliRunner, clock: ManualClock, options: HarnessOptions) {
  const policy = createRetryPolicy(options.maxAttempts ?? 0)
  return {
    store,
    runner,
    parse: createInlineParseRunner(),
    policy,
    breaker: new RetryBreaker(policy),
    sleep: options.sleep ?? (async () => {}),
    clock: clock.now,
    timeoutMs: 5_000,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  }
}

export function makeGroupAdapter(
  store: FakeStore,
  runner: FakeCliRunner,
  clock: ManualClock,
  options: HarnessOptions = {},
): SourceAdapter {
  return createGroupMessagesAdapter({
    ...sharedAdapterOptions(store, runner, clock, options),
    pageSize: options.pageSize ?? 100,
    sessionLimit: options.sessionLimit ?? 200,
  })
}

export function makeContactsAdapter(
  store: FakeStore,
  runner: FakeCliRunner,
  clock: ManualClock,
  options: HarnessOptions = {},
): SourceAdapter {
  return createContactsAdapter({
    ...sharedAdapterOptions(store, runner, clock, options),
    listLimit: options.listLimit ?? 1000,
  })
}

/** 采集上下文（直接驱动单个适配器时使用）。 */
export function collectContext(overrides: Partial<CollectContext> = {}): CollectContext & { progress: IngestProgressEvent[] } {
  const events: IngestProgressEvent[] = []
  const context: CollectContext = {
    runId: 'test-run',
    onProgress: (progress) => events.push({ kind: 'source', runId: 'test-run', at: NOW, progress }),
    ...overrides,
  }
  return Object.assign(context, { progress: events })
}

/** 脚本化来源适配器（执行器并发 / 串行路径测试用）。 */
export class FakeAdapter implements SourceAdapter {
  readonly contexts: CollectContext[] = []
  readonly log: string[] = []

  constructor(
    readonly source: IngestSource,
    private readonly handler: (ctx: CollectContext) => CollectOutcome | Promise<CollectOutcome>,
  ) {}

  async collect(ctx: CollectContext): Promise<CollectOutcome> {
    this.contexts.push(ctx)
    this.log.push(`${this.source}:start`)
    const outcome = await this.handler(ctx)
    this.log.push(`${this.source}:end`)
    return outcome
  }
}

/** 成功结局（可带断点）。 */
export function successOutcome(
  source: IngestSource,
  options: { written?: number; completedAt?: number; checkpoint?: SourceCheckpoint } = {},
): CollectOutcome {
  return {
    source,
    status: 'succeeded',
    written: options.written ?? 1,
    subFailures: [],
    completedAt: options.completedAt ?? NOW,
    ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
  }
}

/** 失败结局（含来源级明细）。 */
export function failureOutcome(
  source: IngestSource,
  code: ErrorCode,
  status: 'failed' | 'noAuth' | 'timeout',
  options: { reason?: string; checkpoint?: SourceCheckpoint; retryable?: boolean } = {},
): CollectOutcome {
  const detail = {
    code,
    reason: options.reason ?? `${source}：${code}`,
    scope: `来源:${source}`,
    retryable: options.retryable ?? true,
  }
  return {
    source,
    status,
    written: 0,
    failure: detail,
    subFailures: [detail],
    ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
  }
}

export function makeExecutor(
  store: FakeStore,
  adapters: Readonly<Record<IngestSource, SourceAdapter>>,
  clock: ManualClock,
  options: { progress?: IngestProgressChannel; logger?: IngestLogger; overlapMs?: number; runIdFactory?: () => string } = {},
): IngestExecutor {
  return createIngestExecutor({
    store,
    adapters,
    clock: clock.now,
    ...(options.progress === undefined ? {} : { progress: options.progress }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.overlapMs === undefined ? {} : { overlapMs: options.overlapMs }),
    ...(options.runIdFactory === undefined ? {} : { runIdFactory: options.runIdFactory }),
  })
}

export function makeModule(
  store: FakeStore,
  runner: FakeCliRunner,
  clock: ManualClock,
  options: { config?: IngestConfigPatch; maxAttempts?: number; sleep?: (ms: number) => Promise<void>; logger?: IngestLogger } = {},
): IngestModule {
  return createIngestModule({
    store,
    runner,
    parse: createInlineParseRunner(),
    clock: clock.now,
    sleep: options.sleep ?? (async () => {}),
    config: { maxAttempts: options.maxAttempts ?? 0, ...(options.config ?? {}) },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
}

export { createIngestProgress }
export type { IngestExecutor, RunReport }
