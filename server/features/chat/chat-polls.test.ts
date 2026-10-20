import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { loadStoredChatMessage, mountChatHistoryRoutes } from './chat-history.js'
import { canonicalMessage, chatMessageSchema, immutableMessageKey, type ChatPollVoteEvent } from './chat-validation.js'
import { createChatWritePolicy } from './chat-write-policy.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const input = () => ({ id: id(2), type: 'text', content: '  What should we play?  ', createdAt: new Date().toISOString(), poll: { options: [' House ', 'Jazz'] } })
const user = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }

test('poll definitions validate question/options and canonical messages cannot accept submitted votes', () => {
  const parsed = chatMessageSchema.parse({ ...input(), poll: { options: input().poll.options, votes: [{ userId: 'bob', optionIndex: 1, revision: 999 }] } })
  const canonical = canonicalMessage(parsed, user)
  assert.equal(canonical.content, 'What should we play?')
  assert.deepEqual(canonical.poll, { options: ['House', 'Jazz'], votes: [] })
  assert.equal(immutableMessageKey(parsed), immutableMessageKey(canonical))
  assert.notEqual(immutableMessageKey(parsed), immutableMessageKey({ ...parsed, poll: { options: ['House', 'Rock'] } }))
  for (const invalid of [
    { ...input(), content: ' ' }, { ...input(), content: 'x'.repeat(201) },
    { ...input(), type: 'image', mediaUrl: 'https://example.test/image.png' },
    ...[['One'], ['One', 'one'], ['One', ' '], ['One', 'x'.repeat(81)], ['1', '2', '3', '4', '5']].map((options) => ({ ...input(), poll: { options } })),
  ]) assert.equal(chatMessageSchema.safeParse(invalid).success, false)
})

function fixture() {
  const rows: Array<Record<string, any>> = [{ id: id(1), room_slug: 'lounge', user_id: 'bob', user_name: 'Bob', avatar_seed: 'bob',
    content: 'Next genre?', message_type: 'text', created_at: new Date().toISOString(), reply_to_id: null, mentions: [],
    poll_options: ['House', 'Jazz'], soundspin_message_reactions: [] }]
  const votes: Array<{ message_id: string; room_slug: string; user_id: string; option_index: number; revision: number }> = []
  const calls: URL[] = []
  const writes: Array<{ table: string; body: Record<string, unknown>; headers: Headers }> = []
  const published: ChatPollVoteEvent[] = []
  const admission = { allowed: true, checks: 0, revokeAfterRead: false }
  const client = createClient('https://polls.invalid', 'fixture', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (request, init) => {
    const url = new URL(String(request)); calls.push(url)
    const table = url.pathname.split('/').at(-1)!
    const method = request instanceof Request ? request.method : init?.method || 'GET'
    const headers = new Headers(request instanceof Request ? request.headers : init?.headers)
    if (method !== 'GET') {
      const text = request instanceof Request ? await request.clone().text() : String(init?.body || '{}')
      const body = JSON.parse(text) as Record<string, unknown>
      writes.push({ table, body, headers })
      if (table === 'soundspin_messages') {
        if (rows.some((row) => row.id === body.id)) return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 })
        rows.push(body)
        return Response.json(null, { status: 201 })
      }
      if (table === 'soundspin_poll_votes') {
        const existing = votes.find((vote) => vote.message_id === body.message_id && vote.user_id === body.user_id)
        const vote = { message_id: String(body.message_id), room_slug: String(body.room_slug), user_id: String(body.user_id),
          option_index: Number(body.option_index), revision: existing ? existing.revision + 1 : 1 }
        if (existing) Object.assign(existing, vote)
        else votes.push(vote)
        return Response.json(vote)
      }
      throw new Error(`Unexpected write: ${table}`)
    }
    if (table === 'soundspin_profiles') return Response.json([])
    let selected = rows.filter((row) => !url.searchParams.has('room_slug') || row.room_slug === url.searchParams.get('room_slug')?.slice(3))
    if (url.searchParams.get('id')?.startsWith('eq.')) selected = selected.filter((row) => row.id === url.searchParams.get('id')!.slice(3))
    if (url.searchParams.has('user_id')) selected = selected.filter((row) => row.user_id === url.searchParams.get('user_id')!.slice(3))
    const result = selected.map((row) => ({ ...row, soundspin_poll_votes: votes.filter((vote) => vote.message_id === row.id)
      .map((vote) => ({ user_id: vote.user_id, option_index: vote.option_index, revision: vote.revision })) }))
    if (admission.revokeAfterRead) admission.allowed = false
    return Response.json(headers.get('accept')?.includes('object') ? result[0] || null : result)
  } } })
  return { client, rows, votes, calls, writes, published, admission }
}

