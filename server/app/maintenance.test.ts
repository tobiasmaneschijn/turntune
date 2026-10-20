import assert from 'node:assert/strict'
import test from 'node:test'
import { createMaintenance } from './maintenance.js'
import { DEFAULT_GLOBAL_LIMITS } from '../../shared/resource-policy.js'
import { telemetry } from '../observability/index.js'

test('connection maintenance retries a failed batch and removes only newly restricted accounts and rooms', async t => {
  const intervals = new Map<number, () => void>()
  t.mock.method(globalThis, 'setInterval', (callback: () => void, milliseconds: number) => {
    intervals.set(milliseconds, callback)
    return { unref() {} } as NodeJS.Timeout
  })
  t.mock.method(globalThis, 'clearInterval', () => {})
  t.mock.method(console, 'log', () => {})
  const incidents: string[] = []
  t.mock.method(telemetry, 'captureError', (_error: unknown, context: { operation: string }) => { incidents.push(context.operation) })
  const removedAccounts: string[] = [], removedRooms: string[] = []
  let calls = 0
  const maintenance = createMaintenance({
    supabaseAdmin: null, authEnabled: true, accountDeletion: null,
    platform: { async checkConnections(accounts, rooms) {
      calls++
      assert.deepEqual(accounts, ['active', 'suspended', 'unknown'])
      assert.deepEqual(rooms, ['open-room', 'disabled-room'])
      if (calls === 1) throw new Error('Temporary upstream failure')
      return { accounts: new Map([['active', true], ['suspended', false]]), rooms: new Map([['open-room', true], ['disabled-room', false]]) }
    } },
    resourcePolicies: { getGlobal: async () => DEFAULT_GLOBAL_LIMITS },
    isShuttingDown: () => false,
    connectedAccountIds: () => ['active', 'suspended', 'active', 'unknown'],
    cachedRoomIds: () => ['open-room', 'disabled-room', 'open-room'],
    restrictAccount: async id => { removedAccounts.push(id) },
    restrictRoom: async id => { removedRooms.push(id) },
    updateResourcePolicy() {}
  })
  maintenance.start()
  t.after(() => maintenance.stop())
  const check = intervals.get(20_000)!
  check(); check()
  await maintenance.drain()
  assert.equal(calls, 1, 'an unfinished check does not start another batch')
  assert.deepEqual(incidents, ['maintenance.connections.check'])
  assert.deepEqual(removedAccounts, []); assert.deepEqual(removedRooms, [])
  check()
  await maintenance.drain()
  assert.equal(calls, 2)
  assert.equal(incidents.length, 1, 'successful recovery does not report another incident')
  assert.deepEqual(removedAccounts, ['suspended'], 'unknown identities wait for the next check'); assert.deepEqual(removedRooms, ['disabled-room'])
})
