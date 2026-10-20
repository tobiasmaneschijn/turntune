import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { ChatCommandService, type ChatCommandServiceOptions } from './chat-command-service.js'
import { CHAT_MAX_REACTIONS_PER_MESSAGE, CHAT_MAX_HISTORY_CHILDREN, CHAT_MAX_POLL_VOTERS } from './chat-validation.js'

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

test('saved chat uses the committed result without another read and retries return current removal state', async () => {
  const rows = new Map<string, Record<string, any>>(), requests: string[] = [], events: string[] = []
  let checks = 0
  const client = createClient('https://chat.test', 'test-secret', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!
      requests.push(table)
      let data: unknown = null
      if (table === 'soundspin_chat_command') {
        const args = JSON.parse(String(init?.body)), value = args.p_payload, prior = rows.get(value.id)
        const row = prior || {
          id: value.id, room_slug: args.p_room, user_id: args.p_user,
          user_name: value.user.name, avatar_seed: value.user.avatarSeed,
          content: value.content, message_type: value.type, created_at: value.createdAt,
          media_url: null, storage_path: null, mentions: [], reply_to_id: null, poll_options: null,
          immutable_fingerprint: args.p_fingerprint, removed_at: null,
          soundspin_message_reactions: [], soundspin_poll_votes: [], reply: null
        }
        rows.set(value.id, row)
        data = { fresh: !prior, result: { id: value.id }, row }
      } else if (table === 'soundspin_chat_message_state') {
        const args = JSON.parse(String(init?.body))
        data = { row: rows.get(args.p_id) || null, removal: null }
      } else if (table === 'soundspin_messages') data = rows.get(url.searchParams.get('id')!.slice(3)) || null
      else if (table === 'soundspin_chat_receipts') data = { fingerprint: 'b'.repeat(64) }
      else throw new Error(`Unexpected read: ${table}`)
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    } }
  })
  const options: ChatCommandServiceOptions = {
    client, now: () => initialTime,
    getUser: async id => ({ id, name: 'Alice', avatarSeed: id }),
    authorize: async () => { checks++ },
    emit: async (_room, event) => { events.push(event) }
  }
  const input = message(initialTime), service = new ChatCommandService(options)
  assert.equal((await service.message('lounge', alice, input)).content, 'Hello')
  assert.deepEqual(requests, ['soundspin_chat_message_state', 'soundspin_chat_command'])
  assert.equal(checks, 2)
  requests.length = 0
  await new ChatCommandService(options).message('lounge', alice, input)
  assert.ok(!requests.includes('soundspin_chat_receipts'))
  assert.equal(requests.filter(table => table === 'soundspin_chat_message_state').length, 1)
  assert.deepEqual(events, ['chat:message'])
  Object.assign(rows.get(input.id)!, { content: 'Message removed', removed_at: new Date(initialTime).toISOString() })
  assert.ok((await new ChatCommandService(options).message('lounge', alice, input)).removedAt)
  assert.deepEqual(events, ['chat:message', 'chat:removed'])
  assert.equal(checks, 6)
  requests.length = 0
  await service.loadMessage(input.id)
  assert.deepEqual(requests, ['soundspin_messages'])
  requests.length = 0
  rows.get(input.id)!.immutable_fingerprint = null
  assert.equal((await service.loadMessage(input.id))!.fingerprint, 'b'.repeat(64))
  assert.deepEqual(requests, ['soundspin_messages', 'soundspin_chat_receipts'])
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
    const context = await restarted.readContext('lounge', quote.id)
    assert.ok(context?.rows.some(row => row.id === quote.id))
    assert.equal(context?.replies.find(row => row.id === normal.id)?.content, 'Message removed')
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

