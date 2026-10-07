import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatHistorySource } from '../src/chat/history-reader'
import type { ChatMessage } from '../src/chat/model'

const message: ChatMessage = { id: '00000000-0000-4000-8000-000000000001', content: 'Original body', type: 'text', user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: new Date().toISOString() }
test('room API uses a bounded signal and maps timeout into useful retry copy on reads and immutable saves', async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!
  const durations: number[] = [], bodies: unknown[] = []
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: (duration: number) => { durations.push(duration); return AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')) } })
  const request: typeof fetch = async (_url, options) => { assert.equal(options?.signal?.aborted, true); if (options?.body) bodies.push(JSON.parse(String(options.body))); throw options?.signal?.reason }
  try {
    const source = createChatHistorySource('alice-current-token', 'lounge', request)
    await assert.rejects(source.loadPage(), /request timed out.*try again/i)
    await assert.rejects(source.search('saved text'), /request timed out/i)
    await assert.rejects(source.loadMediaUrl('alice/lounge/image.png'), /request timed out/i)
    await assert.rejects(source.saveMessage(message), /request timed out/i)
    await assert.rejects(source.saveMessage(message), /request timed out/i)
    assert.equal(durations.every((duration) => duration === 15_000), true)
    assert.deepEqual(bodies.slice(-2), [message, message])
  } finally { Object.defineProperty(AbortSignal, 'timeout', original) }
})

test('writes stay token/room scoped and never send a forged reaction owner', async () => {
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
