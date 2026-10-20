import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import express from 'express'
import { PGlite } from '@electric-sql/pglite'
import { ChatPinService, type ChatPinServiceOptions } from './chat-pin-service.js'
import type { DurableChatRecord } from './chat-command-service.js'
import { PublicRequestError } from '../../lib/public-request-error.js'
import { CHAT_MAX_PINS } from '../../../shared/chat-pins.js'
import { mountChatPinRoutes } from './chat-pin-routes.js'

const staff = '11111111-1111-4111-8111-111111111111'
const listener = '22222222-2222-4222-8222-222222222222'
const now = Date.parse('2026-10-20T10:00:00Z')

test('moderators persist pins, retries stay idempotent, and removed or foreign messages never appear', async () => {
  const tempRoot = path.resolve('work')
  await mkdir(tempRoot, { recursive: true })
  const dir = await mkdtemp(path.join(tempRoot, 'chat-pins-'))
  const records = new Map<string, DurableChatRecord>()
  const add = (roomId = 'lounge') => {
    const id = randomUUID()
    records.set(id, { roomId, userId: listener, fingerprint: 'unused', message: {
      id, type: 'text', content: 'A recommendation', createdAt: new Date(now).toISOString(), mentions: [],
      user: { id: listener, name: 'Listener', avatarSeed: listener },
    } })
    return id
  }
  let admitted = true
  const events: string[] = []
  const options: ChatPinServiceOptions = {
    client: null, dataDir: dir, now: () => now,
    authorizeRead: async room => { if (!admitted || room !== 'lounge') throw new PublicRequestError('Join this room.', 403) },
    authorizeManage: async (room, user) => { if (!admitted || room !== 'lounge' || user !== staff) throw new PublicRequestError('Only moderators can pin messages.', 403) },
    loadMessage: async id => records.get(id) || null,
    onChanged: async (_room, event) => { events.push(`${event.messageId}:${event.pinned}`) },
  }
  try {
    const pins = new ChatPinService(options)
    const id = add()
    await assert.rejects(pins.setPinned('lounge', listener, id, true), /Only moderators/)
    await pins.setPinned('lounge', staff, id, true)
    await pins.setPinned('lounge', staff, id, true)
    assert.equal(events.length, 1)
    assert.deepEqual((await new ChatPinService(options).list('lounge', listener)).map(pin => pin.messageId), [id])
    const saved = await readFile(path.join(dir, 'soundspin-chat-pins.json'), 'utf8')
    assert.ok(!saved.includes('A recommendation'), 'pin storage does not duplicate message content')
    await assert.rejects(pins.setPinned('lounge', staff, add('elsewhere'), true), /unavailable/)
    records.get(id)!.removedAt = new Date(now).toISOString()
    assert.deepEqual(await pins.list('lounge', listener), [])
    for (let index = 0; index < CHAT_MAX_PINS; index++) await pins.setPinned('lounge', staff, add(), true)
    const replacement = add()
    await assert.rejects(pins.setPinned('lounge', staff, replacement, true), /Unpin one first/)
    const oldPin = (await pins.list('lounge', listener))[0].messageId
    await pins.setPinned('lounge', staff, oldPin, false)
    await pins.setPinned('lounge', staff, oldPin, false)
    await pins.setPinned('lounge', staff, replacement, true)
    assert.equal((await pins.list('lounge', listener)).length, CHAT_MAX_PINS)
    admitted = false
    await assert.rejects(pins.list('lounge', listener), /Join this room/)
    await assert.rejects(pins.setPinned('lounge', staff, replacement, false), /Only moderators/)
  } finally {
    assert.ok(dir.startsWith(`${tempRoot}${path.sep}`))
    await rm(dir, { recursive: true, force: true })
  }
})

test('database pins reject direct client access, serialize bounds, and disappear when a message is removed', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.soundspin_messages(id uuid primary key, room_slug text, removed_at timestamptz);
      grant select, insert, update, delete on public.soundspin_messages to service_role;
    `)
    const migration = fileURLToPath(new URL('../../../supabase/migrations/20261020121000_chat_pins.sql', import.meta.url))
    await db.exec(await readFile(migration, 'utf8'))
    const id = randomUUID()
    await db.query('insert into public.soundspin_messages(id,room_slug) values ($1,$2)', [id, 'lounge'])
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select * from public.soundspin_chat_pins'), /permission denied/)
    await assert.rejects(db.query('select public.soundspin_set_chat_pin($1,$2,$3,true)', ['lounge', staff, id]), /permission denied/)
    await db.exec('reset role; set role service_role')
    const set = (room: string, message: string, pinned = true) => db.query<{ changed: boolean }>(
      'select public.soundspin_set_chat_pin($1,$2,$3,$4) as changed', [room, staff, message, pinned])
    assert.equal((await set('lounge', id)).rows[0].changed, true)
    assert.equal((await set('lounge', id)).rows[0].changed, false)
    await assert.rejects(set('other-room', id), /unavailable/)
    for (let index = 1; index <= CHAT_MAX_PINS; index++) {
      const next = randomUUID()
      await db.query('insert into public.soundspin_messages(id,room_slug) values ($1,$2)', [next, 'lounge'])
      if (index < CHAT_MAX_PINS) await set('lounge', next)
      else await assert.rejects(set('lounge', next), /Unpin one first/)
    }
    await db.query('update public.soundspin_messages set removed_at=now() where id=$1', [id])
    assert.equal((await db.query('select 1 from public.soundspin_chat_pins where message_id=$1', [id])).rows.length, 0)
    await assert.rejects(set('lounge', id), /unavailable/)
    assert.equal((await set('lounge', id, false)).rows[0].changed, false)
  } finally { await db.close() }
})

test('pin routes require room admission and withhold a response when access ends during a read', async () => {
  const app = express()
  let admission = true
  let expiryDuringRead = false
  const pins = new ChatPinService({ client: null,
    authorizeRead: async () => {}, authorizeManage: async () => {}, loadMessage: async () => null,
  })
  mountChatPinRoutes(app, { pins,
    getUserId: async request => request.headers.authorization === 'Bearer staff' ? staff : null,
    canReadRoom: async () => admission,
    readMessages: async () => {
      if (expiryDuringRead) admission = false
      return { rows: [], replies: [], profiles: [] }
    },
  })
  // Empty database mode avoids touching local persistence in this route-only fixture.
  pins.list = async () => []
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/rooms/lounge/chat/pins`
  try {
    assert.equal((await fetch(url)).status, 401)
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer staff' } })).status, 200)
    expiryDuringRead = true
    const expired = await fetch(url, { headers: { authorization: 'Bearer staff' } })
    assert.equal(expired.status, 403)
    assert.ok(!JSON.stringify(await expired.json()).includes('rows'))
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