test('supported reactions are canonical, concurrent choices obey cardinality, and accepted no-ops retain bounded retry identity without message writes or broadcast', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-chat-'))
  let now = initialTime
  const events: string[] = []
  const options: ChatCommandServiceOptions = { client: null, dataDir: dir, now: () => now,
    getUser: async id => ({ id, name: 'Alice', avatarSeed: id }), authorize: async () => {}, emit: async (_room, event) => { events.push(event) } }
  try {
    const service = new ChatCommandService(options), input = { ...message(now), poll: { options: ['One', 'Two'] } }
    await service.message('lounge', alice, input)
    const add = (emoji: string) => service.reaction('lounge', alice, { id: randomUUID(), messageId: input.id, action: 'add', emoji })
    await assert.rejects(add('fabricated'), /supported emoji/)
    const choices = await Promise.allSettled(['❤', '😂', '😮', '🔥'].map(add))
    assert.equal(choices.filter(result => result.status === 'fulfilled').length, 3)
    assert.equal(choices.filter(result => result.status === 'rejected').length, 1)
    const accepted = (await service.loadMessage(input.id))!.message as { reactions?: Array<{ emoji: string }> }
    assert.ok(accepted.reactions?.some(reaction => reaction.emoji === '❤️'))
    const before = await readFile(path.join(dir, 'soundspin-chat.json'), 'utf8'), eventCount = events.length
    for (let i = 0; i < 10; i++) await add('❤')
    await service.reaction('lounge', alice, { id: randomUUID(), messageId: input.id, action: 'remove', emoji: '👍' })
    const afterNoops = JSON.parse(await readFile(path.join(dir, 'soundspin-chat.json'), 'utf8'))
    assert.deepEqual(afterNoops.messages, JSON.parse(before).messages)
    assert.equal(Object.keys(afterNoops.receipts).length, Object.keys(JSON.parse(before).receipts).length + 11)
    assert.equal(events.length, eventCount)
    await service.pollVote('lounge', alice, input.id, 0)
    const afterVote = JSON.parse(await readFile(path.join(dir, 'soundspin-chat.json'), 'utf8'))
    assert.equal((await service.pollVote('lounge', alice, input.id, 0)).revision, 1)
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'soundspin-chat.json'), 'utf8')).messages, afterVote.messages)
    // The original immutable message remains safe after ephemeral receipts expire.
    now += 25 * 3600000
    const restarted = new ChatCommandService(options)
    await restarted.message('lounge', alice, input)
    await assert.rejects(restarted.message('lounge', alice, { ...input, content: 'Changed' }), /different content/)
    assert.equal(Object.keys(JSON.parse(await readFile(path.join(dir, 'soundspin-chat.json'), 'utf8')).receipts).length, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('accepted reaction and poll no-op retries cannot reverse a newer choice, including after restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-chat-'))
  const options: ChatCommandServiceOptions = { client: null, dataDir: dir, now: () => initialTime,
    getUser: async id => ({ id, name: 'Alice', avatarSeed: id }), authorize: async () => {}, emit: async () => {} }
  try {
    const service = new ChatCommandService(options), input = { ...message(initialTime), poll: { options: ['One','Two'] } }
    await service.message('lounge', alice, input)
    await service.reaction('lounge', alice, { id: randomUUID(), messageId: input.id, action: 'add', emoji: '❤️' })
    const noop = { id: randomUUID(), messageId: input.id, action: 'add', emoji: '❤️' }
    await service.reaction('lounge', alice, noop)
    await service.reaction('lounge', alice, { id: randomUUID(), messageId: input.id, action: 'remove', emoji: '❤️' })
    const restarted = new ChatCommandService(options)
    await restarted.reaction('lounge', alice, noop)
    assert.deepEqual(((await restarted.loadMessage(input.id))!.message as { reactions?: unknown[] }).reactions, [])
    await restarted.pollVote('lounge', alice, input.id, 0)
    const pollNoop = randomUUID()
    assert.equal((await restarted.pollVote('lounge', alice, input.id, 0, pollNoop)).revision, 1)
    await restarted.pollVote('lounge', alice, input.id, 1)
    assert.equal((await new ChatCommandService(options).pollVote('lounge', alice, input.id, 0, pollNoop)).revision, 1)
    assert.equal((await restarted.loadMessage(input.id))!.message.poll!.votes[0].optionIndex, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('only visible canonical same-room mentions notify, and recipient budgets survive restart without blocking plain chat', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-chat-'))
  let now = initialTime
  const bob = { id: staff, name: 'Bob Smith', avatarSeed: staff }
  const options: ChatCommandServiceOptions = { client: null, dataDir: dir, now: () => now,
    getUser: async id => ({ id, name: 'Alice', avatarSeed: id }), getMentionAudience: async () => [bob], authorize: async () => {}, emit: async () => {} }
  const claimed = [{ userId: bob.id, userName: 'Fabricated', handle: 'fake' }]
  try {
    let service = new ChatCommandService(options)
    assert.deepEqual((await service.message('lounge', alice, { ...message(now), mentions: claimed })).mentions, [])
    assert.deepEqual((await service.message('lounge', alice, { ...message(now, randomUUID(), 'Hi @fake'), mentions: claimed })).mentions, [])
    assert.deepEqual((await service.message('lounge', alice, { ...message(now, randomUUID(), 'Hi @Bob_Smith'), mentions: [{ ...claimed[0], userId: randomUUID() }] })).mentions, [])
    const valid = () => ({ ...message(now, randomUUID(), 'Hi @Bob_Smith'), mentions: claimed })
    const first = valid()
    assert.deepEqual((await service.message('lounge', alice, first)).mentions, [{ userId: bob.id, userName: bob.name, handle: 'Bob_Smith' }])
    await service.message('lounge', alice, first) // Retry spends no notification budget.
    for (let i=0;i<4;i++) await service.message('lounge', alice, valid())
    service = new ChatCommandService(options)
    await assert.rejects(service.message('lounge', alice, valid()), /Mention limit/)
    await service.message('lounge', alice, message(now, randomUUID(), 'Plain chat still works'))
    now += 60_000
    assert.equal((await service.message('lounge', alice, valid())).mentions.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('history bounds parent pages, corrupt legacy children, replies, and total fanout without skipping its cursor', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-chat-'))
  try {
    const records = Object.fromEntries(Array.from({ length: 60 }, (_, index) => {
      const item = { ...message(initialTime + index, randomUUID()), user: { id: alice, name: 'Alice', avatarSeed: alice },
        reactions: Array.from({ length: 400 }, (_, n) => ({ userId: `reactor-${n}`, emoji: '👍' })),
        poll: { options: ['One', 'Two'], votes: Array.from({ length: 400 }, (_, n) => ({ userId: `voter-${n}`, optionIndex: 0, revision: 1 })) } }
      return [item.id, { roomId: 'lounge', userId: alice, fingerprint: 'a'.repeat(64), message: item }]
    }))
    await writeFile(path.join(dir, 'soundspin-chat.json'), JSON.stringify({ messages: records, receipts: {}, cooldowns: {}, tombstones: {}, removals: [] }))
    const service = new ChatCommandService({ client: null, dataDir: dir, getUser: async () => null, authorize: async () => {}, emit: async () => {} })
    const page = await service.readPage('lounge', undefined, 'older', 200)
    assert.equal(page.rows.length, 10)
    assert.equal(page.hasMore, true)
    assert.ok(page.rows.every(row => row.soundspin_message_reactions.length <= CHAT_MAX_REACTIONS_PER_MESSAGE && row.soundspin_poll_votes.length <= CHAT_MAX_POLL_VOTERS))
    assert.equal(page.rows.reduce((sum, row) => sum + row.soundspin_message_reactions.length + row.soundspin_poll_votes.length, 0), CHAT_MAX_HISTORY_CHILDREN)
    const payload = await service.readPayload('lounge', page.rows)
    assert.ok(payload.rows.every(row => !Object.hasOwn(row, 'immutable_fingerprint')))
    const next = await service.readPage('lounge', page.cursor, 'older', 200)
    assert.ok(next.rows.every(row => !page.rows.some(previous => previous.id === row.id)))
    assert.ok(next.rows.every(row => row.created_at < page.cursor!.createdAt))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
