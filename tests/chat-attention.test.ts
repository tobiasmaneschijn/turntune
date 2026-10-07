import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatAttentionTracker, notifyWithAttention, readRoomNotificationMuted, requestNotificationPermission, setRoomNotificationMuted } from '../src/notifications'

test('permission is requested only explicitly, denied permission stays quiet, and one event chooses one attention route', async () => {
  const previous = Object.fromEntries(['window', 'document', 'Notification'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let permission: NotificationPermission = 'default', requests = 0, visible = true, systems = 0, inApp = 0
  class NotificationFixture {
    static get permission() { return permission }
    static async requestPermission() { requests++; permission = 'denied'; return permission }
    onclick: (() => void) | null = null
    constructor() { systems++ }
    close() {}
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { Notification: NotificationFixture, focus() {} } })
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: NotificationFixture })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { get visibilityState() { return visible ? 'visible' : 'hidden' }, hasFocus: () => true } })
  try {
    const options = (key: string) => ({ key, title: 'Mention', body: 'Hello', onInApp: () => { inApp++ } })
    assert.equal(notifyWithAttention(options('attention-default')), 'in-app'); assert.equal(requests, 0)
    assert.equal(await requestNotificationPermission(), 'denied'); assert.equal(await requestNotificationPermission(), 'denied'); assert.equal(requests, 1)
    visible = false; assert.equal(notifyWithAttention(options('attention-denied')), 'in-app'); assert.equal(systems, 0)
    permission = 'granted'
    assert.equal(notifyWithAttention(options('attention-background')), 'system')
    assert.equal(notifyWithAttention(options('attention-background')), 'suppressed'); assert.equal(systems, 1); assert.equal(inApp, 2)
    visible = true
    assert.equal(notifyWithAttention(options('attention-focused')), 'in-app')
    assert.equal(notifyWithAttention({ ...options('attention-muted'), muted: true }), 'suppressed')
    assert.equal(notifyWithAttention({ ...options('attention-disabled'), enabled: false }), 'suppressed')
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key)
  }
})

test('room mutes still work with denied local storage and remain scoped to the account and room', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('storage blocked') }, setItem() { throw new Error('storage blocked') } } })
  try {
    setRoomNotificationMuted('attention-alice', 'lounge', true)
    assert.equal(readRoomNotificationMuted('attention-alice', 'lounge'), true)
    assert.equal(readRoomNotificationMuted('attention-alice', 'private-room'), false)
    assert.equal(readRoomNotificationMuted('attention-bob', 'lounge'), false)
    setRoomNotificationMuted('attention-alice', 'lounge', false)
    assert.equal(readRoomNotificationMuted('attention-alice', 'lounge'), false)
  } finally { previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage') }
})

test('hydrated, own, old and duplicate broadcasts never become new mention alerts', () => {
  const joinedAt = Date.now(), tracker = createChatAttentionTracker('alice', joinedAt)
  const message = { id: 'new', user: { id: 'mira' }, createdAt: new Date(joinedAt).toISOString(), mentions: [{ userId: 'alice' }] }
  tracker.seed([{ id: 'history' }])
  assert.equal(tracker.consume({ ...message, id: 'history' }), false)
  assert.equal(tracker.consume({ ...message, id: 'old', createdAt: new Date(joinedAt - 30_000).toISOString() }), false)
  assert.equal(tracker.consume({ ...message, id: 'own', user: { id: 'alice' } }), false)
  assert.equal(tracker.consume(message), true); assert.equal(tracker.consume(message), false)
})
