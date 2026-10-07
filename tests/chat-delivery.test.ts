import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatSaveTracker, type ChatSaveStates } from '../src/chat/delivery'
import type { ChatMessage } from '../src/chat/model'

const message: ChatMessage = { id: 'original-id', content: 'hello', type: 'text',
  user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: '2026-10-06T10:00:00Z' }

test('retry saves the original message only and exposes failure then confirmation', async () => {
  let state: ChatSaveStates = {}
  const tracker = createChatSaveTracker((next) => { state = next })
  const saved: ChatMessage[] = []
  const persist = async (item: ChatMessage) => { saved.push(item); if (saved.length === 1) throw new Error('offline') }
  await tracker.save(message, persist)
  assert.equal(state[message.id].state, 'failed')
  await tracker.retry(message.id)
  assert.equal(state[message.id].state, 'saved')
  assert.equal(saved.length, 2)
  assert.equal(saved[0], message)
  assert.equal(saved[1], message)
})

test('repeated retry while pending shares one persistence operation', async () => {
  const tracker = createChatSaveTracker(() => {})
  let attempts = 0
  let release!: () => void
  const first = tracker.save(message, () => { attempts++; return new Promise<void>((resolve) => { release = resolve }) })
  const second = tracker.retry(message.id)
  await Promise.resolve()
  assert.equal(attempts, 1)
  assert.equal(first, second)
  release()
  await first
})

test('navigation suppresses old row updates while preserving original acknowledged history work', async () => {
  let changes = 0
  let saved = 0
  const tracker = createChatSaveTracker(() => { changes++ })
  tracker.dispose()
  await tracker.save(message, () => { saved++ })
  assert.equal(saved, 1)
  assert.equal(changes, 0)
  await tracker.retry(message.id)
  assert.equal(saved, 1)
})

test('uncertain send retries reuse original identity, share a pending ACK and only save after confirmation', async () => {
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

test('late acknowledged send saves only its original callback while a disposed room publishes no continuation', async () => {
  let changes = 0, saved = 0, release!: () => void
  const tracker = createChatSaveTracker(() => { changes++ })
  const pending = tracker.send(message, () => new Promise<void>((resolve) => { release = resolve }), (item) => { assert.equal(item, message); saved++ })
  await Promise.resolve(); tracker.dispose(); const before = changes
  release(); assert.equal(await pending, true); assert.equal(saved, 1); assert.equal(changes, before)
})
