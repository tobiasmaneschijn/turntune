import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatRelay } from './chat-relay.js'
import { canonicalMessage, chatMessageSchema } from './chat-validation.js'

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const user = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
const input = () => ({ id: id(1), content: 'Hello room', type: 'text', createdAt: new Date().toISOString(), user: { id: 'forged', name: 'Moderator', isAppAdmin: true } })
function harness() {
  const state = { admitted: true, allowed: true, lookup: 0, emits: [] as Array<{ room: string; event: string; payload: any }>, hold: false, release: () => {} }
  const relay = createChatRelay({
    loadMessageById: async () => null,
    getMembership: () => state.admitted ? { room: { id: 'lounge' }, user } : null,
    canWriteRoom: async () => state.allowed,
    loadReply: async (_room, target) => { state.lookup++; return target === id(99) ? { id: target, content: 'Authoritative reply', type: 'text', user: { id: 'mira', name: 'Mira' } } : null },
    emitToRoom: async (room, event, payload) => { state.emits.push({ room, event, payload }); if (state.hold) await new Promise<void>((resolve) => { state.release = resolve }) },
  })
  return { state, relay }
}
test('relay rejects unadmitted, guessed-room and freshly revoked sends before any lookup or delivery', async () => {
  const { state, relay } = harness()
  const payload = { roomId: 'lounge', message: input() }
  state.admitted = false; assert.equal((await relay.handle('socket', 'message', payload)).ok, false)
  state.admitted = true; assert.equal((await relay.handle('socket', 'message', { ...payload, roomId: 'secret-room' })).ok, false)
  state.allowed = false; assert.equal((await relay.handle('socket', 'message', payload)).ok, false)
  assert.equal(state.lookup, 0); assert.equal(state.emits.length, 0)
})
test('relay stamps trusted sender, validates same-room replies and rejects immutable UUID conflicts', async () => {
  const { state, relay } = harness()
  const message = { ...input(), replyTo: { id: id(99), content: 'Spoofed reply', user: { id: 'fake' } } }
  const payload = { roomId: 'lounge', message }
  assert.deepEqual(await relay.handle('socket', 'message', payload), { ok: true })
  assert.deepEqual(state.emits[0].payload.message.user, user)
  assert.equal(state.emits[0].payload.message.replyTo.content, 'Authoritative reply')
  assert.deepEqual(await relay.handle('socket', 'message', payload), { ok: true }); assert.equal(state.emits.length, 1)
  assert.equal((await relay.handle('socket', 'message', { roomId: 'lounge', message: { ...message, content: 'Changed same UUID' } })).ok, false)
  assert.equal((await relay.handle('socket', 'message', { roomId: 'lounge', message: { ...message, id: id(2), replyTo: { id: id(98) } } })).ok, false)
  assert.equal(state.emits.length, 1)
})
test('concurrent uncertain acknowledgements share one awaited broadcast and fresh authorization still gates retries', async () => {
  const { state, relay } = harness(); state.hold = true
  const payload = { roomId: 'lounge', message: input() }
  const first = relay.handle('socket', 'message', payload), second = relay.handle('socket', 'message', payload)
  while (!state.emits.length) await Promise.resolve()
  assert.equal(state.emits.length, 1)
  state.release(); assert.deepEqual(await first, { ok: true }); assert.deepEqual(await second, { ok: true })
  state.allowed = false; assert.equal((await relay.handle('socket', 'message', payload)).ok, false)
  assert.equal(state.emits.length, 1)
})
test('reaction and typing envelopes are bounded, room scoped and use authenticated identities and clocks', async () => {
  const { state, relay } = harness()
  const reaction = { id: id(3), messageId: id(99), emoji: '❤️', action: 'add', userId: 'forged' }
  assert.equal((await relay.handle('socket', 'reaction', { roomId: 'lounge', reaction })).ok, true)
  assert.equal(state.emits[0].payload.reaction.userId, 'alice')
  assert.equal((await relay.handle('socket', 'reaction', { roomId: 'lounge', reaction })).ok, true)
  assert.equal(state.emits.length, 1)
  assert.equal((await relay.handle('socket', 'typing', { roomId: 'lounge', typing: { userId: 'forged', active: true, sentAt: 0 } })).ok, true)
  assert.equal(state.emits[1].payload.typing.userId, 'alice'); assert.ok(state.emits[1].payload.typing.sentAt > 0)
  assert.equal((await relay.handle('socket', 'message', { roomId: 'lounge', message: { ...input(), content: 'x'.repeat(501) } })).ok, false)
  assert.equal((await relay.handle('socket', 'message', { roomId: 'lounge', message: { ...input(), type: 'image', mediaUrl: 'javascript:alert(1)' } })).ok, false)
})