async function withRoutes(run: (base: string, db: ReturnType<typeof fixture>) => Promise<void>) {
  const app = express()
  const db = fixture()
  const authorize = async (_userId: string, room: string) => { db.admission.checks++; return db.admission.allowed && room === 'lounge' }
  mountChatHistoryRoutes(app, { client: db.client,
    getUserId: async (request) => request.headers.authorization === 'Bearer valid' ? user.id : null,
    canReadRoom: authorize, canWriteRoom: authorize, getUser: async () => user,
    onPollVote: async (_room, event) => { db.published.push(event) } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as { port: number }
  try { await run(`http://127.0.0.1:${port}/api/rooms/lounge/chat`, db) }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}
const post = (body: unknown, token = 'valid') => ({ method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('poll vote routes authorize before privileged reads and stamp the admitted account/room', async () => {
  await withRoutes(async (base, db) => {
    const endpoint = `${base}/polls/${id(1)}/vote`
    assert.equal((await fetch(endpoint, post({ optionIndex: 0 }, 'invalid'))).status, 401)
    db.admission.allowed = false
    assert.equal((await fetch(endpoint, post({ optionIndex: 0 }))).status, 403)
    assert.equal(db.calls.length, 0)
    db.admission.allowed = true
    const response = await fetch(endpoint, post({ optionIndex: 0, userId: 'forged', roomSlug: 'private-room', revision: 999 }))
    assert.equal(response.status, 200)
    const event = await response.json()
    assert.deepEqual(event, { messageId: id(1), userId: 'alice', optionIndex: 0, revision: 1 })
    assert.deepEqual(db.published, [event])
    assert.deepEqual(db.writes[0].body, { message_id: id(1), room_slug: 'lounge', user_id: 'alice', option_index: 0 })
    assert.match(db.writes[0].headers.get('prefer') || '', /resolution=merge-duplicates/)
  })
})

test('changing and concurrent votes retain one account row and publish increasing database revisions', async () => {
  await withRoutes(async (base, db) => {
    const endpoint = `${base}/polls/${id(1)}/vote`
    const first = await (await fetch(endpoint, post({ optionIndex: 0 }))).json()
    const second = await (await fetch(endpoint, post({ optionIndex: 1 }))).json()
    assert.equal(first.revision, 1); assert.equal(second.revision, 2)
    const concurrent = await Promise.all([0, 1].map(async (optionIndex) => (await fetch(endpoint, post({ optionIndex }))).json()))
    assert.deepEqual(concurrent.map((event) => event.revision).sort(), [3, 4])
    assert.equal(db.votes.length, 1)
    assert.equal(db.votes[0].revision, 4)
    assert.equal(db.published.length, 4)
    const history = await (await fetch(`${base}/history`, { headers: { Authorization: 'Bearer valid' } })).json()
    assert.deepEqual(history.rows[0].poll_options, ['House', 'Jazz'])
    assert.deepEqual(history.rows[0].soundspin_poll_votes, [{ user_id: 'alice', option_index: db.votes[0].option_index, revision: 4 }])
  })
})

test('invalid/nonpoll/other-room targets and revoked admission never mutate poll votes', async () => {
  await withRoutes(async (base, db) => {
    const endpoint = `${base}/polls/${id(1)}/vote`
    for (const optionIndex of [-1, 2, 4, 0.5, '1', null]) assert.equal((await fetch(endpoint, post({ optionIndex }))).status, 400)
    db.rows.push({ ...db.rows[0], id: id(3), room_slug: 'private-room' }, { ...db.rows[0], id: id(4), poll_options: null })
    for (const target of [id(3), id(4), id(99), 'invalid']) assert.equal((await fetch(`${base}/polls/${target}/vote`, post({ optionIndex: 0 }))).status, 400)
    assert.equal(db.writes.length, 0)
    db.admission.revokeAfterRead = true
    assert.equal((await fetch(endpoint, post({ optionIndex: 0 }))).status, 403)
    assert.equal(db.writes.length, 0); assert.equal(db.published.length, 0)
  })
})

test('poll creation retries verify immutable option labels without overwriting original questions', async () => {
  await withRoutes(async (base, db) => {
    const poll = input()
    assert.equal((await fetch(`${base}/messages`, post(poll))).status, 200)
    const stored = await loadStoredChatMessage(db.client, poll.id)
    assert.ok(stored)
    assert.equal(stored.message.content, 'What should we play?')
    assert.deepEqual(stored.message.poll, { options: ['House', 'Jazz'] })
    assert.equal((await fetch(`${base}/messages`, post(poll))).status, 200)
    assert.equal((await fetch(`${base}/messages`, post({ ...poll, poll: { options: ['House', 'Rock'] } }))).status, 409)
    assert.equal((await fetch(`${base}/messages`, post({ ...poll, poll: undefined }))).status, 409)
    assert.equal(db.writes.length, 1)
  })
})

test('poll vote rate is bounded per account and room without spending message/reaction capacity', () => {
  let now = Date.now()
  const policy = createChatWritePolicy(() => now)
  for (let i = 0; i < 30; i++) policy.pollVote('lounge', 'alice')
  assert.throws(() => policy.pollVote('lounge', 'alice'), /Too many chat requests/)
  policy.pollVote('lounge', 'bob'); policy.pollVote('other-room', 'alice')
  policy.message('lounge', 'alice', chatMessageSchema.parse(input()))
  policy.reaction('lounge', 'alice', { messageId: id(1), action: 'add', emoji: '❤️' })
  now += 10_000
  policy.pollVote('lounge', 'alice')
})
