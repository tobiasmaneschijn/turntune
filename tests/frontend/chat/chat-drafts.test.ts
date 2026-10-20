import assert from 'node:assert/strict'
import test from 'node:test'
import { clearUserChatDrafts, createChatDraftStore } from '../../../src/features/chat/drafts'

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
  clearUserChatDrafts('departing', saved)
  first.save({ text: 'late unmount flush', mentions: [] })
  assert.equal(createChatDraftStore('departing', 'one', saved).read(), null)
  assert.equal(saved.length, 1)
  assert.equal(other.read()?.text, 'keep')
  const signedInAgain = createChatDraftStore('departing', 'one', saved)
  signedInAgain.save({ text: 'fresh', mentions: [] })
  assert.equal(signedInAgain.read()?.text, 'fresh')
})
