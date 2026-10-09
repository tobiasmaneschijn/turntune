import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ChatCommandService, type ChatCommandServiceOptions } from './chat-command-service.js'

const alice = '11111111-1111-4111-8111-111111111111'
const staff = '22222222-2222-4222-8222-222222222222'
const initialTime = Date.parse('2026-10-09T10:00:00Z')
const message = (now: number, id = randomUUID(), content = 'Hello') => ({
  id,
  content,
  type: 'text' as const,
  createdAt: new Date(now).toISOString(),
  mentions: []
})

test('local chat commits before delivery, preserves immutable receipts and cooldowns across restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-chat-'))
  let now = initialTime
  const emitted: string[] = []
  const options: ChatCommandServiceOptions = {
    client: null,
    dataDir: dir,
    now: () => now,
    getUser: async (id) => ({ id, name: 'Alice', avatarSeed: id }),
    authorize: async () => ({ slowModeSeconds: 10 }),
    emit: async (_room, event) => {
      assert.ok(JSON.parse(await readFile(path.join(dir, 'soundspin-chat.json'), 'utf8')).messages)
      emitted.push(event)
    }
  }
  try {
    const service = new ChatCommandService(options),
      input = message(now)
    await Promise.all([service.message('lounge', alice, input), service.message('lounge', alice, input)])
    assert.deepEqual(emitted, ['chat:message'])
    const restarted = new ChatCommandService(options)
    await restarted.message('lounge', alice, input)
    assert.deepEqual(emitted, ['chat:message'])
    await assert.rejects(restarted.message('lounge', alice, { ...input, content: 'Changed' }), /different content/)
    await assert.rejects(restarted.message('lounge', staff, input), /different content/)
    await assert.rejects(restarted.message('elsewhere', alice, input), /different content/)
    await assert.rejects(restarted.message('lounge', alice, message(now)), /Slow mode/)
    now += 10_000
    await restarted.message('lounge', alice, message(now))
    assert.equal(emitted.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('removal wins before a save and after restart, including replies, reactions and polls', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-chat-'))
  const emitted: Array<{ event: string; payload: unknown }> = []
  const options: ChatCommandServiceOptions = {
    client: null,
    dataDir: dir,
    now: () => initialTime,
    getUser: async (id) => ({ id, name: id === alice ? 'Alice' : 'Staff', avatarSeed: id }),
    authorize: async (id, _room, kind) => {
      if (kind === 'remove' && id !== staff) throw new Error('Only staff can remove messages.')
    },
    emit: async (_room, event, payload) => {
      emitted.push({ event, payload })
    }
  }
  try {
    const service = new ChatCommandService(options),
      input = { ...message(initialTime), poll: { options: ['One', 'Two'] } }
    await service.removeMessage('lounge', staff, input.id, randomUUID(), 'Removed before receipt')
    const removed = await service.message('lounge', alice, input)
    assert.equal(removed.content, 'Message removed')
    assert.ok(removed.removedAt)
    assert.equal(removed.poll, undefined)
    const restarted = new ChatCommandService(options)
    assert.equal((await restarted.message('lounge', alice, input)).content, 'Message removed')
    await assert.rejects(
      restarted.reaction('lounge', alice, { id: randomUUID(), messageId: input.id, action: 'add', emoji: '❤️' }),
      /unavailable/
    )
    await assert.rejects(restarted.pollVote('lounge', alice, input.id, 0), /unavailable/)
    const reply = await restarted.message('lounge', alice, { ...message(initialTime), replyTo: { id: input.id } })
    assert.equal(reply.replyTo?.content, 'Message removed')
    const normal = message(initialTime, randomUUID(), 'Secret')
    await restarted.message('lounge', alice, normal)
    const quote = await restarted.message('lounge', alice, { ...message(initialTime), replyTo: { id: normal.id } })
    const pendingHistory = await restarted.readPage('lounge')
    const requestId = randomUUID()
    await restarted.removeMessage('lounge', staff, normal.id, requestId, 'Spam')
    await restarted.removeMessage('lounge', staff, normal.id, requestId, 'Spam')
    assert.equal((await restarted.message('lounge', alice, normal)).content, 'Message removed')
    assert.equal((await restarted.loadMessage(quote.id))?.message.replyTo?.content, 'Message removed')
    const lateHistory = await restarted.readPayload('lounge', pendingHistory.rows)
    assert.equal(lateHistory.rows.find((row) => row.id === normal.id)?.content, 'Message removed')
    assert.equal((await restarted.listRemovalLog('lounge')).length, 2)
    assert.equal((await restarted.readPage('lounge', undefined, 'older', 20, 'Secret')).rows.length, 0)
    assert.equal(emitted.filter((e) => e.event === 'chat:message').length, 3)
    await assert.rejects(restarted.removeMessage('elsewhere', staff, input.id, randomUUID()), /unavailable/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('failed durable write emits nothing and a new policy check can reject an operation before commit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-chat-'))
  const blockedPath = path.join(dir, 'file')
  await writeFile(blockedPath, 'not a directory')
  let emitted = 0,
    checks = 0
  const options: ChatCommandServiceOptions = {
    client: null,
    dataDir: blockedPath,
    now: () => initialTime,
    getUser: async (id) => ({ id, name: 'Alice', avatarSeed: id }),
    authorize: async () => {},
    emit: async () => {
      emitted++
    }
  }
  try {
    await assert.rejects(new ChatCommandService(options).message('lounge', alice, message(initialTime)))
    assert.equal(emitted, 0)
    const revoked = new ChatCommandService({
      ...options,
      dataDir: dir,
      authorize: async () => {
        if (++checks > 1) throw new Error('This room session has ended.')
      }
    })
    await assert.rejects(revoked.message('lounge', alice, message(initialTime)), /session has ended/)
    assert.equal(emitted, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
