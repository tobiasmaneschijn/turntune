import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStoredChatMessage, mountChatHistoryRoutes } from './chat-history.js'
import { createChatRelay } from './chat-relay.js'

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const rows = Array.from({ length: 45 }, (_, index) => ({ id: id(index + 1), created_at: '2026-10-06T10:00:00.000001+00:00',
  reply_to_id: null, user_id: 'alice', room_slug: 'lounge', content: `message ${index + 1}`, soundspin_message_reactions: [] }))
function database() {
  const calls: URL[] = []
  const writes: Array<{ table: string; method: string; values: Record<string, unknown>; query: URL; headers: Headers }> = []
  const records: Array<Record<string, any>> = rows.map((row) => ({ ...row }))
  const signed: Array<{ paths: string[]; expiresIn: number }> = []
  // Use the actual PostgREST client against a local deterministic response, so filters are serialized by the SDK.
  return import('@supabase/supabase-js').then(({ createClient }) => ({ calls, writes, records, signed,
    client: createClient('https://history.invalid', 'fixture', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push(url)
      if (url.pathname.includes('/storage/v1/object/sign/chat-media')) {
        const text = input instanceof Request ? await input.clone().text() : String(init?.body || '{}')
        const body = JSON.parse(text) as { paths?: string[]; expiresIn: number }
        const paths = body.paths || [url.pathname.split('/chat-media/')[1]]
        signed.push({ paths, expiresIn: body.expiresIn })
        return Response.json(body.paths ? paths.map((path) => ({ path, signedURL: `/object/sign/chat-media/${path}?token=fixture`, error: null })) : { signedURL: `/object/sign/chat-media/${paths[0]}?token=fixture` })
      }
      if (url.pathname.endsWith('/soundspin_profiles')) return Response.json([])
      const method = input instanceof Request ? input.method : init?.method || 'GET'
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
      if (method !== 'GET') {
        const text = input instanceof Request ? await input.clone().text() : String(init?.body || '{}')
        const values = JSON.parse(text || '{}') as Record<string, unknown>
        const table = url.pathname.split('/').at(-1)!
        writes.push({ table, method, values, query: url, headers })
        if (table === 'soundspin_messages') {
          if (records.some((row) => row.id === values.id)) return Response.json({ code: '23505', message: 'duplicate UUID' }, { status: 409 })
          records.push(values as typeof records[number])
        }
        return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(null, { status: 201 })
      }
      let selected = records.filter((row) => !url.searchParams.get('room_slug') || row.room_slug === url.searchParams.get('room_slug')?.slice(3))
      if (url.searchParams.has('user_id')) selected = selected.filter((row) => row.user_id === url.searchParams.get('user_id')?.slice(3))
      if (url.searchParams.has('storage_path')) selected = selected.filter((row) => row.storage_path === url.searchParams.get('storage_path')?.slice(3))
      const messageId = url.searchParams.get('id')
      if (messageId?.startsWith('eq.')) selected = selected.filter((row) => row.id === messageId.slice(3))
      const cursor = url.searchParams.get('or')
      if (cursor) {
        const match = cursor.match(/id\.(lt|gt)\.([0-9a-f-]+)\)/i)!
        selected = selected.filter((row) => match[1] === 'lt' ? row.id < match[2] : row.id > match[2])
      }
      if (url.searchParams.get('order')?.startsWith('created_at.desc')) selected.reverse()
      selected = selected.slice(0, Number(url.searchParams.get('limit') || 200))
      const single = headers.get('accept')?.includes('object')
      return Response.json(single ? selected[0] || null : selected)
    } } }) as SupabaseClient,
  }))
}
async function withRoutes(run: (base: string, db: Awaited<ReturnType<typeof database>>, admission: { allowed: boolean; checks: number }) => Promise<void>) {
  const app = express()
  const db = await database()
  const admission = { allowed: true, checks: 0 }
  mountChatHistoryRoutes(app, { client: db.client, getUserId: async (request) => request.headers.authorization === 'Bearer valid' ? 'alice' : null,
    canReadRoom: async (_user, room) => { admission.checks++; return admission.allowed && room === 'lounge' },
    canWriteRoom: async (_user, room) => { admission.checks++; return admission.allowed && room === 'lounge' },
    getUser: async () => ({ id: 'alice', name: 'Trusted Alice', avatarSeed: 'alice' }) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  try { await run(`http://127.0.0.1:${address.port}`, db, admission) } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}
const authenticated = { headers: { Authorization: 'Bearer valid' } }

test('every history/search/context/message endpoint denies unauthenticated or unadmitted requests before database access', async () => {
  await withRoutes(async (base, db, admission) => {
    for (const path of ['history', 'search?q=message', `context/${id(1)}`, `messages/${id(1)}`]) {
      assert.equal((await fetch(`${base}/api/rooms/lounge/chat/${path}`)).status, 401)
      admission.allowed = false
      assert.equal((await fetch(`${base}/api/rooms/lounge/chat/${path}`, authenticated)).status, 403)
    }
    assert.equal(db.calls.length, 0)
    assert.equal(admission.checks, 4)
  })
})
test('history and search preserve room scope, timestamp precision, ID tie-breakers and bounded cursor pages', async () => {
  await withRoutes(async (base, db) => {
    const firstResponse = await fetch(`${base}/api/rooms/lounge/chat/history?pageSize=20`, authenticated)
    assert.equal(firstResponse.headers.get('cache-control'), 'no-store')
    const first = await firstResponse.json() as { rows: typeof rows; cursor: { createdAt: string; id: string }; hasMore: boolean }
    assert.deepEqual(first.rows.map((row) => row.id), rows.slice(-20).map((row) => row.id))
    assert.equal(first.hasMore, true)
    const params = new URLSearchParams({ beforeAt: first.cursor.createdAt, beforeId: first.cursor.id, pageSize: '20' })
    const second = await (await fetch(`${base}/api/rooms/lounge/chat/history?${params}`, authenticated)).json() as typeof first
    assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 40)
    const historyQuery = db.calls.find((url) => url.searchParams.has('or'))!
    assert.equal(historyQuery.searchParams.get('room_slug'), 'eq.lounge')
    assert.equal(historyQuery.searchParams.get('order'), 'created_at.desc,id.desc')
    assert.ok(historyQuery.searchParams.get('or')?.includes(first.cursor.createdAt))
    await fetch(`${base}/api/rooms/lounge/chat/search?q=${encodeURIComponent('50%_mix')}`, authenticated)
    const searchQuery = db.calls.find((url) => url.searchParams.has('content'))!
    assert.equal(searchQuery.searchParams.get('content'), 'ilike.%50\\%\\_mix%')
    assert.equal(searchQuery.searchParams.get('limit'), '41')
  })
})
test('context targets and both directions remain room scoped, and invalid cursor/search input never reaches the database', async () => {
  await withRoutes(async (base, db) => {
    const response = await fetch(`${base}/api/rooms/lounge/chat/context/${id(23)}`, authenticated)
    assert.equal(response.status, 200)
    const context = await response.json() as { rows: typeof rows; hasOlder: boolean; hasNewer: boolean }
    assert.equal(context.rows.length, 41)
    assert.equal(context.rows[20].id, id(23))
    assert.equal(context.hasOlder, true); assert.equal(context.hasNewer, true)
    for (const url of db.calls.filter((url) => url.pathname.endsWith('/soundspin_messages'))) assert.equal(url.searchParams.get('room_slug'), 'eq.lounge')
    const before = db.calls.length
    for (const path of ['history?beforeAt=invalid&beforeId=x', 'history?pageSize=999', 'search?q=x', `context/${encodeURIComponent('x,or(room_slug.eq.secret)')}`]) {
      assert.equal((await fetch(`${base}/api/rooms/lounge/chat/${path}`, authenticated)).status, 400)
    }
    assert.equal(db.calls.length, before)
  })
})
test('fresh admission is rechecked after access is revoked, and absent authorized targets return null', async () => {
  await withRoutes(async (base, db, admission) => {
    const response = await fetch(`${base}/api/rooms/lounge/chat/messages/${id(99)}`, authenticated)
    assert.equal(response.status, 200); assert.equal(await response.json(), null)
    const before = db.calls.length
    admission.allowed = false
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/history`, authenticated)).status, 403)
    assert.equal(db.calls.length, before)
  })
})

const post = (body: unknown, token = 'valid') => ({ method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const message = () => ({ id: id(100), content: 'Stored original', type: 'text', createdAt: '2026-10-06T10:00:00.001Z', user: { id: 'forged', name: 'Spoofed admin', isAppAdmin: true }, mentions: [] })

test('message and reaction writes own their JSON parser and gate every mutation before database queries', async () => {
  await withRoutes(async (base, db, admission) => {
    for (const path of ['messages', 'reactions']) {
      assert.equal((await fetch(`${base}/api/rooms/lounge/chat/${path}`, post(message(), 'invalid'))).status, 401)
      admission.allowed = false
      assert.equal((await fetch(`${base}/api/rooms/lounge/chat/${path}`, post(message()))).status, 403)
    }
    assert.equal(db.calls.length, 0)
    admission.allowed = true
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post(message()))).status, 200)
    assert.equal(db.writes[0].values.user_id, 'alice'); assert.equal(db.writes[0].values.user_name, 'Trusted Alice')
    assert.equal(db.writes[0].values.room_slug, 'lounge')
    admission.allowed = false
    const before = db.calls.length
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post(message()))).status, 403)
    assert.equal(db.calls.length, before)
  })
})

test('durable retries verify the immutable original UUID without overwriting and reject conflicting payloads', async () => {
  await withRoutes(async (base, db) => {
    const original = message()
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post(original))).status, 200)
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post(original))).status, 200)
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post({ ...original, content: 'Changed same UUID' }))).status, 409)
    assert.equal(db.writes.some((write) => write.method === 'PATCH'), false)
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post({ ...original, id: id(101), replyTo: { id: id(900) } }))).status, 400)
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post({ ...original, id: id(102), type: 'image', mediaUrl: 'https://example.test/image.png', storagePath: 'bob/private/image.png' }))).status, 400)
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/messages`, post({ ...original, id: id(103), content: 'x'.repeat(501) }))).status, 400)
  })
})

