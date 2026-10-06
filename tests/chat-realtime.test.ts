import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createRealtimeChatSession, CHAT_TYPING_TTL_MS } from '../src/chat/realtime.js'
import { normalizeRealtimeMessage, normalizeRealtimeReaction } from '../src/chat/protocol.js'
import type { ChatMessage, ChatReactionEvent } from '../src/chat/model.js'

const message: ChatMessage = {
  id: 'message-1', content: 'Hello', type: 'text',
  user: { id: 'listener-1', name: 'Taylor', avatarSeed: 'listener-1' },
  createdAt: '2026-10-06T10:00:00.000Z',
}

function setup(context: TestContext) {
  const handlers = new Map<string, (event: { payload: unknown }) => void>()
  let subscriber: (status: string) => void = () => {}
  let sendResult: () => Promise<string> = async () => 'ok'
  const messages: ChatMessage[] = []
  const reactions: ChatReactionEvent[] = []
  const typing: string[][] = []
  const connections: boolean[] = []
  const sent: unknown[] = []
  let configuration: unknown
  let removed = 0
  const channel = {
    on(_type: string, filter: { event: string }, callback: (event: { payload: unknown }) => void) {
      handlers.set(filter.event, callback)
      return this
    },
    subscribe(callback: (status: string) => void) { subscriber = callback; return this },
    async send(payload: unknown) { sent.push(payload); return sendResult() },
  }
  const client = {
    channel(_name: string, config: unknown) { configuration = config; return channel },
    async removeChannel() { removed += 1; return 'ok' },
  } as unknown as SupabaseClient
  const session = createRealtimeChatSession(client, 'soundspin:lounge', message.user.id, {
    onMessage: (received) => messages.push(received),
    onReaction: (received) => reactions.push(received),
    onTyping: (received) => typing.push(received),
    onConnection: (connected) => connections.push(connected),
  })
  context.after(() => session.dispose())
  return {
    session, messages, reactions, typing, connections, sent,
    configuration: () => configuration, removed: () => removed,
    status: (status: string) => subscriber(status),
    emit: (event: string, payload: unknown) => handlers.get(event)?.({ payload }),
    result: (result: () => Promise<string>) => { sendResult = result },
  }
}

test('malformed peer messages cannot reach the chat timeline', () => {
  for (const value of [null, [], {}, { ...message, user: null }, { ...message, content: {} },
    { ...message, type: 'video' }, { ...message, content: 'x'.repeat(501) },
    { ...message, createdAt: 'invalid' }, { ...message, content: '   ' }]) {
    assert.equal(normalizeRealtimeMessage(value), null)
  }
})

test('peer content strips unsafe media, malformed replies and untrusted admin claims', () => {
  const normalized = normalizeRealtimeMessage({
    ...message, mediaUrl: 'javascript:alert(1)',
    user: { ...message.user, isAppAdmin: true, avatarSeed: null, avatarUrl: 'data:image/svg+xml,bad' },
    replyTo: { id: 'broken', user: null },
    reactions: [{ emoji: 'fake', userId: 'admin' }],
    mentions: [{ userId: 'invalid' }],
  })
  assert.ok(normalized)
  assert.equal(normalized.user.isAppAdmin, false)
  assert.equal(normalized.user.avatarSeed, message.user.id)
  assert.equal(normalized.user.avatarUrl, undefined)
  assert.equal(normalized.mediaUrl, undefined)
  assert.equal(normalized.replyTo, undefined)
  assert.deepEqual(normalized.reactions, [])
  assert.deepEqual(normalized.mentions, [])
  assert.equal(normalizeRealtimeMessage({ ...message, type: 'image', mediaUrl: 'javascript:alert(1)' }), null)
  assert.equal(normalizeRealtimeMessage({ ...message, type: 'image', mediaUrl: 'https://example.com/photo.png' })?.mediaUrl, 'https://example.com/photo.png')
})

