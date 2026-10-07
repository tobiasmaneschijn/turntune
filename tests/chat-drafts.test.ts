import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_DRAFT_TTL_MS, clearUserChatDrafts, createChatDraftStore } from '../src/chat/drafts'

function storage() {
  const data = new Map<string, string>()
  return { data, get length() { return data.size }, key: (index: number) => [...data.keys()][index] || null,
    getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) } }
}

test('draft text, valid mentions and reply identity are isolated by account and room', () => {
  const saved = storage()
  const first = createChatDraftStore('alice', 'soundspin:one', saved)
  first.save({ text: 'Hi @mira\nnext line', mentions: [{ userId: 'mira', userName: 'Mira', handle: 'mira' },
    { userId: 'other', userName: 'Other', handle: 'other' }], replyToId: 'message-1' }, 1000)
  assert.equal(createChatDraftStore('bob', 'soundspin:one', saved).read(1001), null)
  assert.equal(createChatDraftStore('alice', 'soundspin:two', saved).read(1001), null)
  assert.deepEqual(first.read(1001), { text: 'Hi @mira\nnext line', mentions: [{ userId: 'mira', userName: 'Mira', handle: 'mira' }], replyToId: 'message-1' })
})

test('expired, malformed and oversized drafts are not restored', () => {
  const saved = storage()
  const draft = createChatDraftStore('expiry', 'room', saved)
  draft.save({ text: 'old', mentions: [] }, 1000)
  assert.equal(draft.read(1001 + CHAT_DRAFT_TTL_MS), null)
  draft.save({ text: 'new', mentions: [] }, 2000)
  const key = saved.key(0)!
  saved.setItem(key, JSON.stringify({ version: 1, updatedAt: 2000, text: 'x'.repeat(501) }))
  assert.equal(draft.read(2001), null)
  saved.setItem(key, '{broken')
  assert.equal(draft.read(2001), null)
})

test('sign out deletes all account rooms and invalidates pending flushes', () => {
  const saved = storage()
  const first = createChatDraftStore('departing', 'one', saved)
  const second = createChatDraftStore('departing', 'two', saved)
  const other = createChatDraftStore('remaining', 'one', saved)
  first.save({ text: 'first', mentions: [] })
  second.save({ text: 'second', mentions: [] })
  other.save({ text: 'keep', mentions: [] })
  clearUserChatDrafts('departing', saved)
  first.save({ text: 'late unmount flush', mentions: [] })
  assert.equal(createChatDraftStore('departing', 'one', saved).read(), null)
  assert.equal(saved.length, 1)
  assert.equal(other.read()?.text, 'keep')
  const signedInAgain = createChatDraftStore('departing', 'one', saved)
  signedInAgain.save({ text: 'fresh', mentions: [] })
  assert.equal(signedInAgain.read()?.text, 'fresh')
})

test('unavailable session storage never interrupts editing or cleanup', () => {
  const denied = { get length(): number { throw new Error('denied') }, key(): string | null { throw new Error('denied') },
    getItem(): string | null { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  const draft = createChatDraftStore('restricted', 'room', denied)
  assert.equal(draft.read(), null)
  assert.doesNotThrow(() => draft.save({ text: 'keep typing', mentions: [] }))
  assert.doesNotThrow(() => clearUserChatDrafts('restricted', denied))
})
