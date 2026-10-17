import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ResourcePolicyStore } from './resource-policy.js'
import { defaultResourcePolicy, globalLimitsSchema, planLimitsSchema } from '../shared/resource-policy.js'

test('account limits remain isolated, share concurrent reads, and refresh safely after a plan changes', async () => {
  let now = 0, reads = 0, fail = false
  const paid = defaultResourcePolicy(); paid.plan = 'supporter'; paid.limits.ownedRooms = 20
  const client = { rpc(_name: string, args: {p_actor: string | null}) {
    reads++
    return { abortSignal: async () => fail ? { error: new Error('offline'), data: null } : { error: null, data: args.p_actor === 'alice' ? structuredClone(paid) : defaultResourcePolicy() } }
  } } as unknown as SupabaseClient
  const policies = new ResourcePolicyStore(client, { now: () => now, ttlMs: 100, capacity: 2 })
  const [first, parallel] = await Promise.all([policies.getAccount('alice'), policies.getAccount('alice')])
  assert.equal(reads, 1); assert.equal(first.limits.ownedRooms, 20); assert.equal(parallel.plan, 'supporter')
  first.limits.ownedRooms = 99
  assert.equal((await policies.getAccount('alice')).limits.ownedRooms, 20)
  assert.equal((await policies.getAccount('bob')).limits.ownedRooms, 10)
  now = 101; fail = true
  await assert.rejects(policies.getAccount('alice'), /unavailable/)
  fail = false; paid.limits.ownedRooms = 5
  assert.equal((await policies.getAccount('alice')).limits.ownedRooms, 5)
  paid.limits.ownedRooms = 7; policies.invalidate('alice')
  assert.equal((await policies.getAccount('alice')).limits.ownedRooms, 7)
})

test('invalid or missing hosted configuration cannot grant extra capacity; local mode uses fresh defaults', async () => {
  const invalid = defaultResourcePolicy(); invalid.limits.queueTracksTotal = 0
  const client = { rpc: () => ({ abortSignal: async () => ({ error: null, data: invalid }) }) } as unknown as SupabaseClient
  await assert.rejects(new ResourcePolicyStore(client).get('alice'))
  assert.equal(planLimitsSchema.safeParse({ ...defaultResourcePolicy().limits, untrustedExtra: 1 }).success, false)
  assert.equal(globalLimitsSchema.safeParse({ ...defaultResourcePolicy().global, socketsTotal: 1001 }).success, false)
  const local = new ResourcePolicyStore(null)
  const limits = await local.get('alice'); limits.limits.ownedRooms = 99
  assert.equal((await local.get('alice')).limits.ownedRooms, 10)
})
