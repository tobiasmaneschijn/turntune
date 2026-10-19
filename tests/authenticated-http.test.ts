import assert from 'node:assert/strict'
import test from 'node:test'
import { requestJson } from '../src/lib/authenticated-http'


test('listeners can retry a timed-out request using their current account', async () => {
  const hanging: typeof fetch = async (_path, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
  })
  const keepAlive = setTimeout(() => {}, 1000)
  try { await assert.rejects(requestJson('/api/example', { timeoutMs: 5 }, hanging), /request timed out.*try again/i) }
  finally { clearTimeout(keepAlive) }
  let authorization: string | null = null
  const result = await requestJson('/api/example', { accessToken: 'current-account-token' }, async (_path, options) => {
    authorization = new Headers(options?.headers).get('authorization')
    return Response.json({ saved: true })
  })
  assert.deepEqual(result, { saved: true })
  assert.equal(authorization, 'Bearer current-account-token')
})

test('leaving a page cancels its response without reporting corrupt data', async () => {
  const controller = new AbortController()
  let reading!: () => void
  const bodyStarted = new Promise<void>((resolve) => { reading = resolve })
  const pending = requestJson('/api/example', { signal: controller.signal }, async (_path, options) => {
    const response = Response.json({ value: 'ok' })
    response.json = () => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      reading()
    })
    return response
  })
  await bodyStarted
  const reason = new DOMException('The profile page closed', 'AbortError')
  controller.abort(reason)
  await assert.rejects(pending, (error) => error === reason)
})
