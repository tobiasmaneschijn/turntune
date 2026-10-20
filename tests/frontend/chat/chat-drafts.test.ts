import assert from 'node:assert/strict'
import test from 'node:test'
import { clearUserChatDrafts, createChatDraftStore } from '../../../src/features/chat/drafts'
import { createChatOutboxStore } from '../../../src/features/chat/outbox'

function storage() {
  const data = new Map<string, string>()
  return { data, get length() { return data.size }, key: (index: number) => [...data.keys()][index] || null,
    getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) } }
}

test('Signing out clears private drafts and prevents late saves from restoring them', () => {
  const saved = storage()
  const first = createChatDraftStore('departing', 'one', saved)
  const second = createChatDraftStore('departing', 'two', saved)
  const other = createChatDraftStore('remaining', 'one', saved)
  first.save({ text: 'first', mentions: [] })
  second.save({ text: 'second', mentions: [] })
  other.save({ text: 'keep', mentions: [] })
  const outbox = createChatOutboxStore('departing', 'one', saved)
  const otherOutbox = createChatOutboxStore('remaining', 'one', saved)
  const message = { id: '10000000-0000-4000-8000-000000000001', type: 'text' as const, content: 'pending', createdAt: new Date().toISOString(), user: { id: 'departing', name: 'Alice' } }
  outbox.accept(message)
  otherOutbox.accept({ ...message, user: { id: 'remaining', name: 'Bob' } })
  clearUserChatDrafts('departing', saved)
  first.save({ text: 'late unmount flush', mentions: [] })
  outbox.update(message.id, 'send-failed')
  assert.throws(() => outbox.accept(message))
  assert.equal(createChatOutboxStore('departing', 'one', saved).read().length, 0)
  assert.equal(createChatDraftStore('departing', 'one', saved).read(), null)
  assert.equal(saved.length, 2)
  assert.equal(other.read()?.text, 'keep')
  assert.equal(otherOutbox.read().length, 1)
  const signedInAgain = createChatDraftStore('departing', 'one', saved)
  signedInAgain.save({ text: 'fresh', mentions: [] })
  assert.equal(signedInAgain.read()?.text, 'fresh')
})
