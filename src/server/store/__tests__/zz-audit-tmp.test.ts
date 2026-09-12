/** 临时审计探针（审计结束后删除）：媒体索引共享 + 打开失败分类 + 悬空成员引用。 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { isStoreError } from '../errors'
import { createStore } from '../index'

import { CLOCK, StoreHarness, messageRecord } from './harness'

const harness = new StoreHarness()
const cleanupDirs: string[] = []
afterEach(() => {
  harness.dispose()
  while (cleanupDirs.length > 0) rmSync(cleanupDirs.pop()!, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'messagepick-audit-'))
  cleanupDirs.push(dir)
  return dir
}

describe('探针：媒体索引共享', () => {
  it('两个群的两条消息共用同一媒体路径：删一个群会删掉另一个群仍在引用的文件', async () => {
    const { store, dataDir } = harness.create()
    store.write('DM-002', [
      { groupId: 'gA', groupName: 'A' },
      { groupId: 'gB', groupName: 'B' },
    ])
    store.write('DM-004', [
      { memberId: 'me', groupId: 'gA', displayName: '我', isMe: true, personId: 'p-me' },
      { memberId: 'bob', groupId: 'gB', displayName: '鲍勃', isMe: false, personId: 'p-bob' },
    ])
    // 同一张表情包图片被两个群的两条消息引用（同一相对路径）
    store.writeMedia('media/sticker.png', new Uint8Array([1, 2, 3]))
    store.write('DM-003', [
      messageRecord('gA', 'mA', { senderMemberId: 'me', kind: '表情包', mediaRef: 'media/sticker.png' }),
      messageRecord('gB', 'mB', { senderMemberId: 'bob', kind: '表情包', mediaRef: 'media/sticker.png' }),
    ])
    const filePath = join(dataDir, 'media', 'sticker.png')
    console.log('文件存在（删除前）:', existsSync(filePath))
    console.log('gB 消息可读:', JSON.stringify(store.read('DM-003', { groupIds: ['gB'] }).records[0]?.mediaRef))
    console.log('openMedia（删除前）:', store.openMedia('media/sticker.png').bytes.length)

    await store.executeDeletion({ kind: 'group', groupId: 'gA' }, true)

    console.log('文件存在（删除 gA 后）:', existsSync(filePath))
    console.log('gB 消息仍在:', store.read('DM-003', { groupIds: ['gB'] }).pageInfo.total)
    try {
      const payload = store.openMedia('media/sticker.png')
      console.log('openMedia（删除后）: ok', payload.bytes.length)
    } catch (error) {
      console.log('openMedia（删除后）: THROW', isStoreError(error) ? error.envelope.code : String(error))
    }
    console.log(
      '_media_index:',
      JSON.stringify(
        harness.create().inspect ? undefined : undefined,
      ),
    )
    expect(true).toBe(true)
  })
})

describe('探针：损坏库文件的错误分类', () => {
  it('dbPath 指向非数据库文件 → createStore 抛出的不是 StoreError', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'app.db')
    writeFileSync(dbPath, '这不是一个 SQLite 数据库文件'.repeat(100))
    let error: unknown
    try {
      const store = createStore({ dataDir: dir, dbPath, requireMainThread: false, autoResumeCleanup: false })
      store.close()
      console.log('未抛错（意外）')
      return
    } catch (caught) {
      error = caught
    }
    console.log('isStoreError:', isStoreError(error))
    console.log('error.name:', (error as Error).name)
    console.log('error.code:', (error as { code?: string }).code)
    console.log('error.message:', (error as Error).message)
    expect(true).toBe(true)
  })
})

describe('探针：DM-012 成员引用无外键兜底', () => {
  it('引用不存在的成员：写入成功且读回悬空引用', () => {
    const { store } = harness.create()
    const result = store.write('DM-012', [
      { candidateId: 'c1', sourceContactId: 'ct', memberIds: ['不存在的人'], status: '已确认', confirmedAt: CLOCK },
    ])
    console.log('write result:', JSON.stringify(result))
    console.log('read back:', JSON.stringify(store.read('DM-012').records))
    expect(true).toBe(true)
  })
})
