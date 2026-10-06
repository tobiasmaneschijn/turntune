import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchGiphyGifs, validateChatImage, createChatStoragePath, CHAT_IMAGE_MAX_BYTES } from '../src/chat/media.js'

test('GIF requests load trending immediately and normalize searched queries', async (context) => {
  const requests: string[] = []
  context.mock.method(globalThis, 'fetch', async (input) => {
    requests.push(String(input))
    return Response.json({ results: [] })
  })

  await fetchGiphyGifs()
  await fetchGiphyGifs('  dance party  ')

  assert.equal(requests[0], '/api/giphy')
  assert.equal(requests[1], '/api/giphy?q=dance+party')
})

test('uploads reject formats the storage bucket does not support and empty images', () => {
  assert.match(validateChatImage(new File(['svg'], 'photo.svg', { type: 'image/svg+xml' })) || '', /JPEG, PNG, WebP, or GIF/)
  assert.match(validateChatImage(new File([], 'photo.png', { type: 'image/png' })) || '', /empty/)
  assert.equal(validateChatImage(new File(['png'], 'photo.png', { type: 'image/png' })), null)
  assert.match(validateChatImage({ type: 'image/png', size: CHAT_IMAGE_MAX_BYTES + 1 } as File) || '', /6 MB/)
})

test('storage filenames use the verified MIME type rather than an untrusted extension', () => {
  const path = createChatStoragePath('listener', 'soundspin:room', new File(['png'], 'image.html', { type: 'image/png' }))
  assert.match(path, /^listener\/soundspin-room\/[\w-]+\.png$/)
})

test('GIF requests can be aborted and carry the signed-in listener token', async (context) => {
  const controller = new AbortController()
  context.mock.method(globalThis, 'fetch', async (_input, options) => {
    assert.equal(options?.signal, controller.signal)
    assert.deepEqual(options?.headers, { Authorization: 'Bearer listener-token' })
    return Response.json({ results: [] })
  })
  await fetchGiphyGifs('dance', 'listener-token', controller.signal)
})
