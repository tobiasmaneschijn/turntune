import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { prepareUploadedChatImage } from '../src/chat/image-upload'

const file = new File(['image'], 'draft.png', { type: 'image/png' })

test('Cancelling an image upload prevents a late result from sending the image', async () => {
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