test('a sender who departs during reply/media awaits cannot publish, and final delivery receives the exact origin socket', async () => {
  let admitted = true, emitted = 0, origin: unknown
  const relay = createChatRelay({ getMembership: () => admitted ? { room: { id: 'lounge' }, user } : null,
    loadMessageById: async () => null,
    canWriteRoom: async () => admitted,
    loadReply: async () => { admitted = false; return { id: id(99), content: 'Reply', type: 'text', user } },
    emitToRoom: async (_room, _event, _payload, source) => { emitted++; origin = source },
  })
  assert.equal((await relay.handle('original-socket', 'message', { roomId: 'lounge', message: { ...input(), replyTo: { id: id(99) } } })).ok, false)
  assert.equal(emitted, 0)
  admitted = true
  assert.equal((await relay.handle('original-socket', 'message', { roomId: 'lounge', message: { ...input(), id: id(2) } })).ok, true)
  assert.deepEqual(origin, { socketId: 'original-socket', userId: 'alice' })
})

test('a fresh relay rejects persisted UUID collisions and confirms identical stored originals without live rebroadcast', async () => {
  const message = input()
  let stored = { roomId: 'lounge', userId: 'alice', message: { ...message, type: 'text' as const, mentions: [] } }
  let emitted = 0
  const options = { getMembership: () => ({ room: { id: 'lounge' }, user }), canWriteRoom: async () => true,
    loadReply: async () => null, loadMessageById: async () => stored, emitToRoom: async () => { emitted++ } }
  for (const conflict of [{ ...stored, roomId: 'secret-room' }, { ...stored, userId: 'mira' }, { ...stored, message: { ...stored.message, content: 'Changed persisted body' } }]) {
    stored = conflict
    const freshRelay = createChatRelay(options)
    assert.equal((await freshRelay.handle('socket', 'message', { roomId: 'lounge', message })).ok, false)
  }
  stored = { roomId: 'lounge', userId: 'alice', message: { ...message, type: 'text', mentions: [] } }
  const restartedRelay = createChatRelay(options)
  assert.deepEqual(await restartedRelay.handle('socket', 'message', { roomId: 'lounge', message }), { ok: true })
  assert.deepEqual(await restartedRelay.handle('socket', 'message', { roomId: 'lounge', message }), { ok: true })
  assert.equal(emitted, 0)
})

test('durable UUID lookup errors fail closed and remain retryable without emitting live content', async () => {
  let failing = true, emitted = 0
  const relay = createChatRelay({ getMembership: () => ({ room: { id: 'lounge' }, user }), canWriteRoom: async () => true,
    loadReply: async () => null, loadMessageById: async () => { if (failing) throw new Error('Database unavailable'); return null }, emitToRoom: async () => { emitted++ } })
  const payload = { roomId: 'lounge', message: input() }
  assert.equal((await relay.handle('socket', 'message', payload)).ok, false); assert.equal(emitted, 0)
  failing = false
  assert.equal((await relay.handle('socket', 'message', payload)).ok, true); assert.equal(emitted, 1)
})

test('a fresh relay accepts original retries after canonical text-media and duplicate-mention persistence without rebroadcast', async () => {
  const original = chatMessageSchema.parse({ ...input(), mediaUrl: 'https://example.test/irrelevant.png', storagePath: 'alice/lounge/unused.png',
    mentions: [{ userId: 'mira', userName: 'Old name', handle: 'old' }, { userId: 'sam', userName: 'Sam', handle: 'sam' },
      { userId: 'mira', userName: 'Mira', handle: 'mira' }] })
  const stored = { roomId: 'lounge', userId: 'alice', message: canonicalMessage(original, user) }
  assert.equal(stored.message.mediaUrl, undefined); assert.equal(stored.message.storagePath, undefined)
  assert.deepEqual(stored.message.mentions.map((mention) => mention.userName), ['Mira', 'Sam'])
  let emitted = 0
  const options = { getMembership: () => ({ room: { id: 'lounge' }, user }), canWriteRoom: async () => true,
    loadReply: async () => null, loadMessageById: async () => stored, emitToRoom: async () => { emitted++ } }
  for (const retry of [original, { ...original, mediaUrl: undefined, storagePath: undefined, mentions: stored.message.mentions }]) {
    const restartedRelay = createChatRelay(options)
    assert.deepEqual(await restartedRelay.handle('socket', 'message', { roomId: 'lounge', message: retry }), { ok: true })
  }
  for (const conflict of [{ ...original, content: 'Changed body' },
    { ...original, mentions: [...original.mentions, { userId: 'mira', userName: 'Changed final name', handle: 'mira' }] }]) {
    assert.equal((await createChatRelay(options).handle('socket', 'message', { roomId: 'lounge', message: conflict })).ok, false)
  }
  assert.equal(emitted, 0)
})
