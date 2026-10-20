import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatDeliveryQueue, type ChatSaveStates } from '../../../src/features/chat/delivery'
import { ChatOutboxError, createChatOutboxStore } from '../../../src/features/chat/outbox'
import type { ChatMessage } from '../../../src/features/chat/model'

const message: ChatMessage = { id: '10000000-0000-4000-8000-000000000001', content: 'hello', type: 'text',
  user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: '2026-10-06T10:00:00Z' }

function storage() {
  const data = new Map<string, string>()
  return { data, get length() { return data.size }, key: (index: number) => [...data.keys()][index] || null,
    getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) } }
}

test('Queue messages in order and recover an unconfirmed send after reload without duplicates', async () => {
  let state: ChatSaveStates = {}
  const savedStorage = storage()
  const store = createChatOutboxStore('alice', 'lounge', savedStorage)
  const delivered: ChatMessage[] = [], saved: ChatMessage[] = []
  let release!: () => void
  let failSave = false
  const options = {
    store, connected: () => true, confirmed: () => {},
    deliver: async (item: ChatMessage) => {
      delivered.push(item)
      if (delivered.length === 1) { await new Promise<void>(resolve => { release = resolve }); throw new Error('Lost ACK') }
    },
    persist: (item: ChatMessage) => { saved.push(item); if (failSave) throw new Error('Save unavailable') },
    onChange: (next: ChatSaveStates) => { state = next },
  }
  const queue = createChatDeliveryQueue(options)
  const nextMessage = { ...message, id: '10000000-0000-4000-8000-000000000002', content: 'next draft' }
  const firstSend = queue.accept(message), nextSend = queue.accept(nextMessage)
  assert.equal(store.read().length, 2)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(delivered.map(item => item.id), [message.id])
  assert.equal(state[nextMessage.id].state, 'queued')
  release()
  assert.equal(await firstSend, false)
  assert.equal(await nextSend, true)
  assert.deepEqual(delivered.map(item => item.id), [message.id, nextMessage.id])
  assert.deepEqual(store.read().map(record => record.message.id), [message.id])
  queue.dispose()

  const restored = createChatDeliveryQueue({ ...options, store: createChatOutboxStore('alice', 'lounge', savedStorage) })
  await Promise.resolve()
  assert.equal(delivered.length, 2, 'Reload must not rebroadcast uncertain messages automatically')
  assert.equal(state[message.id].state, 'send-failed')
  failSave = true
  const first = restored.retry(message.id), second = restored.retry(message.id)
  assert.equal(first, second)
  assert.equal(await first, true)
  assert.equal(state[message.id].state, 'failed')
  failSave = false
  assert.equal(await restored.retry(message.id, true), true)
  assert.deepEqual(delivered.map(item => item.id), [message.id, nextMessage.id, message.id])
  assert.deepEqual(saved.map(item => item.id), [nextMessage.id, message.id, message.id])
  assert.equal(store.read().length, 0)
  restored.dispose()
})

test('Leaving a room completes its active send and retains queued work without changing the departed view', async () => {
  let changes = 0, saved = 0, release!: () => void
  const savedStorage = storage()
  const store = createChatOutboxStore('alice', 'departed', savedStorage)
  const deliveries: string[] = []
  const queue = createChatDeliveryQueue({
    store, connected: () => true, confirmed: () => { throw new Error('Departed scope must not update cooldown') },
    deliver: item => { deliveries.push(item.id); return new Promise<void>(resolve => { release = resolve }) },
    persist: () => { saved++ }, onChange: () => { changes++ },
  })
  const pending = queue.accept(message)
  const queued = queue.accept({ ...message, id: '10000000-0000-4000-8000-000000000002' })
  await new Promise<void>(resolve => setImmediate(resolve))
  queue.dispose(); const before = changes
  let returnedRows: ChatMessage[] = []
  const replacement = createChatDeliveryQueue({
    store: createChatOutboxStore('alice', 'departed', savedStorage), connected: () => true,
    deliver: async item => { deliveries.push(item.id) }, confirmed: () => {},
    onChange: (_states, messages) => { returnedRows = messages },
  })
  assert.equal(returnedRows.length, 2, 'Returning before the old ACK must recover both rows')
  release()
  assert.equal(await pending, false)
  assert.equal(await queued, false)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(saved, 1); assert.equal(changes, before)
  assert.deepEqual(deliveries, [message.id])
  assert.deepEqual(returnedRows.map(row => row.id), [message.id, '10000000-0000-4000-8000-000000000002'])
  assert.equal(store.read().length, 2, 'A disposed transport cannot remove a row the replacement view has not reconciled')
  replacement.dispose()
})

