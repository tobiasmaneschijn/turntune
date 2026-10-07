import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyChatUserProfiles,
  applyReactionEvents,
  groupReactions,
  reactionLabel,
  mergeChatMessages,
  recentChatMessages,
  shouldShowMessageHeader,
  type ChatMessage,
} from '../src/chat/model.js'

const message: ChatMessage = {
  id: '60dc4785-4115-4ac3-b5ba-86a803b82b13',
  content: 'hello',
  type: 'text',
  user: {
    id: '2e9d2bf6-fc23-4b3d-9646-ae1c22e5d677',
    name: 'Original name',
    avatarSeed: 'old-seed',
    avatarKey: 'pulse',
  },
  createdAt: '2026-07-19T10:00:00.000Z',
}

test('chat messages use the current profile avatar without rewriting the message name', () => {
  const [result] = applyChatUserProfiles([message], [{
    id: message.user.id,
    avatarSeed: message.user.id,
    avatarKey: 'pulse',
    avatarUrl: 'https://example.supabase.co/storage/v1/object/public/profile-avatars/owl.png',
    isAppAdmin: true,
  }])

  assert.equal(result.user.name, 'Original name')
  assert.equal(result.user.avatarSeed, message.user.id)
  assert.equal(result.user.avatarUrl, 'https://example.supabase.co/storage/v1/object/public/profile-avatars/owl.png')
  assert.equal(result.user.isAppAdmin, true)
})

test('switching back to a built-in avatar clears an older custom image', () => {
  const [result] = applyChatUserProfiles([{
    ...message,
    user: { ...message.user, avatarUrl: 'https://example.com/old.png' },
  }], [{
    id: message.user.id,
    avatarSeed: message.user.id,
    avatarKey: 'sunset',
    avatarUrl: undefined,
    isAppAdmin: false,
  }])

  assert.equal(result.user.avatarKey, 'sunset')
  assert.equal(result.user.avatarUrl, undefined)
})

test('reaction groups retain resolved reactor names for accessible tooltips', () => {
  const reactions = [
    { emoji: '❤️', userId: message.user.id, userName: 'Original name' },
    { emoji: '❤️', userId: 'other', userName: 'Taylor' },
  ]
  const [[, group]] = groupReactions(reactions, message.user.id)

  assert.equal(group.count, 2)
  assert.equal(group.hasReacted, true)
  assert.equal(reactionLabel(group, message.user.id), 'You, Taylor')
})

test('live reaction events resolve names from trusted room profiles', () => {
  const [result] = applyReactionEvents([message], [{
    id: 'event',
    messageId: message.id,
    userId: 'other',
    emoji: '😂',
    action: 'add',
  }], new Map([['other', 'Taylor']]))

  assert.deepEqual(result.reactions, [{ emoji: '😂', userId: 'other', userName: 'Taylor' }])
})

test('history and repeated broadcasts show one durable message per id', () => {
  const persisted = { ...message, reactions: [{ userId: 'other', emoji: '❤️' }] }
  assert.deepEqual(mergeChatMessages([persisted], [message, message]), [persisted])
})

test('timeline sorts actual instants across timezone offsets and timestamp formats', () => {
  const later = { ...message, id: 'later', createdAt: '2026-07-19T12:00:01+02:00' }
  const earlier = { ...message, id: 'earlier', createdAt: '2026-07-19T10:00:00Z' }
  assert.deepEqual(mergeChatMessages([later], [earlier]).map((item) => item.id), ['earlier', 'later'])
})

test('same-author messages show a new header after midnight', () => {
  const previous = { ...message, createdAt: '2026-07-19T23:59:00' }
  const next = { ...message, id: 'next', createdAt: '2026-07-20T00:01:00' }
  assert.equal(shouldShowMessageHeader(next, previous), true)
})

test('the live window retains the latest chronological rows while persisted history remains independent', () => {
  const rows = Array.from({ length: 1010 }, (_, index) => ({ ...message, id: String(index) }))
  assert.equal(recentChatMessages(rows).length, 1000)
  assert.equal(recentChatMessages(rows)[0].id, '10')
  assert.equal(recentChatMessages(rows).at(-1)?.id, '1009')
  assert.equal(rows.length, 1010)
})
