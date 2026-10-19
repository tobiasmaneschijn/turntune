import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPollVoteEvents, getPollResults, type ChatMessage } from '../src/chat/model'
import { createChatHistorySource } from '../src/chat/history-reader'

const message: ChatMessage = {
  id: '00000000-0000-4000-8000-000000000001', content: 'What next?', type: 'text',
  user: { id: 'alice', name: 'Alice', avatarSeed: 'alice' }, createdAt: '2026-10-08T10:00:00Z',
  poll: { options: ['Jazz', 'House'], votes: [{ userId: 'alice', optionIndex: 0, revision: 3 }] },
}

test('A late poll update cannot replace a newer vote', () => {
  const newer = { messageId: message.id, userId: 'alice', optionIndex: 1, revision: 5 }
  const [result] = applyPollVoteEvents([message], [newer,
    { ...newer, optionIndex: 0, revision: 4 },
    { ...newer, userId: 'bob', optionIndex: 1, revision: 1 },
  ])
  assert.deepEqual(getPollResults(result.poll!, 'alice'), { counts: [0, 2], totalVotes: 2, selectedOption: 1 })
  assert.equal(message.poll?.votes[0].optionIndex, 0)
})

test('Voting uses your room credentials and retries without impersonating a voter', async () => {
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
  await assert.rejects(source.votePoll!(message.id, 1), /could not be confirmed/)
  assert.equal(JSON.parse(String(requests[1].options?.body)).id,JSON.parse(String(requests[2].options?.body)).id)
})