test('durable reactions stamp the account, target the same room, and use idempotent add/delete behavior', async () => {
  await withRoutes(async (base, db) => {
    const reaction = { messageId: id(1), userId: 'forged', emoji: '❤️', action: 'add' }
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/reactions`, post(reaction))).status, 200)
    const add = db.writes.at(-1)!
    assert.equal(add.table, 'soundspin_message_reactions'); assert.equal(add.values.user_id, 'alice')
    assert.match(add.headers.get('prefer') || '', /resolution=ignore-duplicates/)
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/reactions`, post({ ...reaction, action: 'remove' }))).status, 200)
    assert.equal(db.writes.at(-1)!.query.searchParams.get('user_id'), 'eq.alice')
    const before = db.writes.length
    assert.equal((await fetch(`${base}/api/rooms/lounge/chat/reactions`, post({ ...reaction, messageId: id(900) }))).status, 400)
    assert.equal(db.writes.length, before)
  })
})

test('durable UUID retries preserve canonical text-media and duplicate-mention identity across stored lookup and a fresh relay', async () => {
  await withRoutes(async (base, db) => {
    const original = { ...message(), mediaUrl: 'https://example.test/irrelevant.png', storagePath: 'alice/lounge/unused.png',
      mentions: [{ userId: 'mira', userName: 'Old name', handle: 'old' }, { userId: 'sam', userName: 'Sam', handle: 'sam' },
        { userId: 'mira', userName: 'Mira', handle: 'mira' }] }
    const endpoint = `${base}/api/rooms/lounge/chat/messages`
    assert.equal((await fetch(endpoint, post(original))).status, 200)
    const stored = await loadStoredChatMessage(db.client, original.id)
    assert.ok(stored)
    assert.equal(stored.message.mediaUrl, undefined); assert.equal(stored.message.storagePath, undefined)
    assert.deepEqual(stored.message.mentions.map((mention) => mention.userName), ['Mira', 'Sam'])
    assert.equal((await fetch(endpoint, post(original))).status, 200)
    assert.equal((await fetch(endpoint, post({ ...original, mediaUrl: undefined, storagePath: undefined, mentions: stored.message.mentions }))).status, 200)
    assert.equal((await fetch(endpoint, post({ ...original, mentions: [...original.mentions, { userId: 'mira', userName: 'Changed final name', handle: 'mira' }] }))).status, 409)
    let emitted = 0
    const restartedRelay = createChatRelay({ getMembership: () => ({ room: { id: 'lounge' }, user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' } }),
      canWriteRoom: async () => true, loadReply: async () => null, loadMessageById: (messageId) => loadStoredChatMessage(db.client, messageId),
      emitToRoom: async () => { emitted++ } })
    assert.deepEqual(await restartedRelay.handle('socket', 'message', { roomId: 'lounge', message: original }), { ok: true })
    assert.equal(emitted, 0)
    assert.equal(db.records.filter((row) => row.id === original.id).length, 1)
    assert.equal(db.writes.some((write) => write.method === 'PATCH'), false)
    assert.equal(db.signed.length, 0)
  })
})

test('private media signing authorizes the room, checks referenced legacy paths and uses bounded URLs for history', async () => {
  await withRoutes(async (base, db, admission) => {
    const path = `alice/lounge/${id(110)}.png`
    const url = `${base}/api/rooms/lounge/chat/media-url`
    assert.equal((await fetch(url, post({ storagePath: path }, 'invalid'))).status, 401)
    admission.allowed = false
    assert.equal((await fetch(url, post({ storagePath: path }))).status, 403)
    assert.equal(db.signed.length, 0)
    admission.allowed = true
    const response = await fetch(url, post({ storagePath: path }))
    assert.equal(response.status, 200)
    assert.match((await response.json()).url, /object\/sign\/chat-media/)
    assert.equal(db.signed[0].expiresIn, 300)
    assert.equal((await fetch(url, post({ storagePath: `bob/private-room/${id(111)}.png` }))).status, 400)
    assert.equal((await fetch(url, post({ storagePath: `alice/lounge/../../private.png` }))).status, 400)
    const legacy = `bob/soundspin-lounge/${id(112)}.png`
    db.records.push({ ...rows[0], id: id(112), user_id: 'bob', user_name: 'Bob', message_type: 'image', storage_path: legacy, media_url: 'https://public.example.test/legacy.png' })
    assert.equal((await fetch(url, post({ storagePath: legacy }))).status, 200)
    const history = await (await fetch(`${base}/api/rooms/lounge/chat/history`, authenticated)).json()
    assert.match(history.rows.find((row: any) => row.id === id(112)).media_url, /object\/sign\/chat-media/)
    assert.equal(db.signed.every((request) => request.expiresIn === 300), true)
  })
})

test('admission is rechecked after awaited profile/reply work before mutating the database', async () => {
  const app = express(), db = await database()
  let allowed = true
  mountChatHistoryRoutes(app, { client: db.client, getUserId: async () => 'alice', canReadRoom: async () => allowed, canWriteRoom: async () => allowed,
    getUser: async () => { allowed = false; return { id: 'alice', name: 'Alice', avatarSeed: 'alice' } } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/rooms/lounge/chat/messages`, post(message()))
    assert.equal(response.status, 403); assert.equal(db.writes.length, 0)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})

test('a room revoked during media signing never receives the signed URL response', async () => {
  const app = express(), db = await database()
  let checks = 0
  mountChatHistoryRoutes(app, { client: db.client, getUserId: async () => 'alice', canReadRoom: async () => ++checks === 1 })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/rooms/lounge/chat/media-url`, post({ storagePath: `alice/lounge/${id(110)}.png` }))
    assert.equal(response.status, 403); assert.equal((await response.json()).url, undefined)
    assert.equal(db.signed.length, 1); assert.equal(checks, 2)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})

test('durable UUID lookup distinguishes an absent row from unavailable storage and preserves room/owner/body', async () => {
  await withRoutes(async (base, db) => {
    await fetch(`${base}/api/rooms/lounge/chat/messages`, post(message()))
    const stored = await loadStoredChatMessage(db.client, id(100))
    assert.equal(stored?.roomId, 'lounge'); assert.equal(stored?.userId, 'alice'); assert.equal(stored?.message.content, message().content)
    assert.equal(await loadStoredChatMessage(db.client, id(999)), null)
    await assert.rejects(loadStoredChatMessage(null, id(999)), /storage is unavailable/i)
    const broken = { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null, error: new Error('Database lookup failed') }) }) } as unknown as SupabaseClient
    await assert.rejects(loadStoredChatMessage(broken, id(999)), /Database lookup failed/)
  })
})