test('A queued message honors a new slow-mode cooldown and revoked participation before delivery', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() })
  const store = createChatOutboxStore('alice', 'policy-change', storage())
  let connected = true, slowModeSeconds = 0, release!: () => void
  const delivered: string[] = []
  const queue = createChatDeliveryQueue({
    store, connected: () => connected, slowModeSeconds: () => slowModeSeconds,
    deliver: item => { delivered.push(item.id); return new Promise<void>(resolve => { release = resolve }) },
    confirmed: () => {}, onChange: () => {},
  })
  t.after(() => queue.dispose())
  const first = queue.accept(message)
  const nextMessage = { ...message, id: '10000000-0000-4000-8000-000000000002' }
  const second = queue.accept(nextMessage)
  await new Promise<void>(resolve => setImmediate(resolve))
  slowModeSeconds = 2
  release()
  assert.equal(await first, true)
  t.mock.timers.tick(1_999)
  assert.deepEqual(delivered, [message.id])
  connected = false
  t.mock.timers.tick(1)
  assert.equal(await second, false)
  assert.deepEqual(delivered, [message.id])
  assert.equal(store.read()[0].message.id, nextMessage.id)
  assert.equal(store.read()[0].state, 'send-failed')
})

test('Refuse recovery storage failures and unsafe records before accepting a cleared draft', () => {
  const blocked = storage()
  blocked.setItem = () => { throw new Error('Quota exceeded') }
  assert.throws(() => createChatOutboxStore('alice', 'lounge', blocked).accept(message), (error: unknown) => error instanceof ChatOutboxError && error.reason === 'unavailable')
  const saved = storage()
  const store = createChatOutboxStore('alice', 'lounge', saved)
  assert.throws(() => store.accept({ ...message, user: { id: 'bob', name: 'Bob' } }), ChatOutboxError)
  assert.throws(() => store.accept({ ...message, type: 'image', mediaUrl: 'javascript:alert(1)' }), ChatOutboxError)
  assert.throws(() => store.accept({ ...message, type: 'image', mediaUrl: 'https://media.test/image.png', storagePath: 'bob/lounge/image.png' }), ChatOutboxError)
  const original = { ...message, poll: { options: ['One', 'Two'], votes: [] } }
  store.accept(original)
  original.poll.options[0] = 'Changed after handoff'
  assert.deepEqual(store.read()[0].message.poll?.options, ['One', 'Two'])
  const getItem = saved.getItem
  saved.getItem = () => { throw new Error('Storage temporarily blocked') }
  assert.equal(store.read()[0].message.id, message.id, 'An accepted recovery row must not disappear during a later storage read failure')
  assert.throws(() => store.accept({ ...message, id: '10000000-0000-4000-8000-000000000002' }), ChatOutboxError)
  saved.getItem = getItem
  assert.equal(createChatOutboxStore('bob', 'lounge', saved).read().length, 0)
  assert.equal(createChatOutboxStore('alice', 'other-room', saved).read().length, 0)
  const key = [...saved.data.keys()][0]
  const record = JSON.parse(saved.data.get(key)!)
  record.records[0].message.mediaUrl = 'data:text/html,unsafe'
  record.records[0].message.type = 'gif'
  saved.data.set(key, JSON.stringify(record))
  assert.equal(store.read().length, 0)
})
