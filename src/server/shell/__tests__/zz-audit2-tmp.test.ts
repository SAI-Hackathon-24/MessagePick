/** 临时审计用例 2（审计结束后删除）：窗口扫描静默截断。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EntryRepository } from '@server/extract/store/entry-repository'
import { createStore } from '@server/store'

describe('审计：窗口消息扫描', () => {
  it('超过硬上限时静默丢弃最旧消息且无截断标记', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'messagepick-audit2-'))
    const store = createStore({ dataDir })
    try {
      store.write('DM-002', [{ groupId: 'g1', groupName: '群1' }])
      store.write('DM-004', [{ memberId: 'me', groupId: 'g1', displayName: '我', isMe: true, personId: 'pme' }])
      const messages = []
      for (let index = 0; index < 20_001; index += 1) {
        messages.push({
          messageId: `msg-${String(index).padStart(5, '0')}`,
          groupId: 'g1',
          senderMemberId: 'me',
          sentAt: index, // 序号即时间：msg-00000 最旧，msg-20000 最新
          kind: '文字',
          text: `内容${index}`,
          mediaRef: null,
          mentionedMemberIds: null,
          quotedMessageId: null,
        })
      }
      store.write('DM-003', messages)
      const total = store.read('DM-003', null, { page: 1, pageSize: 1 }).pageInfo.total

      const repository = new EntryRepository(store) // 生产默认装配：不传任何 options
      const rows = repository.readWindowMessages({ from: 0, to: 1_000_000 })
      const ids = rows.map((row) => row.messageId)
      // eslint-disable-next-line no-console
      console.log('DM-003 total =', total)
      // eslint-disable-next-line no-console
      console.log('窗口扫描返回 =', ids.length, '（无 truncated 标记）')
      // eslint-disable-next-line no-console
      console.log('是否包含最旧消息 msg-00000 =', ids.includes('msg-00000'))
      // eslint-disable-next-line no-console
      console.log('最旧一条 =', ids[ids.length - 1])
      expect(total).toBe(20_001)
      expect(ids.length).toBe(20_000)
      expect(ids.includes('msg-00000')).toBe(true) // 这正是被静默丢弃的那条
    } finally {
      store.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
