import assert from 'node:assert/strict'
import test from 'node:test'
import { createSocketChatSessionFactory, type SocketChatTransport } from '../../../src/features/chat/socket-transport'
import type { ChatMessage, ChatPollVoteEvent } from '../../../src/features/chat/model'

const message: ChatMessage = { id: '00000000-0000-4000-8000-000000000001', content: 'Hello room', type: 'text', user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: new Date().toISOString() }
function harness() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const sends: Array<{ event: string; payload: unknown }> = []
  let reply = { ok: true }
  let release: (() => void) | undefined
  const socket: SocketChatTransport = { connected: true,
    on(event, callback) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(callback) },
    off(event, callback) { handlers.get(event)?.delete(callback) },
    timeout() { return { emit(event, payload, callback) { sends.push({ event, payload }); release = () => callback(null, reply) } } },
  }
  const receive = (event: string, payload?: unknown) => handlers.get(event)?.forEach((callback) => callback(payload))
  const messages: ChatMessage[] = [], polls: ChatPollVoteEvent[] = [], connections: boolean[] = [], typing: string[][] = []
  const factory = createSocketChatSessionFactory(socket, 'lounge')
  const session = factory('alice', { onMessage: (item) => messages.push(item), onReaction: () => {}, onPollVote: (item) => polls.push(item), onTyping: (ids) => typing.push(ids), onConnection: (connected) => connections.push(connected) })
  return { socket, session, factory, sends, messages, polls, connections, typing, handlers, receive, acknowledge: () => release?.(), fail: () => { reply = { ok: false } } }
}

test('Rejoining a room keeps chat disabled until admission is confirmed', async () => {
  const h = harness(); await Promise.resolve()
  assert.deepEqual(h.connections, [false])
  h.receive('connect'); h.receive('room:snapshot', { room: { id: 'lounge' } })
  await assert.rejects(h.session.sendMessage(message), /reconnecting/)
  assert.equal(h.sends.length, 0)
  h.factory.setAdmitted(true)
  assert.deepEqual(h.connections, [false, true])
  const sent = h.session.sendMessage(message)
  assert.deepEqual(h.sends[0], { event: 'chat:message', payload: { roomId: 'lounge', message } })
  h.acknowledge(); await sent
  h.receive('disconnect'); h.receive('connect'); h.receive('room:snapshot', { room: { id: 'lounge' } })
  assert.deepEqual(h.connections, [false, true, false])
  assert.equal(h.messages.length, 1)
  h.factory.setAdmitted(true)
  assert.equal(h.messages.length, 1)
  assert.equal(h.handlers.get('chat:message')?.size, 1)
  h.session.dispose()
})

test('Messages from other rooms or a departed session stay out of the conversation', async () => {
  const h = harness(); h.factory.setAdmitted(true)
  h.receive('chat:message', { roomId: 'secret-room', message }); assert.equal(h.messages.length, 0)
  h.receive('chat:message', { roomId: 'lounge', message }); assert.equal(h.messages.length, 1)
  h.factory.setAdmitted(false)
  h.receive('chat:message', { roomId: 'lounge', message }); assert.equal(h.messages.length, 1)
  h.factory.setAdmitted(true)
  const pending = h.session.sendMessage(message)
  h.session.dispose(); h.acknowledge(); await pending
  assert.equal(h.messages.length, 1)
  assert.equal(h.handlers.get('chat:message')?.size, 0)
})
