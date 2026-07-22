import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchGiphyGifs } from '../src/chat/media.js'

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
