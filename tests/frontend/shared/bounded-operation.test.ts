import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedOperation } from '../../../src/lib/bounded-operation'


test('cancelling an upload cannot turn a late response into a completed action', async () => {
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
