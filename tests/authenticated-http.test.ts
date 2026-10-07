import assert from 'node:assert/strict'
import test from 'node:test'
import { requestJson } from '../src/lib/authenticated-http'

test('authenticated HTTP requests validate JSON and preserve the caller deadline and cancellation', async () => {
  let observed: RequestInit | undefined
  const valid = await requestJson<{ value: string }>('/api/example', { accessToken: 'current-token', method: 'POST', body: '{}',
    validate: (value): value is { value: string } => Boolean(value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') },
  async (_path, options) => { observed = options; return Response.json({ value: 'ok' }) })
  assert.equal(valid.value, 'ok')
  assert.equal(new Headers(observed?.headers).get('authorization'), 'Bearer current-token')
  assert.equal(new Headers(observed?.headers).get('content-type'), 'application/json')
  await assert.rejects(requestJson('/api/example', { validate: (value): value is object => Boolean(value && typeof value === 'object' && 'value' in value) },
    async () => Response.json({ unrelated: true })), /invalid response/i)
  await assert.rejects(requestJson('/api/example', {}, async () => new Response('<html>upstream failed</html>', { status: 502 })), /could not be completed/i)
  const controller = new AbortController()
  const request = requestJson('/api/example', { signal: controller.signal }, async (_path, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
  }))
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
})

test('hung API calls receive retryable timeout copy and never leak non-string error payloads', async () => {
  const hanging: typeof fetch = async (_path, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
  })
  // Keep Node alive while its unref'ed AbortSignal timeout runs.
  const keepAlive = setTimeout(() => {}, 1000)
  try { await assert.rejects(requestJson('/api/example', { timeoutMs: 5 }, hanging), /request timed out.*try again/i) }
  finally { clearTimeout(keepAlive) }
  await assert.rejects(requestJson('/api/example', {}, async () => Response.json({ error: { internal: 'opaque' } }, { status: 400 })), /could not be completed/i)
})

test('cancellation while reading a response body preserves its reason instead of reporting malformed JSON', async () => {
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
