import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatVisibilityState, createChatVisibilityStore, getVisibleMessagePreview } from '../src/chat/visibility'
import type { ChatMessage } from '../src/chat/model'

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

test('hiding stores only IDs, survives recreation, and keeps accounts and rooms isolated', () => {
  const memory = storage()
  const store = createChatVisibilityStore('alice', 'lounge', memory)
  assert.equal(store.save(new Set([message.id])), true)
  assert.deepEqual([...createChatVisibilityStore('alice', 'lounge', memory).read()], [message.id])
  assert.equal(createChatVisibilityStore('bob', 'lounge', memory).read().size, 0)
  assert.equal(createChatVisibilityStore('alice', 'other', memory).read().size, 0)
  assert.deepEqual(JSON.parse(memory.getItem(store.key)!), [message.id])
  assert.equal(store.save(new Set()), true)
  assert.equal(memory.data.size, 0)
})

test('scope delimiters cannot collide for account or room names', () => {
  const memory = storage()
  const first = createChatVisibilityStore('user:room', 'name', memory)
  const second = createChatVisibilityStore('user', 'room:name', memory)
  first.save(new Set([message.id]))
  assert.notEqual(first.key, second.key)
  assert.equal(second.read().size, 0)
})

test('broken or blocked device storage does not interrupt chat', () => {
  const memory = storage()
  const store = createChatVisibilityStore('alice', 'lounge', memory)
  memory.setItem(store.key, '{broken')
  assert.equal(store.read().size, 0)
  assert.equal(store.readSnapshot().available, false)
  memory.setItem(store.key, JSON.stringify([null, 12, '', message.id, 'x'.repeat(101)]))
  assert.deepEqual([...store.read()], [message.id])
  assert.equal(store.readSnapshot().available, true)
  const blocked = createChatVisibilityStore('alice', 'lounge', {
    getItem() { throw new Error('Blocked') }, setItem() { throw new Error('Blocked') }, removeItem() { throw new Error('Blocked') },
  })
  assert.equal(blocked.read().size, 0)
  assert.equal(blocked.readSnapshot().available, false)
  assert.equal(blocked.save(new Set([message.id])), false)
  assert.equal(blocked.save(new Set()), false)
})

test('a successful current snapshot keeps a remote unhide from being resurrected by a new hide', () => {
  const memory = storage()
  const store = createChatVisibilityStore('alice', 'lounge', memory)
  store.save(new Set(['old-message']))
  const visibility = createChatVisibilityState(store)
  // A different tab unhides the old message before this tab receives its storage event.
  memory.removeItem(store.key)
  assert.equal(visibility.setHidden('new-message', true).persisted, true)
  assert.deepEqual([...visibility.ids], ['new-message'])
  assert.deepEqual([...store.read()], ['new-message'])
})

test('unsaved hides survive storage synchronization and clear their override after a successful save', () => {
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

test('unsaved unhides stay visible during synchronization and subsequent failed writes', () => {
  const memory = storage()
  const store = createChatVisibilityStore('alice', 'lounge', {
    ...memory,
    setItem() { throw new Error('Quota exceeded') },
    removeItem() { throw new Error('Blocked') },
  })
  memory.setItem(store.key, JSON.stringify([message.id, 'other-message']))
  const visibility = createChatVisibilityState(store)
  assert.equal(visibility.setHidden(message.id, false).persisted, false)
  memory.setItem(store.key, JSON.stringify([message.id, 'remote-message']))
  assert.deepEqual([...visibility.sync()], ['remote-message'])
  assert.equal(visibility.setHidden('new-message', true).persisted, false)
  assert.deepEqual([...visibility.ids], ['remote-message', 'new-message'])
})

test('failed reads preserve current hiding without overwriting an unknown persisted snapshot', () => {
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

test('hidden previews do not disclose text or media captions and preserve original payloads', () => {
  const hidden = new Set([message.id])
  assert.equal(getVisibleMessagePreview(message, hidden), 'Hidden')
  assert.equal(getVisibleMessagePreview({ ...message, type: 'image', mediaUrl: 'https://example.com/private.png' }, hidden), 'Hidden')
  assert.equal(getVisibleMessagePreview({ ...message, type: 'gif' }, hidden), 'Hidden')
  assert.equal(getVisibleMessagePreview(message, new Set()), 'Private details')
  assert.equal(message.content, 'Private details')
})
