import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedOperation, scopedFetch } from '../src/lib/bounded-operation'

test('a stalled adapter is bounded and receives a genuinely aborted transport signal', async () => {
  let signal: AbortSignal | undefined
  await assert.rejects(boundedOperation((value) => { signal = value; return new Promise(() => {}) }, { timeoutMs: 10 }), { name: 'TimeoutError' })
  assert.equal(signal?.aborted, true)
})

test('cancelled operations ignore late successful results and release their caller', async () => {
  const controller = new AbortController()
  let finish: ((value: string) => void) | undefined
  let confirmed = false
  const result = boundedOperation(() => new Promise<string>((resolve) => { finish = resolve }), { signal: controller.signal, timeoutMs: 1000 }).then(() => { confirmed = true })
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
  finish?.('late result')
  await Promise.resolve()
  assert.equal(confirmed, false)
})

test('scoped fetch preserves existing cancellation and combines it with operation cancellation', async () => {
  const operation = new AbortController()
  const request = new AbortController()
  let received: AbortSignal | null | undefined
  const scoped = scopedFetch(operation.signal, async (_input, init) => { received = init?.signal; return new Response() })
  await scoped('https://example.test/object', { signal: request.signal })
  operation.abort()
  assert.equal(received?.aborted, true)
  const second = new AbortController()
  const third = new AbortController()
  await scopedFetch(second.signal, async (_input, init) => { received = init?.signal; return new Response() })('https://example.test/object', { signal: third.signal })
  third.abort()
  assert.equal(received?.aborted, true)
})
