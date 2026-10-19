import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatAttentionTracker } from '../src/notifications'

test('Returning to chat does not replay alerts for old or repeated messages', () => {
  const joinedAt = Date.now(), tracker = createChatAttentionTracker('alice', joinedAt)
  const message = { id: 'new', user: { id: 'mira' }, createdAt: new Date(joinedAt).toISOString(), mentions: [{ userId: 'alice' }] }
  tracker.seed([{ id: 'history' }])
  assert.equal(tracker.consume({ ...message, id: 'history' }), false)
  assert.equal(tracker.consume({ ...message, id: 'old', createdAt: new Date(joinedAt - 30_000).toISOString() }), false)
  assert.equal(tracker.consume({ ...message, id: 'own', user: { id: 'alice' } }), false)
  assert.equal(tracker.consume(message), true); assert.equal(tracker.consume(message), false)
})
