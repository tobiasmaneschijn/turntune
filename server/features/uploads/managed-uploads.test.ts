import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { Request, Response } from 'express'
import express from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managedUploadAdmission, reserveManagedUpload, uploadReservedImage, validateUploadImage, cleanupManagedUploads, type UploadLease } from './managed-uploads.js'
import { validateFeedbackSubmission } from '../feedback/feedback-routes.js'
import { mountFeedbackRoutes } from '../feedback/feedback-routes.js'
import { mountManagedUploadRoutes } from './upload-routes.js'
import { PublicRequestError } from '../../lib/public-request-error.js'
const actor = '11111111-1111-4111-8111-111111111111'
const png = () => sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer()

test('trusted validation fully decodes allowed images and rejects signature-only, mixed MIME, and excessive dimensions', async () => {
  const bytes = await png()
  assert.equal((await validateUploadImage(bytes, 'image/png', 'avatar')).bytes, bytes)
  await assert.rejects(validateUploadImage(bytes.subarray(0, 8), 'image/png', 'chat'), /complete/)
  await assert.rejects(validateUploadImage(bytes, 'image/jpeg', 'avatar'), /complete/)
  const giant = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'white' } }).png().toBuffer()
  await assert.rejects(validateUploadImage(giant, 'image/png', 'avatar'), /complete/)
  const animated = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).gif({ delay: [100, 100] }).toBuffer()
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2)
  await assert.rejects(validateUploadImage(animated, 'image/gif', 'chat'), /static/)
  await assert.rejects(validateUploadImage(Buffer.from('<svg/>'), 'image/svg+xml', 'avatar'), /Choose/)
})
test('valid two-frame APNG is rejected for every purpose while static PNG with acTL text still uploads', async () => {
  const animated = await readFile(new URL('../../../tests/fixtures/security-images/two-frame-16px.apng', import.meta.url))
  const metadata = await sharp(animated, { animated: true }).metadata()
  assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 16); assert.equal(metadata.height, 16)
  const still = await readFile(new URL('../../../tests/fixtures/security-images/static-acTL-text.png', import.meta.url))
  assert.equal(still.includes(Buffer.from('acTL')), true)
  for (const purpose of ['avatar', 'feedback', 'chat'] as const) {
    await assert.rejects(validateUploadImage(animated, 'image/png', purpose), /static/)
    assert.equal((await validateUploadImage(still, 'image/png', purpose)).bytes, still)
  }
  let writes = 0, queued = 0
  const client = { rpc: async () => { queued++; return { error: null } }, storage: { from: () => ({ upload: async () => { writes++; return { error: null } } }) } } as unknown as SupabaseClient
  const lease: UploadLease = { id: crypto.randomUUID(), actor_id: actor, purpose: 'chat', bucket_id: 'chat-media', storage_path: `${actor}/lounge/${crypto.randomUUID()}.png`, size_bytes: animated.length, room_slug: 'lounge', state: 'reserved' }
  await assert.rejects(uploadReservedImage(client, lease, animated, 'image/png', async () => {}), /static/)
  assert.equal(writes, 0); assert.equal(queued, 1)
})
test('failed quota reservation never uploads; post-upload reservation cancellation persists compensating key', async () => {
  let uploads = 0, queues = 0
  const client = { rpc: async (name: string) => {
    if (name === 'soundspin_reserve_upload') return { error: { code: 'P0001', message: 'Too many uploads. Try again in an hour.' } }
    if (name === 'soundspin_finish_upload') return { error: { code: 'P0001', message: 'This upload reservation has ended.' } }
    queues++; return { error: null }
  }, storage: { from: () => ({ upload: async () => { uploads++; return { error: null } } }) } } as unknown as SupabaseClient
  await assert.rejects(reserveManagedUpload(client, actor, 'avatar', 10, 'image/png'), /Too many/)
  assert.equal(uploads, 0)
  const bytes = await png(), lease: UploadLease = { id: crypto.randomUUID(), actor_id: actor, purpose: 'avatar', bucket_id: 'profile-avatars', storage_path: `${actor}/${crypto.randomUUID()}.png`, size_bytes: bytes.length, room_slug: null, state: 'reserved' }
  await assert.rejects(uploadReservedImage(client, lease, bytes, 'image/png', async () => {}), /reservation/)
  assert.equal(uploads, 1); assert.equal(queues, 1)
})
test('anonymous upload is rejected before raw parser/reservation/decoder', async () => {
  let parsed = 0, reserved = 0, status = 0
  const middleware = managedUploadAdmission({ client: { rpc: async () => { reserved++; return {} } } as unknown as SupabaseClient, purpose: 'avatar', getUserId: async () => null })
  const request = { get: () => '6291456' } as unknown as Request
  const response = { setHeader() {}, status(value: number) { status = value; return this }, json() {} } as unknown as Response
  await middleware(request, response, () => { parsed++ })
  assert.equal(status, 401); assert.equal(parsed, 0); assert.equal(reserved, 0)
})
test('exhausted durable upload budget rejects before the raw parser', async () => {
  let parsed = 0, status = 0
  const middleware = managedUploadAdmission({ client: { rpc: async () => ({ error: { code: 'P0001', message: 'Too many uploads. Try again in an hour.' } }) } as unknown as SupabaseClient, purpose: 'avatar', getUserId: async () => actor })
  const request = { get: (header: string) => header === 'content-length' ? '100' : 'image/png' } as unknown as Request
  const response = { setHeader() {}, status(value: number) { status = value; return this }, json() {} } as unknown as Response
  await middleware(request, response, () => { parsed++ })
  assert.equal(status, 429); assert.equal(parsed, 0)
})
test('admission separates deliberate permission errors from internal database text', async () => {
  const secret = 'Too many SQL SELECT refresh_token_ciphertext signed=https://internal.test/key?token=secret'
  for (const [error, expected] of [[new Error(secret), 503], [new PublicRequestError('This room does not allow media.', 403), 403]] as const) {
    let status = 0, payload: unknown, parsed = false
    const middleware = managedUploadAdmission({ client: {} as SupabaseClient, purpose: 'chat', getUserId: async () => actor, check: async () => { throw error } })
    const response = { setHeader() {}, status(value: number) { status = value; return this }, json(value: unknown) { payload = value } } as unknown as Response
    await middleware({} as Request, response, () => { parsed = true })
    assert.equal(status, expected); assert.equal(parsed, false)
    assert.equal(JSON.stringify(payload).includes('secret'), false)
    assert.equal(JSON.stringify(payload).includes('SELECT'), false)
  }
})

