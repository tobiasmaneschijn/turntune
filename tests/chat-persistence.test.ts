import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadChatHistory, saveChatMessage, persistReactionChange, CHAT_HISTORY_LIMIT } from '../src/chat/persistence.js'
import type { ChatMessage } from '../src/chat/model.js'

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, content: `Message ${id}`, message_type: 'text', media_url: null, storage_path: null,
    mentions: [], user_id: 'listener-1', user_name: 'Original name', avatar_seed: 'original-seed',
    created_at: '2026-10-06T10:00:00.000Z', reply_to_id: null, soundspin_message_reactions: [],
    ...overrides,
  }
}

function fakeDatabase(results: Array<{ data?: unknown; error?: unknown }>) {
  const calls: Array<{ table: string; operations: Array<[string, ...unknown[]]> }> = []
  const client = {
    from(table: string) {
      const result = results.shift()
      if (!result) throw new Error(`Unexpected query for ${table}`)
      const call = { table, operations: [] as Array<[string, ...unknown[]]> }
      calls.push(call)
      const builder: Record<string, unknown> = {
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      for (const operation of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'delete', 'maybeSingle']) {
        builder[operation] = (...args: unknown[]) => { call.operations.push([operation, ...args]); return builder }
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

test('history fetches reply previews outside its window using a bounded room-scoped query', async () => {
  const database = fakeDatabase([
    { data: [row('recent', { reply_to_id: 'older' })], error: null },
    { data: [row('older', { content: 'Old reply target', user_id: 'listener-2' })], error: null },
    { data: [
      { user_id: 'listener-1', display_name: 'Current name', is_app_admin: false, avatar_key: 'orbit', avatar_url: null },
      { user_id: 'listener-2', display_name: 'Old author', is_app_admin: true, avatar_key: 'pulse', avatar_url: null },
    ], error: null },
  ])
  const history = await loadChatHistory(database.client, 'lounge')
  assert.equal(history.length, 1)
  assert.equal(history[0].replyTo?.content, 'Old reply target')
  assert.equal(history[0].replyTo?.user.isAppAdmin, true)
  assert.equal(history[0].user.name, 'Original name')
  assert.equal(history[0].user.avatarKey, 'orbit')
  assert.ok(database.calls[0].operations.some(([operation, value]) => operation === 'limit' && value === CHAT_HISTORY_LIMIT))
  assert.ok(database.calls[1].operations.some(([operation, column, value]) => operation === 'eq' && column === 'room_slug' && value === 'lounge'))
  assert.deepEqual(database.calls[1].operations.find(([operation]) => operation === 'in'), ['in', 'id', ['older']])
  assert.deepEqual(database.calls[2].operations.find(([operation]) => operation === 'in'), ['in', 'user_id', ['listener-1', 'listener-2']])
})

test('unavailable profiles and reply previews preserve core history and safe defaults', async () => {
  const database = fakeDatabase([
    { data: [row('recent', { reply_to_id: 'deleted' })], error: null },
    { data: null, error: { message: 'Preview unavailable' } },
    { data: null, error: { message: 'Profile unavailable' } },
  ])
  const history = await loadChatHistory(database.client, 'lounge')
  assert.equal(history[0].content, 'Message recent')
  assert.equal(history[0].replyTo, undefined)
  assert.equal(history[0].user.avatarSeed, 'original-seed')
  assert.equal(history[0].user.isAppAdmin, undefined)
})

test('persisted media cannot reintroduce unsafe clickable URLs', async () => {
  const database = fakeDatabase([
    { data: [row('image', { message_type: 'image', media_url: 'javascript:alert(1)' })], error: null },
    { data: [], error: null },
  ])
  const history = await loadChatHistory(database.client, 'lounge')
  assert.equal(history[0].mediaUrl, undefined)
})

test('core history failures propagate for the retry UI', async () => {
  const error = { message: 'Database unavailable' }
  const database = fakeDatabase([{ data: null, error }])
  await assert.rejects(loadChatHistory(database.client, 'lounge'), (failure) => failure === error)
  assert.equal(database.calls.length, 1)
})

test('durable writes preserve the same message id, reply and selected mentions', async () => {
  const database = fakeDatabase([{ error: null }])
  const message: ChatMessage = {
    id: 'sent-message', content: 'Hello @Taylor', type: 'text',
    user: { id: 'listener-1', name: 'Original name', avatarSeed: 'seed' },
    createdAt: '2026-10-06T10:00:00.000Z',
    replyTo: { id: 'reply-target', content: 'Earlier', type: 'text', user: { id: 'other', name: 'Taylor' } },
    mentions: [{ userId: 'other', userName: 'Taylor', handle: 'Taylor' }],
  }
  await saveChatMessage(database.client, 'lounge', message.user, message)
  const inserted = database.calls[0].operations.find(([operation]) => operation === 'insert')?.[1] as Record<string, unknown>
  assert.equal(inserted.id, message.id)
  assert.equal(inserted.room_slug, 'lounge')
  assert.equal(inserted.user_id, message.user.id)
  assert.equal(inserted.reply_to_id, message.replyTo?.id)
  assert.deepEqual(inserted.mentions, message.mentions)
})

test('removing a reaction is scoped to the message, listener and emoji', async () => {
  const database = fakeDatabase([{ error: null }])
  await persistReactionChange(database.client, { action: 'remove', messageId: 'message-1', userId: 'listener-1', emoji: '❤️' })
  assert.deepEqual(database.calls[0].operations, [
    ['delete'], ['eq', 'message_id', 'message-1'], ['eq', 'user_id', 'listener-1'], ['eq', 'emoji', '❤️'],
  ])
})

test('retry confirms an already inserted identical owned message without updating it', async () => {
  const message: ChatMessage = { id: 'retry-id', content: 'Already sent', type: 'text', user: { id: 'listener-1', name: 'Listener', avatarSeed: 'seed' }, createdAt: '2026-10-06T10:00:00.000Z' }
  const database = fakeDatabase([
    { error: { code: '23505', message: 'Duplicate key' } },
    { data: row(message.id, { content: message.content, room_slug: 'lounge' }), error: null },
  ])
  await saveChatMessage(database.client, 'lounge', message.user, message)
  assert.deepEqual(database.calls[1].operations.filter(([operation]) => operation === 'eq'), [
    ['eq', 'id', message.id], ['eq', 'room_slug', 'lounge'], ['eq', 'user_id', message.user.id],
  ])
  assert.equal(database.calls.filter(call => call.operations.some(([operation]) => operation === 'insert')).length, 1)
})

test('retry rejects a conflicting message id or inaccessible original message', async () => {
  const message: ChatMessage = { id: 'retry-id', content: 'New content', type: 'text', user: { id: 'listener-1', name: 'Listener', avatarSeed: 'seed' }, createdAt: '2026-10-06T10:00:00.000Z' }
  const duplicate = { code: '23505', message: 'Duplicate key' }
  for (const data of [null, row(message.id, { content: 'Different original' })]) {
    const database = fakeDatabase([{ error: duplicate }, { data, error: null }])
    await assert.rejects(saveChatMessage(database.client, 'lounge', message.user, message), error => error === duplicate)
  }
})

test('idempotent message retry compares mention fields independently of JSONB object key order', async () => {
  const message: ChatMessage = { id: 'retry-id', content: 'Hello @Taylor', type: 'text', user: { id: 'listener-1', name: 'Listener', avatarSeed: 'seed' }, mentions: [{ userId: 'other', userName: 'Taylor', handle: 'Taylor' }], createdAt: '2026-10-06T10:00:00.000Z' }
  const database = fakeDatabase([
    { error: { code: '23505', message: 'Duplicate key' } },
    { data: row(message.id, { content: message.content, room_slug: 'lounge', mentions: [{ handle: 'Taylor', userName: 'Taylor', userId: 'other' }] }), error: null },
  ])
  await saveChatMessage(database.client, 'lounge', message.user, message)
})
