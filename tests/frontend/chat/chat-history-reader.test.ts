import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createChatHistorySource } from '../../../src/features/chat/history-reader'
import type { ChatMessage } from '../../../src/features/chat/model'

const message: ChatMessage = { id: '00000000-0000-4000-8000-000000000001', content: 'Original body', type: 'text', user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: new Date().toISOString() }

test('Chat writes use current room credentials without impersonating another listener', async () => {
  const requests: Array<{ url: string; options?: RequestInit }> = []
  const trivia = { messageId: message.id, endsAt: new Date(Date.now() + 30_000).toISOString(), serverNow: new Date().toISOString(), answered: 1, selectedOption: 2 }
  const fetcher: typeof fetch = async (url, options) => { requests.push({ url: String(url), options }); return Response.json(String(url).includes('/trivia/') ? trivia : { ok: true }) }
  const source = createChatHistorySource('alice-rotated-token', 'private-room', fetcher)
  await source.saveMessage(message)
  await source.saveReaction({ action: 'add', messageId: message.id, userId: 'forged-owner', emoji: '❤️' })
  await source.answerTrivia!(message.id, 2)
  assert.equal(requests[0].url, '/api/rooms/private-room/chat/messages')
  assert.equal(new Headers(requests[0].options?.headers).get('authorization'), 'Bearer alice-rotated-token')
  assert.equal(JSON.parse(String(requests[1].options?.body)).userId, undefined)
  assert.equal(requests[2].url, `/api/rooms/private-room/chat/trivia/${message.id}/answer`)
  assert.deepEqual(JSON.parse(String(requests[2].options?.body)), { optionIndex: 2 })
  assert.equal(new Headers(requests[2].options?.headers).get('authorization'), 'Bearer alice-rotated-token')
  assert.equal(requests.every((request) => request.options?.signal instanceof AbortSignal), true)
})

test('Opening a chat with many links loads every visible preview without blocking another account or fetching departed cards', async () => {
  const requests: Array<{ account: string | null; path: string; url: string }> = []
  const active = new Map<string | null, number>()
  const finishRequests: Array<() => void> = []
  let maximumActive = 0
  const fetcher: typeof fetch = async (path, options) => {
    const account = new Headers(options?.headers).get('authorization')
    const url = new URL(String(path), 'https://turntune.test').searchParams.get('url')!
    requests.push({ account, path: String(path), url })
    active.set(account, (active.get(account) || 0) + 1)
    maximumActive = Math.max(maximumActive, active.get(account)!)
    return new Promise(resolve => finishRequests.push(() => {
      active.set(account, active.get(account)! - 1)
      resolve(Response.json({ preview: { url, title: `Preview ${url}`, siteName: 'Example' } }))
    }))
  }
  const alice = createChatHistorySource('alice-token', 'alice-room', fetcher).loadLinkPreview!
  const bob = createChatHistorySource('bob-token', 'bob-room', fetcher).loadLinkPreview!
  const controllers = Array.from({ length: 8 }, () => new AbortController())
  const urls = controllers.map((_, index) => `https://example.com/shared-${index}`)
  const previews = urls.map((url, index) => alice(url, controllers[index].signal))
  assert.ok(requests.length > 0 && requests.length <= 4, 'visible cards must stay within the server request allowance')

  const reason = new DOMException('The message left the viewport', 'AbortError')
  const canceled = assert.rejects(previews[7], error => error === reason)
  controllers[7].abort(reason)
  const bobPreview = bob(urls[0], new AbortController().signal)
  assert.ok(requests.some(request => request.account === 'Bearer bob-token'), 'another account starts without waiting for the previous account')
  while (finishRequests.length) {
    finishRequests.splice(0).forEach(finish => finish())
    await setImmediate()
  }

  const completed = await Promise.all(previews.slice(0, 7))
  await canceled
  assert.deepEqual(completed.map(preview => preview?.url), urls.slice(0, 7))
  assert.equal((await bobPreview)?.url, urls[0])
  assert.ok(maximumActive <= 4)
  assert.equal(requests.some(request => request.url === urls[7]), false)
  assert.equal(requests.filter(request => request.account === 'Bearer alice-token').length, 7)
  assert.equal(requests.filter(request => request.account === 'Bearer bob-token').length, 1)
  assert.ok(requests.every(request => request.path.startsWith(request.account === 'Bearer alice-token' ? '/api/rooms/alice-room/' : '/api/rooms/bob-room/')))
})