test('malformed reaction actions cannot silently remove a valid reaction', () => {
  const event = { id: 'reaction-1', messageId: message.id, userId: 'other', emoji: '❤️', action: 'add' }
  assert.equal(normalizeRealtimeReaction({ ...event, action: 'anything' }), null)
  assert.equal(normalizeRealtimeReaction({ ...event, userId: null }), null)
  assert.deepEqual(normalizeRealtimeReaction(event), event)
})

test('sending requires an active subscribed room and a server acknowledgement', async (context) => {
  const room = setup(context)
  await assert.rejects(room.session.sendMessage(message), /reconnecting/)
  assert.equal(room.sent.length, 0)
  room.status('SUBSCRIBED')
  assert.deepEqual(room.configuration(), { config: { broadcast: { ack: true } } })
  room.result(async () => 'timed out')
  await assert.rejects(room.session.sendMessage(message), /confirm delivery/)
  assert.equal(room.messages.length, 0)
  room.result(async () => 'error')
  await assert.rejects(room.session.sendMessage(message), /confirm delivery/)
  room.result(async () => 'ok')
  await room.session.sendMessage(message)
  assert.deepEqual(room.messages, [message])
})

test('leaving a room ignores late broadcasts and connection callbacks', (context) => {
  const room = setup(context)
  room.status('SUBSCRIBED')
  room.session.dispose()
  room.status('SUBSCRIBED')
  room.emit('message', message)
  room.emit('reaction', { id: 'reaction-1', messageId: message.id, userId: 'other', emoji: '❤️', action: 'add' })
  room.emit('typing', { userId: 'other', active: true, sentAt: Date.now() })
  assert.deepEqual(room.messages, [])
  assert.deepEqual(room.reactions, [])
  assert.deepEqual(room.typing, [])
  assert.deepEqual(room.connections, [true])
  room.session.dispose()
  assert.equal(room.removed(), 1)
})

test('a send completed after leaving can be persisted without updating the old timeline', async (context) => {
  const room = setup(context)
  room.status('SUBSCRIBED')
  let acknowledge!: (result: string) => void
  room.result(() => new Promise((resolve) => { acknowledge = resolve }))
  const pending = room.session.sendMessage(message)
  room.session.dispose()
  acknowledge('ok')
  await pending
  assert.deepEqual(room.messages, [])
})

test('typing expires, rejects out-of-order events and clears on disconnect', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(message.createdAt) })
  const room = setup(context)
  room.status('SUBSCRIBED')
  const now = Date.now()
  room.emit('typing', { userId: 'other', active: true, sentAt: now })
  assert.deepEqual(room.typing.at(-1), ['other'])
  context.mock.timers.tick(1_000)
  room.emit('typing', { userId: 'other', active: false, sentAt: Date.now() })
  room.emit('typing', { userId: 'other', active: true, sentAt: now })
  assert.deepEqual(room.typing.at(-1), [])
  room.emit('typing', { userId: 'other', active: true, sentAt: Date.now() })
  context.mock.timers.tick(CHAT_TYPING_TTL_MS)
  assert.deepEqual(room.typing.at(-1), [])
  room.emit('typing', { userId: 'other', active: true, sentAt: Date.now() })
  room.status('CHANNEL_ERROR')
  assert.deepEqual(room.typing.at(-1), [])
  assert.deepEqual(room.connections, [true, false])
})

test('saved reactions retain local state when their live notification fails', async (context) => {
  const room = setup(context)
  room.status('SUBSCRIBED')
  const reaction: ChatReactionEvent = { id: 'reaction-1', messageId: message.id, userId: 'other', emoji: '❤️', action: 'add' }
  room.result(async () => 'error')
  await assert.rejects(room.session.sendReaction(reaction), /confirm delivery/)
  assert.deepEqual(room.reactions, [reaction])
  room.result(async () => { throw new Error('network failed') })
  await room.session.sendTyping(true)
})
