import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Store } from './store.js'
import { emptyModeration } from '../features/rooms/room-access.js'
import type { Room } from '../types.js'

const deleted = '11111111-1111-4111-8111-111111111111'
const owner = '22222222-2222-4222-8222-222222222222'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

function fixture(hold?: ReturnType<typeof deferred>) {
  const started = deferred()
  let state: Room = { id: 'test-room', name: 'Room', ownerUserId: owner, moderatorUserIds: [], djRoleUserIds: [deleted],
    isPublic: true, passwordProtected: false, settings: { djAccess: 'everyone' }, djUserId: null, djQueueUserIds: [deleted],
    djQueues: { [deleted]: [] }, history: [], playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 }
  let moderation = emptyModeration()
  moderation.members[deleted] = { user: { id: deleted, name: 'Deleted name', avatarSeed: deleted }, role: 'dj', joinedAt: 1 }
  moderation.rulesAcceptance[deleted] = 1
  let erased = false, writes = 0
  const client = {
    rpc(name: string) {
      const promise = (async () => {
        if (name === 'soundspin_moderation_actor_rooms') return { data: erased ? [] : ['test-room'], error: null }
        assert.equal(name, 'soundspin_erase_live_moderation_account')
        started.resolve(); if (hold) await hold.promise
        state = { ...state, djQueueUserIds: [], djQueues: {}, djRoleUserIds: [], settings: { djAccess: 'everyone' } }
        moderation = emptyModeration(); erased = true
        return { data: { state: structuredClone(state), moderation: structuredClone(moderation) }, error: null }
      })()
      return Object.assign(promise, { abortSignal: () => promise })
    },
    from(table: string) {
      let update: { state: Room } | undefined
      const result = () => {
        if (update) { writes++; state = structuredClone(update.state); return { data: { slug: 'test-room' }, error: null } }
        if (table === 'soundspin_rooms') return { data: { state: structuredClone(state), name: state.name, owner_id: owner, is_public: true, password_hash: null, settings: state.settings, access_mode: 'public', policy_revision: 0 }, error: null }
        if (table === 'soundspin_room_moderation') return { data: { data: structuredClone(moderation) }, error: null }
        assert.equal(table, 'soundspin_room_members'); return { data: erased ? [] : [{ user_id: deleted, role: 'dj' }], error: null }
      }
      const query = { select: () => query, eq: () => query, in: () => query, update: (value: { state: Room }) => { update = value; return query },
        maybeSingle: async () => result(), then: (done: (value: ReturnType<typeof result>) => unknown, fail?: (error: unknown) => unknown) => Promise.resolve().then(result).then(done,fail) }
      return query
    }
  } as unknown as SupabaseClient
  return { store: new Store({ supabase: client }), started, get state() { return state }, get writes() { return writes } }
}

test('account room erasure updates the shared cached object before the next queued mutation can persist stale membership', async () => {
  const hold = deferred(), setup = fixture(hold), room = (await setup.store.loadRoom('test-room'))!
  const beforeBytes = setup.store.cachedRoomBytes
  assert.ok(room.moderation!.members[deleted]); assert.ok(room.djRoleUserIds.includes(deleted))
  let broadcasts = 0
  const erasing = setup.store.eraseAccountRoomData(deleted, updated => { broadcasts++; assert.equal(updated, room); assert.equal(updated.moderation!.members[deleted], undefined) })
  await setup.started.promise
  let nextRan = false
  const next = setup.store.changeRoom(room, draft => {
    nextRan = true
    assert.equal(draft.moderation!.members[deleted], undefined)
    assert.equal(draft.moderation!.rulesAcceptance[deleted], undefined)
    assert.equal(draft.djQueues[deleted], undefined)
    assert.equal(draft.djRoleUserIds.includes(deleted), false)
    draft.name = 'Updated'; return { result: undefined }
  })
  await Promise.resolve(); assert.equal(nextRan, false)
  hold.resolve(); await Promise.all([erasing,next])
  assert.equal(setup.store.getRoom('test-room'), room)
  assert.equal(setup.writes, 1); assert.equal(broadcasts, 1)
  assert.equal(JSON.stringify(setup.state).includes(deleted), false)
  assert.ok(setup.store.cachedRoomBytes < beforeBytes)
})

test('account room erasure coalesces an in-flight room load and rejects invalid document responses without retaining stale cache', async () => {
  const setup = fixture()
  const loading = setup.store.loadRoom('test-room')
  await setup.store.eraseAccountRoomData(deleted)
  const room = await loading
  assert.equal(room!.moderation!.members[deleted], undefined)
  assert.equal(setup.store.getRoom('test-room'),room)
  const broken = fixture()
  const cached = await broken.store.loadRoom('test-room')
  const client = (broken.store as unknown as { supabase: { rpc: (name: string) => unknown } }).supabase
  client.rpc = name => { const promise = Promise.resolve({ data: name === 'soundspin_moderation_actor_rooms' ? ['test-room'] : { state: null, moderation: {} }, error: null }); return Object.assign(promise,{ abortSignal: () => promise }) }
  await assert.rejects(broken.store.eraseAccountRoomData(deleted), /invalid document/)
  assert.equal(broken.store.getRoom('test-room'),undefined)
  await assert.rejects(broken.store.changeRoom(cached!, () => ({ result: undefined })), /session changed/)
})
