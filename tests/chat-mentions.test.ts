import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activeMentions,
  buildRoomMentionOptions,
  findMentionQuery,
  insertMention,
  normalizeChatMentions,
  splitMentionText,
} from '../src/chat/mentions'

test('builds readable handles and disambiguates duplicate names', () => {
  const options = buildRoomMentionOptions([
    { id: 'me', name: 'Me', avatarSeed: 'me' },
    { id: 'a111-2222', name: 'Taylor From', avatarSeed: 'a' },
    { id: 'b222-3333', name: 'Taylor From', avatarSeed: 'b' },
  ], 'me')
  assert.deepEqual(options.map((option) => option.mention.handle), ['Taylor_From_a111', 'Taylor_From_b222'])
})

test('finds and inserts a mention at the current caret', () => {
  const query = findMentionQuery('hello @tay friend', 10)
  assert.deepEqual(query, { start: 6, end: 10, query: 'tay' })
  const inserted = insertMention('hello @tay friend', query!, {
    userId: 'a', userName: 'Taylor', handle: 'Taylor',
  })
  assert.equal(inserted.text, 'hello @Taylor friend')
  assert.equal(inserted.caret, 14)
})

test('keeps only selected mentions still present in the message', () => {
  const mentions = [
    { userId: 'a', userName: 'Taylor', handle: 'Taylor' },
    { userId: 'b', userName: 'Sam', handle: 'Sam' },
  ]
  assert.deepEqual(activeMentions('Hi @Taylor!', mentions), [mentions[0]])
})

test('splits tagged handles without matching longer plain text', () => {
  const mention = { userId: 'a', userName: 'Sam', handle: 'Sam' }
  assert.deepEqual(splitMentionText('@Sam hi @Samantha', [mention]), [
    { text: '@Sam', mention },
    { text: ' hi @Samantha' },
  ])
})

test('drops malformed mention metadata before rendering or highlighting it', () => {
  assert.deepEqual(normalizeChatMentions([
    { userId: 'a', userName: 'Sam', handle: 'Sam' },
    { userId: 'b', userName: '', handle: 'Nobody' },
    { userId: 'c', userName: 'Bad handle', handle: 'not valid' },
  ]), [
    { userId: 'a', userName: 'Sam', handle: 'Sam' },
  ])
})