test('upload and feedback HTTP routes suppress Storage/SQL errors while keeping exact quota rejections', async () => {
  const secret = 'Too many SQL SELECT refresh_token_ciphertext signed=https://internal.test/key?token=secret'
  let feedbackError: unknown = { code: 'P0001', message: secret }
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === 'soundspin_reserve_upload') return { data: { id: args.p_id, actor_id: args.p_actor, purpose: args.p_purpose, bucket_id: args.p_bucket, storage_path: args.p_path, size_bytes: args.p_bytes, room_slug: args.p_room, state: 'reserved' }, error: null }
    if (name === 'soundspin_submit_feedback') return { error: feedbackError }
    return { error: null }
  }, storage: { from: () => ({ upload: async () => ({ error: new Error(secret) }) }) } } as unknown as SupabaseClient
  const app = express(); mountManagedUploadRoutes(app, { client, getUserId: async () => actor }); mountFeedbackRoutes(app, { client, getUserId: async () => actor })
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`
    const upload = await fetch(`${base}/api/uploads/avatar`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: await png() })
    assert.equal(upload.status, 503); assert.equal((await upload.text()).includes('secret'), false)
    const body = { id: crypto.randomUUID(), message: 'Report', screenshot_paths: [], room_slug: null, page_path: '/', viewport: { width: 100, height: 100 }, category: 'bug', impact: 'minor', diagnostics: {} }
    const send = () => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const unknown = await send(); assert.equal(unknown.status, 503); assert.equal((await unknown.text()).includes('secret'), false)
    feedbackError = { code: 'P0001', message: 'Too many feedback submissions. Try again in an hour.' }
    const limited = await send(); assert.equal(limited.status, 429); assert.match(await limited.text(), /Try again in an hour/)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
test('feedback schema rejects forged actors, oversized/nested attachments, unrelated paths, and invalid viewport', () => {
  const valid = { id: crypto.randomUUID(), message: 'Report', screenshot_paths: [], room_slug: null, page_path: '/', viewport: { width: 100, height: 100 }, category: 'bug', impact: 'minor', diagnostics: {} }
  assert.equal(validateFeedbackSubmission(valid, actor).message, 'Report')
  for (const value of [{ ...valid, user_id: actor }, { ...valid, screenshot_paths: [null] }, { ...valid, screenshot_paths: [['x']] }, { ...valid, screenshot_paths: [`other/${crypto.randomUUID()}.png`] }, { ...valid, page_path: '/?token=secret' }, { ...valid, viewport: { width: 100, height: -1 } }, { ...valid, diagnostics: { text: 'a'.repeat(16385) } }])
    assert.throws(() => validateFeedbackSubmission(value, actor))
})

test('cleanup drains 1000 durable keys in bounded batches and exposes backlog signals', async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ bucket_id: 'profile-avatars', storage_path: `${actor}/${index}.png`, queued_at: new Date(0).toISOString(), available_at: new Date(0).toISOString(), attempts: 0, generation: crypto.randomUUID() }))
  let removals = 0
  const client = { rpc: async (name: string, args: {p_items?: Array<{path: string; generation: string}>}) => {
    if (name !== 'soundspin_complete_upload_deletions') return { error: null }
    let n = 0
    for (const item of args.p_items || []) { const index = rows.findIndex(row => row.storage_path === item.path && row.generation === item.generation); if (index >= 0) { rows.splice(index, 1); n++ } }
    return { data: n, error: null }
  }, storage: { from: () => ({ remove: async (paths: string[]) => { removals++; assert.ok(paths.length <= 100); return { error: null } } }) },
    from(table: string) {
      let action = 'select', paths: string[] = [], limit = 100, head = false
      const query = { select(_columns: string, options?: { head?: boolean }) { head = Boolean(options?.head); return this }, lte() { return this }, order() { return this }, limit(value: number) { limit = value; return this }, update() { action = 'update'; return this }, delete() { action = 'delete'; return this }, eq(key: string, value: string) { if (key === 'storage_path') paths = [value]; return this }, lt() { return this }, in(_key: string, value: string[]) { paths = value; return this },
        then(resolve: (value: unknown) => unknown) {
          const acknowledged = table === 'soundspin_storage_deletion_outbox' && action === 'delete' ? rows.filter(row => paths.includes(row.storage_path)) : []
          if (table === 'soundspin_storage_deletion_outbox' && action === 'delete') for (let i = rows.length - 1; i >= 0; i--) if (paths.includes(rows[i].storage_path)) rows.splice(i, 1)
          return Promise.resolve({ data: action === 'delete' ? acknowledged : table === 'soundspin_storage_deletion_outbox' && action === 'select' ? rows.slice(0, limit) : [], count: head ? rows.length : null, error: null }).then(resolve)
        } }
      return query
    } } as unknown as SupabaseClient
  const first = await cleanupManagedUploads(client, { maxBatches: 3 })
  assert.equal(first.removed, 300); assert.equal(first.remaining, 700); assert.equal(first.oldestAt, new Date(0).toISOString())
  const second = await cleanupManagedUploads(client)
  assert.equal(second.removed, 700); assert.equal(second.remaining, 0); assert.equal(removals, 10)
})
