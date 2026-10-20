import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import { ChatCommandService, type ChatCommandServiceOptions } from './chat-command-service.js'
import { mountDurableChatRoutes } from './chat-command-routes.js'
import { addTriviaAnswer, CHAT_TRIVIA_MAX_PLAYERS, createTriviaRound } from './chat-trivia.js'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const start = Date.parse('2026-10-20T18:00:00Z')
const message = (id = randomUUID()) => ({ id, content: '/trivia', type: 'text', createdAt: new Date(start).toISOString(),
  game: { kind: 'trivia', round: { question: 'Forged question', options: ['Win'], correctOption: 0, endsAt: '2099-01-01' } } })

test('Room members answer the same durable trivia round once and see its answer after the deadline', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-trivia-'))
  let now = start
  const emitted: unknown[] = []
  const options: ChatCommandServiceOptions = { client: null, dataDir, now: () => now,
    getUser: async id => ({ id, name: id === alice ? 'Alice' : 'Bob', avatarSeed: id }), authorize: async () => {},
    emit: async (_room, _event, payload) => { emitted.push(payload) } }
  try {
    const service = new ChatCommandService(options), input = message()
    const accepted = await service.message('lounge', alice, input)
    assert.equal(accepted.game?.kind, 'trivia')
    if (accepted.game?.kind !== 'trivia' || !accepted.game.round) throw new Error('Missing trivia round')
    assert.equal(accepted.game.round.options.length, 4)
    assert.notEqual(accepted.game.round.question, 'Forged question')
    assert.equal(Date.parse(accepted.game.round.endsAt), start + 30_000)
    assert.equal(JSON.stringify(accepted.game).includes('correctOption'), false)
    const first = await service.triviaAnswer('lounge', alice, accepted.id, 0)
    assert.equal(first.selectedOption, 0)
    assert.equal(first.answered, 1)
    assert.equal(first.correctOption, undefined)
    assert.equal(first.counts, undefined)
    const [duplicate, second] = await Promise.all([
      service.triviaAnswer('lounge', alice, accepted.id, 2), service.triviaAnswer('lounge', bob, accepted.id, 1)
    ])
    assert.equal(duplicate.selectedOption, 0, 'a different choice cannot replace the first answer')
    assert.equal(second.selectedOption, 1)
    const spectator = await service.triviaState('lounge', 'spectator', accepted.id)
    assert.equal(spectator.answered, 2)
    assert.equal(spectator.selectedOption, undefined)
    assert.equal(spectator.correctOption, undefined)
    assert.equal(spectator.counts, undefined)
    const restarted = new ChatCommandService(options)
    assert.equal((await restarted.triviaState('lounge', alice, accepted.id)).selectedOption, 0)
    now += 30_000
    const final = await restarted.triviaState('lounge', bob, accepted.id)
    assert.ok(Number.isInteger(final.correctOption))
    assert.deepEqual(final.counts, [1, 1, 0, 0])
    assert.equal((await restarted.triviaAnswer('lounge', alice, accepted.id, 3)).selectedOption, 0, 'lost acknowledgments can be retried after closing')
    await assert.rejects(restarted.triviaAnswer('lounge', 'late-listener', accepted.id, 0), /has ended/)
    assert.deepEqual((await restarted.message('lounge', alice, input)).game, accepted.game)
    assert.equal(emitted.length, 1, 'answering and retrying do not add chat messages')
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('Removed, unrelated and restricted trivia cannot collect answers or expose another room', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-trivia-access-'))
  let revoked = false, checks = 0, revokeOnRecheck = false
  const options: ChatCommandServiceOptions = { client: null, dataDir, now: () => start,
    getUser: async id => ({ id, name: 'Alice', avatarSeed: id }), emit: async () => {},
    authorize: async (_user, _room, kind) => {
      if (kind === 'reaction' && (revoked || (revokeOnRecheck && ++checks === 2))) throw new Error('Chat is restricted.')
    } }
  try {
    const service = new ChatCommandService(options)
    const accepted = await service.message('lounge', alice, message())
    await assert.rejects(service.triviaState('another-room', alice, accepted.id), /unavailable/)
    await assert.rejects(service.triviaAnswer('another-room', alice, accepted.id, 0), /unavailable/)
    await assert.rejects(service.triviaAnswer('lounge', alice, accepted.id, 4), /Choose/)
    revokeOnRecheck = true
    await assert.rejects(service.triviaAnswer('lounge', alice, accepted.id, 0), /restricted/)
    revokeOnRecheck = false; revoked = true
    await assert.rejects(service.triviaAnswer('lounge', alice, accepted.id, 0), /restricted/)
    assert.equal((await service.triviaState('lounge', alice, accepted.id)).answered, 0, 'read-only spectators can still see a round')
    revoked = false
    await service.triviaAnswer('lounge', alice, accepted.id, 1)
    await service.removeMessage('lounge', bob, accepted.id, randomUUID())
    await assert.rejects(service.triviaState('lounge', alice, accepted.id), /unavailable/)
    await assert.rejects(service.triviaAnswer('lounge', alice, accepted.id, 1), /unavailable/)
    const saved = JSON.parse(await readFile(path.join(dataDir, 'soundspin-chat.json'), 'utf8'))
    assert.equal(saved.triviaAnswers[accepted.id], undefined)
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('A full trivia round preserves recorded answers without admitting more participants', () => {
  const round = createTriviaRound(start, () => 0).round!
  const answers = Array.from({ length: CHAT_TRIVIA_MAX_PLAYERS }, (_, index) => ({ userId: `listener-${index}`, optionIndex: index % 4 }))
  addTriviaAnswer(round, answers, 'listener-0', 3, start)
  assert.equal(answers[0].optionIndex, 0)
  assert.throws(() => addTriviaAnswer(round, answers, 'one-too-many', 0, start), /full/)
  assert.equal(answers.length, CHAT_TRIVIA_MAX_PLAYERS)
})

test('Trivia requests protect room access before reading and never return results after admission ends', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'soundspin-trivia-routes-'))
  const app = express()
  let admitted = true, endDuringRead = false, reads = 0
  const service = new ChatCommandService({ client: null, dataDir, now: () => start,
    getUser: async id => ({ id, name: 'Alice', avatarSeed: id }), authorize: async () => {}, emit: async () => {} })
  const saved = await service.message('lounge', alice, message())
  const originalRead = service.triviaState.bind(service)
  service.triviaState = async (...args) => { reads++; const result = await originalRead(...args); if (endDuringRead) admitted = false; return result }
  mountDurableChatRoutes(app, { client: null,
    getUserId: async request => request.headers.authorization === 'Bearer alice' ? alice : null,
    canReadRoom: async (_user, room) => admitted && room === 'lounge', canWriteRoom: async (_user, room) => admitted && room === 'lounge',
  }, service)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/rooms/lounge/chat/trivia/${saved.id}`
  const auth = { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }
  try {
    for (const method of ['GET', 'POST']) {
      const path = method === 'GET' ? base : `${base}/answer`
      const options = { method, ...(method === 'POST' ? { body: JSON.stringify({ optionIndex: 0 }) } : {}) }
      assert.equal((await fetch(path, options)).status, 401)
      admitted = false
      assert.equal((await fetch(path, { ...options, headers: auth })).status, 403)
    }
    assert.equal(reads, 0)
    admitted = true
    const answer = await fetch(`${base}/answer`, { method: 'POST', headers: auth, body: JSON.stringify({ optionIndex: 0, userId: bob }) })
    assert.equal(answer.status, 200)
    assert.equal(answer.headers.get('cache-control'), 'no-store')
    const state = await answer.json()
    assert.equal(state.selectedOption, 0)
    assert.equal(state.correctOption, undefined)
    assert.equal((await service.triviaState('lounge', bob, saved.id)).selectedOption, undefined)
    endDuringRead = true
    const revoked = await fetch(base, { headers: auth })
    assert.equal(revoked.status, 403)
    assert.equal((await revoked.json()).answered, undefined)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(dataDir, { recursive: true, force: true })
  }
})
