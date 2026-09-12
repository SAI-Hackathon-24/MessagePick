/**
 * MOD-008 测试支撑（mod-008 §7.3「Mock 与边界」）：
 *
 * - 模板库一律使用临时目录夹具（`mkdtemp` + 元数据 JSON + 内置素材文件），不碰真实应用数据目录与打包资源；
 * - 记录工厂给最小合法记录（字段口径照 `src/shared/entities.ts`；时间固定为 `CLOCK`）；
 * - 断言工具把 `RegenError` 的契约信封取出，供口径断言直接使用（与 store / engine 的 harness 同口径）。
 *
 * 说明：模型任务、worker 池与存储网关的桩（§7.3）在本轮实现面（constants / errors / domain /
 * materials / render/registry）之外，待对应实现落地后在此装配。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ErrorEnvelope, RawMessage } from '@shared'

import { RegenError } from '../errors'

/** 固定时钟（2023-11-14T22:13:20Z）：生成时间与确认时间可复现。 */
export const CLOCK = 1_700_000_000_000

/** 断言调用抛出 `RegenError` 并返回其契约信封（同步）。 */
export function regenEnvelope(fn: () => unknown): ErrorEnvelope {
  try {
    fn()
  } catch (error) {
    if (error instanceof RegenError) return error.envelope
    throw error
  }
  throw new Error('期望抛出 RegenError，但调用未抛错')
}

/** 原始消息工厂：最小合法记录（`RawMessage`，DM-003）。 */
export function rawMessage(overrides: Partial<RawMessage> & { messageId: string }): RawMessage {
  return {
    groupId: 'group-1',
    senderMemberId: 'member-1',
    sentAt: CLOCK,
    kind: '文字',
    text: null,
    mediaRef: null,
    mentionedMemberIds: null,
    quotedMessageId: null,
    ...overrides,
  }
}

/** 最小 PNG 文件头（素材字节比对样例）。 */
export const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 模板库临时目录夹具（§3.3：元数据 JSON + 内置素材；用完 `dispose()`）。 */
export class TemplateFixture {
  readonly dir: string

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'messagepick-regen-templates-'))
  }

  /** 写一个内置素材文件（内容可自定义，默认 PNG 文件头）。 */
  writeAsset(ref: string, bytes: Uint8Array = PNG_HEADER): this {
    const target = join(this.dir, ref)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    return this
  }

  /** 写清单文件（对象自动 JSON 序列化；字符串原样写入，便于构造非法 JSON）。 */
  writeManifest(content: unknown, fileName = 'index.json'): this {
    const text = typeof content === 'string' ? content : (JSON.stringify(content) ?? '')
    writeFileSync(join(this.dir, fileName), text)
    return this
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

/** 最小合法模板条目（`TemplateMeta` 的 JSON 形态；覆盖出局部非法字段构造校验用例）。 */
export function templateEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tpl-basic',
    version: 1,
    name: '基础模板',
    tiers: ['纯模板生成'],
    size: { w: 300, h: 300 },
    textSlots: [
      {
        id: 'caption',
        box: { x: 10, y: 10, w: 280, h: 60 },
        font: { family: 'sans', sizePx: 24 },
        maxLines: 2,
        align: 'center',
      },
    ],
    mediaSlots: [],
    builtinAssets: [],
    ...overrides,
  }
}
