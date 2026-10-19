import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatSaveTracker, type ChatSaveStates } from '../src/features/chat/delivery'
import type { ChatMessage } from '../src/features/chat/model'

const message: ChatMessage = { id: 'original-id', content: 'hello', type: 'text',
  user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: '2026-10-06T10:00:00Z' }

test('Retrying an unconfirmed message sends one original message and saves it once', async () => {
  let state: ChatSaveStates = {}
  const tracker = createChatSaveTracker((next) => { state = next })
  const delivered: ChatMessage[] = [], saved: ChatMessage[] = []
  let release!: () => void
  const deliver = async (item: ChatMessage) => { delivered.push(item); if (delivered.length === 1) throw new Error('Lost ACK'); await new Promise<void>((resolve) => { release = resolve }) }
  assert.equal(await tracker.send(message, deliver, (item) => { saved.push(item) }), false)
  assert.equal(state[message.id].state, 'send-failed'); assert.equal(saved.length, 0)
  const first = tracker.retrySend(message.id), second = tracker.retrySend(message.id)
  assert.equal(first, second)
  await Promise.resolve(); assert.equal(state[message.id].state, 'sending')
  release(); assert.equal(await first, true)
  assert.equal(saved[0], message); assert.deepEqual(delivered, [message, message]); assert.equal(state[message.id].state, 'saved')
  tracker.dispose()
})

test('Leaving a room during send still saves the message without changing the departed view', async () => {
  let changes = 0, saved = 0, release!: () => void
  const tracker = createChatSaveTracker(() => { changes++ })
  const pending = tracker.send(message, () => new Promise<void>((resolve) => { release = resolve }), (item) => { assert.equal(item, message); saved++ })
  await Promise.resolve(); tracker.dispose(); const before = changes
  release(); assert.equal(await pending, true); assert.equal(saved, 1); assert.equal(changes, before)
})
