import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveChatMediaUrl, signChatHistoryMedia } from './chat-media.js'

const file = '00000000-0000-4000-8000-000000000001.png'
function fixture() {
  const messages: Array<{ room_slug: string; storage_path: string }> = []
  const lookups: Array<Record<string, string>> = [], signed: Array<{ paths: string[]; seconds: number }> = []
  const client = { from() {
    const filters: Record<string, string> = {}
    const query = { select() { return this }, eq(key: string, value: string) { filters[key] = value; return this }, limit() { return this },
      then(resolve: (value: unknown) => unknown) { lookups.push(filters); return Promise.resolve({ data: messages.filter((row) => row.room_slug === filters.room_slug && row.storage_path === filters.storage_path), error: null }).then(resolve) } }
    return query
  }, storage: { from(bucket: string) { assert.equal(bucket, 'chat-media'); return {
    async createSignedUrl(path: string, seconds: number) { signed.push({ paths: [path], seconds }); return { data: { signedUrl: `https://private.test/${path}?signed=1` }, error: null } },
    async createSignedUrls(paths: string[], seconds: number) { signed.push({ paths, seconds }); return { data: paths.map((path) => ({ path, signedUrl: `https://private.test/${path}?signed=1` })), error: null } },
  } } } } as unknown as SupabaseClient
  return { client, messages, lookups, signed }
}

test('malformed, cross-room and other-owner unreferenced paths never reach privileged storage signing', async () => {
  const f = fixture()
  for (const path of ['alice/lounge/../../private.png', 'https://storage.test/object.png', `bob/private-room/${file}`, `alice/private-room/${file}`]) {
    await assert.rejects(resolveChatMediaUrl(f.client, 'lounge', path, 'alice'))
  }
  assert.equal(f.signed.length, 0)
  assert.equal(f.lookups.length, 2)
  assert.equal(f.lookups.every((query) => query.room_slug === 'lounge'), true)
})

test('new owned canonical uploads and referenced legacy same-room paths get only five-minute capabilities', async () => {
  const f = fixture(), owned = `alice/lounge/${file}`, legacy = `bob/soundspin-lounge/${file}`
  const before = Date.now()
  const first = await resolveChatMediaUrl(f.client, 'lounge', owned, 'alice')
  assert.equal(f.lookups.length, 0); assert.equal(f.signed[0].seconds, 300)
  assert.ok(first.expiresAt >= before + 300_000 && first.expiresAt <= Date.now() + 300_000)
  f.messages.push({ room_slug: 'lounge', storage_path: legacy })
  assert.match((await resolveChatMediaUrl(f.client, 'lounge', legacy, 'alice')).url, /signed=1/)
  await assert.rejects(resolveChatMediaUrl(f.client, 'other-room', legacy, 'alice'))
  assert.equal(f.signed.length, 2)
})

test('authorized history signs uploaded paths and clears stale public URLs if signing fails', async () => {
  const f = fixture(), path = `bob/soundspin-lounge/${file}`
  const rows = [{ storage_path: path, media_url: 'https://public.test/old.png' }, { storage_path: null, media_url: 'https://external.test/pasted.gif' }]
  const result = await signChatHistoryMedia(f.client, rows)
  assert.match(result[0].media_url!, /private\.test/)
  assert.equal(result[1].media_url, rows[1].media_url)
  assert.equal(f.signed[0].seconds, 300)
  const broken = { storage: { from: () => ({ createSignedUrls: async () => ({ error: new Error('Storage unavailable'), data: null }) }) } } as unknown as SupabaseClient
  assert.equal((await signChatHistoryMedia(broken, rows))[0].media_url, null)
})
