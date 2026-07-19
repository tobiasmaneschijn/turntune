import assert from 'node:assert/strict'
import test from 'node:test'

import { applyChatUserProfiles, type ChatMessage } from '../src/chat/model.js'

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
