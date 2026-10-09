import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPollVoteEvents, coalescePollVoteEvent, getPollResults, type ChatMessage } from '../src/chat/model'
import { normalizeChatPollOptions, normalizeRealtimeMessage, normalizeRealtimePollVote } from '../src/chat/protocol'
import { createChatHistorySource } from '../src/chat/history-reader'
import { chatMessagesFromRows, type ChatHistoryRow } from '../src/chat/persistence'
import { createChatSaveTracker } from '../src/chat/delivery'

const message: ChatMessage = {
  id: '00000000-0000-4000-8000-000000000001', content: 'What next?', type: 'text',
  user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: '2026-10-08T10:00:00Z',
  poll: { options: ['Jazz', 'House'], votes: [{ userId: 'alice', optionIndex: 0, revision: 3 }] },
}

test('polls require a bounded question and distinct trimmed choices, and senders cannot supply votes', () => {
  assert.deepEqual(normalizeChatPollOptions([' Jazz ', ' House ']), ['Jazz', 'House'])
  for (const options of [null, ['Jazz'], ['a', 'b', 'c', 'd', 'e'], ['Jazz', ' jazz '], ['', 'House'], ['a'.repeat(81), 'House'], ['Jazz', 1]]) {
    assert.equal(normalizeChatPollOptions(options), null)
    assert.equal(normalizeRealtimeMessage({ ...message, poll: { options } }), null)
  }
  const normalized = normalizeRealtimeMessage({ ...message, content: '  What next?  ' })!
  assert.equal(normalized.content, 'What next?')
  assert.deepEqual(normalized.poll, { options: ['Jazz', 'House'], votes: [] })
  assert.equal(normalizeRealtimeMessage({ ...message, content: 'a'.repeat(201) }), null)
  assert.equal(normalizeRealtimeMessage({ ...message, type: 'image', mediaUrl: 'https://example.com/image.png' }), null)
})

test('newer accepted votes replace one account vote without changing history choices or letting late events roll it back', () => {
  const newer = { messageId: message.id, userId: 'alice', optionIndex: 1, revision: 5 }
  const [result] = applyPollVoteEvents([message], [newer,
    { ...newer, optionIndex: 0, revision: 4 },
    { ...newer, userId: 'bob', optionIndex: 1, revision: 1 },
    { ...newer, userId: 'invalid', optionIndex: 2 },
    { ...newer, userId: 'invalid-revision', revision: 1.5 },
    { ...newer, messageId: 'other', optionIndex: 0 },
  ])
  assert.equal(result.poll?.options, message.poll?.options)
  assert.deepEqual(getPollResults(result.poll!, 'alice'), { counts: [0, 2], totalVotes: 2, selectedOption: 1 })
  assert.equal(message.poll?.votes[0].optionIndex, 0)
  const [refreshed] = applyPollVoteEvents([{ ...message, poll: { ...message.poll!, votes: [{ userId: 'alice', optionIndex: 0, revision: 6 }] } }], [newer])
  assert.equal(getPollResults(refreshed.poll!, 'alice').selectedOption, 0)
})

test('poll results count one latest valid vote per account and mark an account with no vote', () => {
  const result = getPollResults({ options: ['Jazz', 'House'], votes: [
    { userId: 'alice', optionIndex: 1, revision: 2 }, { userId: 'alice', optionIndex: 0, revision: 1 },
    { userId: 'bob', optionIndex: 0, revision: 1 }, { userId: 'invalid', optionIndex: 9, revision: 1 },
  ] }, 'charlie')
  assert.deepEqual(result, { counts: [1, 1], totalVotes: 2, selectedOption: null })
})

test('vote buffers retain only the newest revision for each message and account', () => {
  const event = { messageId: message.id, userId: 'alice', optionIndex: 1, revision: 2 }
  const events = [event]
  assert.equal(coalescePollVoteEvent(events, { ...event, revision: 1 }), events)
  assert.equal(coalescePollVoteEvent(events, { ...event, revision: 2 }), events)
  assert.deepEqual(coalescePollVoteEvent(events, { ...event, optionIndex: 0, revision: 3 }), [{ ...event, optionIndex: 0, revision: 3 }])
  assert.equal(coalescePollVoteEvent(events, { ...event, userId: 'bob' }).length, 2)
  for (const invalid of [{ ...event, revision: '2' }, { ...event, revision: 0 }, { ...event, revision: 1.5 }, { ...event, optionIndex: -1 }, { ...event, optionIndex: 4 }]) {
    assert.equal(normalizeRealtimePollVote(invalid), null)
  }
})

test('history restores poll options and the latest vote while rejecting invalid choices and revisions', () => {
  const row: ChatHistoryRow = {
    id: message.id, content: message.content, message_type: 'text', media_url: null, storage_path: null, mentions: [],
    user_id: 'alice', user_name: 'Alice', avatar_seed: 'alice', created_at: message.createdAt,
    reply_to_id: null, soundspin_message_reactions: [], poll_options: ['Jazz', 'House'],
    soundspin_poll_votes: [
      { user_id: 'alice', option_index: 1, revision: 2 }, { user_id: 'alice', option_index: 0, revision: 1 },
      { user_id: 'bob', option_index: 2, revision: 1 }, { user_id: 'charlie', option_index: 0, revision: 0 },
    ],
  }
  assert.deepEqual(chatMessagesFromRows([row])[0].poll, { options: ['Jazz', 'House'], votes: [{ userId: 'alice', optionIndex: 1, revision: 2 }] })
})

test('voting uses room authorization and a stable retry receipt with no forged owner', async () => {
  const requests: Array<{ url: string; options?: RequestInit }> = []
  const accepted = { messageId: message.id, userId: 'alice', optionIndex: 1, revision: 2 }
  let response: unknown = accepted
  const fetcher: typeof fetch = async (url, options) => { requests.push({ url: String(url), options }); return Response.json(response) }
  const source = createChatHistorySource('alice-token', 'private-room', fetcher)
  assert.deepEqual(await source.votePoll!(message.id, 1), accepted)
  assert.equal(requests[0].url, `/api/rooms/private-room/chat/polls/${message.id}/vote`)
  const body=JSON.parse(String(requests[0].options?.body));assert.equal(body.optionIndex,1);assert.match(body.id,/^[0-9a-f-]{36}$/);assert.equal(body.userId,undefined)
  assert.equal(new Headers(requests[0].options?.headers).get('authorization'), 'Bearer alice-token')
  response = { ...accepted, messageId: 'other' }
  await assert.rejects(source.votePoll!(message.id, 1), /could not be confirmed/)
  response = { ...accepted, revision: '2' }
  await assert.rejects(source.votePoll!(message.id, 1), /could not be confirmed/)
  assert.equal(JSON.parse(String(requests[1].options?.body)).id,JSON.parse(String(requests[2].options?.body)).id)
})

test('poll delivery retries retain the same message id and options through the durable outbox', async () => {
  const tracker = createChatSaveTracker(() => {})
  const attempts: ChatMessage[] = [], saved: ChatMessage[] = []
  const deliver = async (poll: ChatMessage) => { attempts.push(poll); if (attempts.length === 1) throw new Error('Lost ACK') }
  assert.equal(await tracker.send(message, deliver, (poll) => { saved.push(poll) }), false)
  assert.equal(await tracker.retrySend(message.id), true)
  assert.equal(attempts[0], message)
  assert.equal(attempts[1], message)
  assert.equal(saved[0], message)
  assert.equal(saved[0].poll?.options, message.poll?.options)
  tracker.dispose()
})
