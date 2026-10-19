import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatHistorySource } from '../src/chat/history-reader'
import type { ChatMessage } from '../src/chat/model'

const message: ChatMessage = { id: '00000000-0000-4000-8000-000000000001', content: 'Original body', type: 'text', user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: new Date().toISOString() }

test('Chat writes use current room credentials without impersonating another listener', async () => {
  const requests: Array<{ url: string; options?: RequestInit }> = []
  const fetcher: typeof fetch = async (url, options) => { requests.push({ url: String(url), options }); return Response.json({ ok: true }) }
  const source = createChatHistorySource('alice-rotated-token', 'private-room', fetcher)
  await source.saveMessage(message)
  await source.saveReaction({ action: 'add', messageId: message.id, userId: 'forged-owner', emoji: '❤️' })
  assert.equal(requests[0].url, '/api/rooms/private-room/chat/messages')
  assert.equal(new Headers(requests[0].options?.headers).get('authorization'), 'Bearer alice-rotated-token')
  assert.equal(JSON.parse(String(requests[1].options?.body)).userId, undefined)
  assert.equal(requests.every((request) => request.options?.signal instanceof AbortSignal), true)
})
