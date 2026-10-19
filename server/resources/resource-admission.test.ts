import assert from 'node:assert/strict'
import test from 'node:test'
import { SecurityBudget } from '../security/security-budget.js'
import { ResourceAdmission } from './resource-admission.js'
import { defaultResourcePolicy } from '../../shared/resource-policy.js'

test('a listener reaching the room change limit can still remove tracks and control playback, then add again after refill',async()=>{
  let now=1000
  const admission=new ResourceAdmission(new SecurityBudget(()=>now))
  const policy=defaultResourcePolicy()
  policy.limits.roomWriteBurst=2
  const change=()=>Promise.resolve('saved')
  assert.equal(await admission.roomAction('queue:add','listener','room',policy,change),'saved')
  assert.equal(await admission.roomAction('queue:add','listener','room',policy,change),'saved')
  await assert.rejects(admission.roomAction('queue:add','listener','room',policy,change),/Too many requests/)
  assert.equal(await admission.roomAction('queue:remove','listener','room',policy,change),'saved')
  assert.equal(await admission.roomAction('playback:update','listener','room',policy,change),'saved')
  assert.equal(await admission.roomAction('queue:add','other','room',policy,change),'saved')
  now+=1000
  assert.equal(await admission.roomAction('queue:add','listener','room',policy,change),'saved')
})

test('a listener cannot start parallel imports across rooms and can retry after failure without losing the concurrency slot',async()=>{
  let now=1000
  const admission=new ResourceAdmission(new SecurityBudget(()=>now))
  const policy=defaultResourcePolicy()
  let release!:()=>void
  const first=admission.importSet('listener',policy,()=>new Promise<void>(resolve=>{release=resolve}))
  await Promise.resolve()
  await assert.rejects(admission.importSet('listener',policy,async()=>{}),/Too many requests/)
  release();await first
  await assert.rejects(admission.importSet('listener',policy,async()=>{throw new Error('Provider unavailable')}),/Provider unavailable/)
  await assert.rejects(admission.importSet('listener',policy,async()=>{}),/Too many requests/)
  now+=60_000
  await admission.importSet('listener',policy,async()=>{})
})
