/** 临时审计用例（审计结束后删除）。 */
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createShellApp, type ShellApp } from '../app'

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
const dataDir = mkdtempSync(join(tmpdir(), 'messagepick-audit-'))
let shell: ShellApp
let server: Server
let base: string

beforeAll(async () => {
  shell = createShellApp({
    dataDir,
    token: TOKEN,
    logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
  })
  const members = []
  for (let index = 1; index <= 1200; index += 1) {
    members.push({
      memberId: `mem${String(index).padStart(4, "0")}`,
      groupId: 'g1',
      displayName: `成员${index}`,
      isMe: false,
      personId: `per${String(index).padStart(4, "0")}`,
    })
  }
  shell.ports.store.write('DM-002', [{ groupId: 'g1', groupName: '审计群' }])
  const written = shell.ports.store.write('DM-004', members)
  // eslint-disable-next-line no-console
  console.log('write result =', JSON.stringify(written).slice(0, 600))
  await new Promise<void>((resolve) => {
    server = shell.app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  shell.dispose()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('审计：成员目录', () => {
  it('总数与逐条可读性', async () => {
    const total = shell.ports.store.read('DM-004', null, { page: 1, pageSize: 1 }).pageInfo.total
    // eslint-disable-next-line no-console
    console.log('DM-004 total =', total)

    const first = await (await fetch(`${base}/api/members?ids=mem0001`)).json()
    const last = await (await fetch(`${base}/api/members?ids=mem1200`)).json()
    const middle = await (await fetch(`${base}/api/members?ids=mem0999,mem1000,mem1001`)).json()
    // eslint-disable-next-line no-console
    console.log('ids=m1        ->', JSON.stringify(first))
    // eslint-disable-next-line no-console
    console.log('ids=m999..1001->', JSON.stringify(middle))
    // eslint-disable-next-line no-console
    console.log('ids=m1200     ->', JSON.stringify(last))
    expect(total).toBe(1200)
  })
})
