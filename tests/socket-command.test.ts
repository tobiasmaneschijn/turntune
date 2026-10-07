import assert from 'node:assert/strict'
import test from 'node:test'
import { requestSocketAction, type SocketReply } from '../src/socket-request.js'

const userId = '147de25c-02ca-4c4e-a150-b1a31210ed74'

test('malformed known room commands fail before the client creates or emits a request', () => {
  const invalidCommands: Array<[string, unknown]> = [
    ['room:join', { roomId: '../../room', user: { id: userId, name: 'Listener', avatarSeed: userId } }],
    ['room:moderator:set', { roomId: 'test-room', userId, moderator: 'true' }],
    ['room:dj-role:set', { roomId: 'different room', userId, dj: true }],
    ['queue:add', { provider: 'youtube', providerId: 'abcdefghijk', title: '' }],
    ['queue:move', { trackId: userId, toIndex: -1 }],
    ['playback:update', { trackId: userId, playing: true, position: -1 }]
  ]
  for (const [event, payload] of invalidCommands) {
    let reply: SocketReply | undefined
    requestSocketAction({ connected: true, timeout() { throw new Error(`Invalid ${event} must not emit`) } },
      event, payload, (result) => { reply = result })
    assert.equal(reply?.ok, false, event)
    assert.match(reply?.error || '', /command is invalid/i, event)
  }
})

test('room-specific role commands preserve their valid payload and receive the common deadline', () => {
  for (const [event, payload] of [
    ['room:moderator:set', { roomId: 'test-room', userId, moderator: true }],
    ['room:dj-role:set', { roomId: 'test-room', userId, dj: false }]
  ] as const) {
    let emitted = false
    let reply: SocketReply | undefined
    requestSocketAction({ connected: true, timeout(ms) {
      assert.equal(ms, 15_000)
      return { emit(observedEvent, observedPayload, done) {
        emitted = true
        assert.equal(observedEvent, event)
        assert.deepEqual(observedPayload, payload)
        done(null, { ok: true })
      } }
    } }, event, payload, (result) => { reply = result })
    assert.equal(emitted, true)
    assert.equal(reply?.ok, true)
  }
})

test('provider queue commands reject invalid provider identifiers and SoundCloud links before emitting', () => {
  const tracks = [
    { provider: 'youtube', providerId: 'abcdefghijk', title: 'Video' },
    { provider: 'spotify', providerId: '4uLU6hMCjMI75M1A2tKUQC', title: 'Song' },
    { provider: 'apple', providerId: '123456789', title: 'Song' },
    { provider: 'soundcloud', providerId: 'soundcloud:tracks:123456', title: 'Track', permalinkUrl: 'https://soundcloud.com/artist/track' }
  ]
  for (const track of tracks) {
    let reply: SocketReply | undefined
    let emitted = 0
    const transport = { connected: true, timeout() {
      return { emit(_event: string, _payload: unknown, done: (error: Error | null, result?: SocketReply) => void) {
        emitted += 1
        done(null, { ok: true })
      } }
    } }
    requestSocketAction(transport, 'queue:add', track, (result) => { reply = result })
    assert.equal(reply?.ok, true, track.provider)
    assert.equal(emitted, 1, track.provider)
    const invalidTrack = track.provider === 'youtube'
      ? { ...track, artworkUrl: 'http://example.com/image.jpg' }
      : track.provider === 'soundcloud'
        ? { ...track, permalinkUrl: 'https://soundcloud.com.example.org/track' }
        : { ...track, providerId: 'invalid-provider-id' }
    requestSocketAction(transport, 'queue:add', invalidTrack, (result) => { reply = result })
    assert.equal(reply?.ok, false, track.provider)
    assert.equal(emitted, 1, `${track.provider}: rejected payload must not emit`)
  }
})
