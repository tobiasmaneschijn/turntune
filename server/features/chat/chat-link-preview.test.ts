import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import sharp from 'sharp'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createPublicPreviewFetcher, isPublicPreviewAddress, type PreviewHttpResponse } from './link-preview-fetch.js'
import { createLinkPreviewService, parsePreviewMetadata } from './link-preview.js'
import { mountChatLinkPreviewRoutes } from './link-preview-routes.js'
import { firstChatLink, isChatLinkPreview, splitChatLinks } from '../../../shared/chat-link-preview.js'

const publicAddress = { address: '93.184.216.34', family: 4 as const }
const html = (body: string): PreviewHttpResponse => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(body) })

test('A shared web link keeps surrounding prose and renders only plain preview metadata', () => {
  const parts = splitChatLinks('Listen (https://example.com/track_(live)). Then https://example.org/a?b=1&c=2!')
  assert.equal(parts.map(part => part.text).join(''), 'Listen (https://example.com/track_(live)). Then https://example.org/a?b=1&c=2!')
  assert.equal(firstChatLink(parts.map(part => part.text).join('')), 'https://example.com/track_(live)')
  assert.equal(splitChatLinks('https://user:secret@example.com/').some(part => part.url), false)
  const parsed = parsePreviewMetadata('<meta property="og:title" content="A &amp; B &lt;script&gt;hello&lt;/script&gt;"><meta name="description" content="A useful description"><meta property="og:image" content="/cover.png">', new URL('https://example.com/song'))!
  assert.equal(parsed.preview.title, 'A & B hello')
  assert.equal(parsed.imageUrl, 'https://example.com/cover.png')
  assert.ok(isChatLinkPreview(parsed.preview))
  assert.equal(isChatLinkPreview({ ...parsed.preview, image: 'data:image/svg+xml,<svg onload="alert(1)"/>' }), false)
})

test('Preview fetching blocks internal addresses, mixed DNS answers and redirects before connecting', async () => {
  for (const address of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '169.254.169.254', '100.64.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', '2002:7f00:1::'])
    assert.equal(isPublicPreviewAddress(address), false, address)
  assert.equal(isPublicPreviewAddress('2606:4700:4700::1111'), true)
  let connections = 0
  const fetchPublic = createPublicPreviewFetcher({
    resolve: async host => host === 'mixed.example.com' ? [publicAddress, { address: '10.0.0.1', family: 4 }] : [publicAddress],
    request: async (_url, address) => {
      connections++
      assert.deepEqual(address, publicAddress)
      return { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' }, body: Buffer.alloc(0) }
    },
  })
  const signal = new AbortController().signal
  for (const url of ['http://2130706433/', 'http://127.1/', 'http://[::ffff:127.0.0.1]/', 'https://example.com:8443/', 'https://mixed.example.com/'])
    await assert.rejects(fetchPublic(url, signal, 1000))
  assert.equal(connections, 0)
  await assert.rejects(fetchPublic('https://example.com/', signal, 1000))
  assert.equal(connections, 1, 'the public connection never follows a redirect into the metadata service')
})

test('Repeated previews share bounded work and thumbnails are re-encoded before reaching a listener', async () => {
  const original = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()
  let requests = 0
  const service = createLinkPreviewService({
    resolve: async () => [publicAddress],
    request: async (url, address) => {
      assert.deepEqual(address, publicAddress)
      requests++
      if (url.pathname === '/cover.png') return { status: 200, headers: { 'content-type': 'image/png' }, body: original }
      return html('<meta property="og:title" content="A song"><meta property="og:image" content="/cover.png">')
    },
  })
  const [first, second] = await Promise.all([service.preview('https://example.com/song#first'), service.preview('https://example.com/song#second')])
  assert.deepEqual(first, second)
  assert.match(first!.image!, /^data:image\/webp;base64,/)
  assert.equal(requests, 2)
  await service.preview('https://example.com/song')
  assert.equal(requests, 2)
  const blocked = createLinkPreviewService({ resolve: async () => [publicAddress], request: async () => html('x'.repeat(256 * 1024 + 1)) })
  assert.equal(await blocked.preview('https://example.com/large'), null)
  const disguisedSvg = createLinkPreviewService({
    resolve: async () => [publicAddress],
    request: async url => url.pathname === '/cover.png'
      ? { status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>') }
      : html('<title>A safe title</title><meta property="og:image" content="/cover.png">'),
  })
  assert.equal((await disguisedSvg.preview('https://example.com/'))?.image, undefined)
})

test('Link previews require current room membership before fetching and before returning cached metadata', async () => {
  const app = express()
  let admitted = true
  let release!: () => void
  let requests = 0
  const held = new Promise<void>(resolve => { release = resolve })
  mountChatLinkPreviewRoutes(app, {
    getUserId: async request => request.headers.authorization === 'Bearer member' ? 'member' : null,
    canReadRoom: async () => admitted,
  }, { preview: async url => { requests++; await held; return { url, title: 'A page', siteName: 'example.com' } } })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rooms/lounge/chat/link-preview?url=https%3A%2F%2Fexample.com%2F`
  try {
    assert.equal((await fetch(endpoint)).status, 401)
    admitted = false
    assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer member' } })).status, 403)
    assert.equal(requests, 0)
    admitted = true
    const pending = fetch(endpoint, { headers: { Authorization: 'Bearer member' } })
    while (!requests) await new Promise(resolve => setImmediate(resolve))
    admitted = false
    release()
    assert.equal((await pending).status, 403)
  } finally { release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
