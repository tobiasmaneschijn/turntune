import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { persistReactionChange } from '../src/chat/persistence.js'

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

test('Removing your reaction cannot delete another listener\'s reaction', async () => {
  const database = fakeDatabase([{ error: null }])
  await persistReactionChange(database.client, { action: 'remove', messageId: 'message-1', userId: 'listener-1', emoji: '❤️' })
  assert.deepEqual(database.calls[0].operations, [
    ['delete'], ['eq', 'message_id', 'message-1'], ['eq', 'user_id', 'listener-1'], ['eq', 'emoji', '❤️'],
  ])
})
