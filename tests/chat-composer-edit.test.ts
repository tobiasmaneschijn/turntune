import assert from 'node:assert/strict'
import test from 'node:test'
import { insertComposerText } from '../src/chat/composer-edit'

test('emoji insertion respects the caret, multiline selection and UTF-16 caret offset', () => {
  assert.deepEqual(insertComposerText('hello world', '😀', 5, 5, []), { text: 'hello😀 world', caret: 7, mentions: [] })
  assert.deepEqual(insertComposerText('one\ntwo\nthree', '🧑‍🎤', 4, 7, []), { text: 'one\n🧑‍🎤\nthree', caret: 9, mentions: [] })
})

test('replacing a mention removes its metadata and preserves remaining mentions', () => {
  const mira = { userId: 'm', userName: 'Mira', handle: 'Mira' }
  const sam = { userId: 's', userName: 'Sam', handle: 'Sam' }
  assert.deepEqual(insertComposerText('@Mira and @Sam', '❤️', 0, 5, [mira, sam])?.mentions, [sam])
})

test('length limit applies after replacement and never splits the inserted sequence', () => {
  assert.equal(insertComposerText('a'.repeat(500), '😀', 500, 500, []), null)
  assert.equal(insertComposerText('a'.repeat(500), '😀', 10, 12, [])?.text.length, 500)
})
