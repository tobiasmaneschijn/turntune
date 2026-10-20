import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyRemovalEvents,
  mergeChatMessages,
  type ChatMessage,
} from '../../../src/features/chat/model.js'

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

test('Loading history alongside live chat does not duplicate messages', () => {
  const persisted = { ...message, reactions: [{ userId: 'other', emoji: '❤️' }] }
  assert.deepEqual(mergeChatMessages([persisted], [message, message]), [persisted])
})

test('Removing a message also removes its image and quoted previews', () => {
  const original = { ...message, type: 'image' as const, content: 'Secret', mediaUrl: 'https://example.test/private.png', storagePath: 'owner/room/image.png', reactions: [{ userId: 'other', emoji: '❤️' }] }
  const quote = { ...message, id: 'reply', replyTo: { ...original, user: { id: message.user.id, name: message.user.name } } }
  const removedAt = '2026-10-09T10:00:00.000Z'
  const [removed, reply] = applyRemovalEvents([original, quote], [{ messageId: message.id, removedAt }])
  assert.equal(removed.content, 'Message removed'); assert.equal(removed.mediaUrl, undefined); assert.equal(removed.storagePath, undefined); assert.deepEqual(removed.reactions, [])
  assert.equal(reply.replyTo?.content, 'Message removed'); assert.equal(reply.replyTo?.mediaUrl, undefined)
  assert.equal(mergeChatMessages([original], [removed])[0].removedAt, removedAt)
  assert.equal(mergeChatMessages([removed], [original])[0].content, 'Message removed')
})
