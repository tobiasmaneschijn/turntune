import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createRealtimeChatSession } from '../../../src/features/chat/realtime.js'
import { createSocketChatSessionFactory, type SocketChatTransport } from '../../../src/features/chat/socket-transport.js'
import { normalizeRealtimeMessage } from '../../../src/features/chat/protocol.js'
import type { ChatMessage, ChatReactionEvent } from '../../../src/features/chat/model.js'
import { parseChatGameCommand } from '../../../src/features/chat/chat-games.js'
import { chatCommandSuggestions, parseChatCommand } from '../../../src/features/chat/commands.js'

const message: ChatMessage = {
  id: 'message-1', content: 'Hello', type: 'text',
  user: { id: 'listener-1', name: 'Taylor', avatarSeed: 'listener-1' },
  createdAt: '2026-10-06T10:00:00.000Z',
}

test('game commands preserve choices but only accepted server messages expose results', () => {
  assert.deepEqual(parseChatGameCommand('/roll'), { kind: 'roll', dice: 1, sides: 6, result: undefined })
  assert.deepEqual(parseChatGameCommand('/pick deep house, ambient'), { kind: 'pick', options: ['deep house','ambient'], result: undefined })
  assert.deepEqual(parseChatGameCommand('/flip'), { kind: 'flip' })
  assert.deepEqual(parseChatGameCommand('/RPS PAPER'), { kind: 'rps', choice: 'paper', result: undefined })
  assert.deepEqual(parseChatGameCommand('/8ball Will the next track be house?'), { kind: 'eightball', question: 'Will the next track be house?', result: undefined })
  assert.deepEqual(chatCommandSuggestions('/8'), ['8ball'])
  assert.deepEqual(parseChatCommand('/8ball Is this a good idea?'), { name: '8ball', arguments: 'Is this a good idea?' })
  assert.throws(() => parseChatGameCommand('/roll 99d999'))
  assert.throws(() => parseChatGameCommand('/pick house, HOUSE'))
  assert.throws(() => parseChatGameCommand('/flip heads'))
  assert.throws(() => parseChatGameCommand('/rps lizard'))
  assert.throws(() => parseChatGameCommand('/8ball'))
  assert.throws(() => parseChatGameCommand(`/8ball ${'a'.repeat(201)}`))
  const payload = { ...message, content: '/roll 1d6', game: { kind: 'roll', dice: 1, sides: 6, result: [6] } }
  assert.deepEqual(normalizeRealtimeMessage(payload)?.game, { kind: 'roll', dice: 1, sides: 6 })
  assert.deepEqual(normalizeRealtimeMessage(payload, { trustedGameResults: true })?.game, payload.game)
  const rps = { ...message, content: '/rps rock', game: { kind: 'rps', choice: 'rock', result: 'scissors' } }
  assert.deepEqual(normalizeRealtimeMessage(rps)?.game, { kind: 'rps', choice: 'rock' })
  assert.deepEqual(normalizeRealtimeMessage(rps, { trustedGameResults: true })?.game, rps.game)
  const trivia = { ...message, content: '/trivia', game: { kind: 'trivia', round: {
    questionId: 'piano-keys', question: 'How many keys does a standard full-size piano have?', options: ['88', '76', '61', '96'], endsAt: '2026-10-20T18:00:30Z',
  } } }
  assert.deepEqual(normalizeRealtimeMessage(trivia)?.game, { kind: 'trivia' })
  assert.deepEqual(normalizeRealtimeMessage(trivia, { trustedGameResults: true })?.game, trivia.game)
})

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

test('Retrying a removed song message confirms delivery without restoring removed content', async (context) => {
  const original: ChatMessage = {
    ...message,
    content: '',
    song: { id: 'public-song', provider: 'youtube', providerId: 'song', title: 'Room song' },
  }
  const removedAt = '2026-10-06T10:01:00.000Z'
  const tombstone = { ...message, content: '', removedAt }
  const attempts: unknown[] = []
  const received: ChatMessage[] = []
  const socket: SocketChatTransport = {
    connected: true,
    on() {},
    off() {},
    timeout() {
      return { emit(_event, payload, reply) {
        attempts.push(payload)
        if (attempts.length === 1) reply(new Error('Acknowledgement lost'))
        else reply(null, { ok: true, message: tombstone })
      } }
    },
  }
  const session = createSocketChatSessionFactory(socket, 'lounge', true)(original.user.id, {
    onMessage: accepted => received.push(accepted),
    onReaction() {}, onTyping() {}, onConnection() {},
  })
  context.after(() => session.dispose())

  await assert.rejects(session.sendMessage(original))
  assert.equal(received.length, 0)
  const accepted = await session.sendMessage(original)
  assert.ok(accepted)
  assert.deepEqual(attempts, [1, 2].map(() => ({ roomId: 'lounge', message: original })))
  assert.equal(accepted.removedAt, removedAt)
  assert.equal(accepted.content, '')
  assert.equal(accepted.song, undefined)
  assert.deepEqual(received, [accepted])

  const removedPayload = {
    ...tombstone, content: 'removed-secret', type: 'gif', mediaUrl: 'https://example.com/removed-secret.gif',
    storagePath: 'removed-secret', song: { ...original.song, title: 'removed-secret' },
    game: { kind: 'pick', options: ['removed-secret', 'other'], result: 'removed-secret' },
    poll: { options: ['removed-secret', 'other'] },
    mentions: [{ userId: 'removed-secret', userName: 'Removed', handle: '@removed' }],
    replyTo: { ...message, content: 'removed-secret' },
  }
  // Both untrusted broadcasts and canonical ACKs discard all removed payloads.
  assert.deepEqual(normalizeRealtimeMessage(removedPayload), accepted)
  assert.deepEqual(normalizeRealtimeMessage(removedPayload, { trustedGameResults: true }), accepted)
  assert.equal(JSON.stringify(accepted).includes('removed-secret'), false)
  assert.equal(normalizeRealtimeMessage({ ...tombstone, removedAt: 'invalid' }), null)

  const reply = normalizeRealtimeMessage({ ...message, replyTo: removedPayload })?.replyTo
  assert.equal(reply?.removedAt, removedAt)
  assert.equal(reply?.content, '')
  assert.equal(reply?.type, 'text')
  assert.equal(reply?.mediaUrl, undefined)
  assert.deepEqual(reply?.mentions, [])
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
