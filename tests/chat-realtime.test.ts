import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createRealtimeChatSession } from '../src/chat/realtime.js'
import { normalizeRealtimeMessage } from '../src/chat/protocol.js'
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

test('Untrusted chat messages cannot claim administrator status or display unsafe media', () => {
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
})

test('Leaving a room stops its messages and activity from appearing', (context) => {
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
