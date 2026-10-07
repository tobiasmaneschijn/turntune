import assert from 'node:assert/strict'
import test from 'node:test'
import { appRouteContext, parseAppRoute, routeRoomId } from '../src/hooks/use-room-session'

test('routes identify one screen and retain a room only for an in-app profile visit', () => {
  assert.deepEqual(parseAppRoute('/room/friday-focus'), { kind: 'room', roomId: 'friday-focus' })
  assert.deepEqual(parseAppRoute('/room/friday-focus/extra'), { kind: 'lobby' })
  assert.deepEqual(parseAppRoute('/admin'), { kind: 'admin' })
  const id = '00000000-0000-4000-8000-000000000001'
  assert.deepEqual(parseAppRoute(`/profile/${id}`), { kind: 'profile', profileId: id })
  assert.equal(routeRoomId({ kind: 'profile', profileId: id, backgroundRoomId: 'friday-focus' }), 'friday-focus')
  assert.equal(routeRoomId({ kind: 'profile', profileId: id }), null)
  assert.equal(appRouteContext({ kind: 'profile', profileId: id }), `profile:${id}`)
})
