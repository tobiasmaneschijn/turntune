import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { prepareUploadedChatImage } from '../src/chat/image-upload'

const file = new File(['image'], 'draft.png', { type: 'image/png' })
test('stalled upload cancels its fetch, never resolves or sends media, and bounds separate cleanup', async () => {
  const signals: AbortSignal[] = []
  let resolveCalls = 0
  const clientFactory = async (signal: AbortSignal) => {
    signals.push(signal)
    return { storage: { from: () => ({ upload: () => new Promise(() => {}), remove: () => new Promise(() => {}) }) } } as unknown as Pick<SupabaseClient, 'storage'>
  }
  await assert.rejects(prepareUploadedChatImage({ clientFactory, file, storagePath: 'owner/room/image.png', signal: new AbortController().signal, uploadTimeoutMs: 10, cleanupTimeoutMs: 10, resolve: async () => { resolveCalls++; return 'https://example.test/image' } }), { name: 'TimeoutError' })
  assert.equal(signals[0].aborted, true)
  assert.equal(resolveCalls, 0)
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(signals[1].aborted, true)
})

test('cancelled late upload cannot resolve a URL or produce a send, and cleanup cannot mask its error', async () => {
  const controller = new AbortController()
  let complete: ((result: { error: null }) => void) | undefined
  let resolveCalls = 0
  const clientFactory = async () => ({ storage: { from: () => ({ upload: () => new Promise((resolve) => { complete = resolve }), remove: async () => { throw new Error('Cleanup denied') } }) } }) as unknown as Pick<SupabaseClient, 'storage'>
  const operation = prepareUploadedChatImage({ clientFactory, file, storagePath: 'owner/room/image.png', signal: controller.signal, resolve: async () => { resolveCalls++; return 'https://example.test/image' } })
  await Promise.resolve(); await Promise.resolve()
  controller.abort()
  await assert.rejects(operation, { name: 'AbortError' })
  complete?.({ error: null })
  await Promise.resolve()
  assert.equal(resolveCalls, 0)
})
