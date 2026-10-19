import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatVisibilityState, createChatVisibilityStore } from '../src/features/chat/visibility'
import type { ChatMessage } from '../src/features/chat/model'

const message: ChatMessage = {
  id: 'private-message', content: 'Private details', type: 'text',
  user: { id: 'mira', name: 'Mira', avatarSeed: 'mira' }, createdAt: '2026-10-08T12:00:00Z',
}

function storage() {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) } }
}

test('Hiding a message still works when device storage is full', () => {
  const memory = storage()
  let writesBlocked = true
  const store = createChatVisibilityStore('alice', 'lounge', {
    ...memory,
    setItem(key, value) { if (writesBlocked) throw new Error('Quota exceeded'); memory.setItem(key, value) },
    removeItem(key) { if (writesBlocked) throw new Error('Blocked'); memory.removeItem(key) },
  })
  const visibility = createChatVisibilityState(store)
  assert.equal(visibility.setHidden(message.id, true).persisted, false)
  memory.setItem(store.key, JSON.stringify(['remote-message']))
  assert.deepEqual([...visibility.sync()], ['remote-message', message.id])
  memory.removeItem(store.key)
  assert.deepEqual([...visibility.sync()], [message.id])
  writesBlocked = false
  assert.equal(visibility.setHidden('second-message', true).persisted, true)
  assert.deepEqual([...store.read()], [message.id, 'second-message'])
  memory.removeItem(store.key)
  assert.equal(visibility.sync().size, 0)
})

test('A storage read failure preserves hidden messages and saved choices', () => {
  const memory = storage()
  let readsBlocked = false
  let writeCount = 0
  const store = createChatVisibilityStore('alice', 'lounge', {
    ...memory,
    getItem(key) { if (readsBlocked) throw new Error('Blocked'); return memory.getItem(key) },
    setItem(key, value) { writeCount++; memory.setItem(key, value) },
  })
  memory.setItem(store.key, JSON.stringify([message.id]))
  const visibility = createChatVisibilityState(store)
  readsBlocked = true
  assert.deepEqual([...visibility.sync()], [message.id])
  assert.equal(visibility.setHidden('local-message', true).persisted, false)
  assert.deepEqual([...visibility.sync()], [message.id, 'local-message'])
  assert.equal(writeCount, 0)
  memory.setItem(store.key, JSON.stringify(['remote-message']))
  readsBlocked = false
  assert.deepEqual([...visibility.sync()], ['remote-message', 'local-message'])
})
