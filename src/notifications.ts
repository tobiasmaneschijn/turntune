export type NotificationPermissionState = NotificationPermission | 'unsupported'
export type NotificationResult = 'system' | 'in-app' | 'suppressed'
export interface AttentionNotification {
  key: string
  title: string
  body: string
  enabled?: boolean
  backgroundOnly?: boolean
  muted?: boolean
  onInApp?: () => void
  onClick?: () => void
}
const seenNotifications = new Map<string, number>()
const roomMutes = new Map<string, boolean>()
export const ROOM_NOTIFICATION_EVENT = 'soundspin:room-notifications'
const muteKey = (userId: string, roomId: string) => `soundspin-room-notifications:${encodeURIComponent(userId)}:${encodeURIComponent(roomId)}`

export function readNotificationPermission(): NotificationPermissionState {
  return typeof window === 'undefined' || !('Notification' in window) ? 'unsupported' : Notification.permission
}

/** Called only from the explicit Enable button; denied permission is never requested repeatedly. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  const permission = readNotificationPermission()
  if (permission !== 'default') return permission
  try { return await Notification.requestPermission() } catch { return readNotificationPermission() }
}

export const notificationPermissionDescription = (permission: NotificationPermissionState) => permission === 'unsupported'
  ? 'This browser does not support system notifications. In-app notifications are still available.'
  : permission === 'denied'
    ? 'System notifications are blocked. Allow them in your browser’s site settings.'
    : permission === 'granted' ? 'System notifications are allowed for this browser.'
      : 'Enable notifications to allow them in this browser.'

export function isAppInBackground() {
  return typeof document === 'undefined' || document.visibilityState !== 'visible' || !document.hasFocus()
}

/** One route per event. Preferences never control the caller's critical inline error/recovery. */
export function notifyWithAttention(options: AttentionNotification): NotificationResult {
  if (options.enabled === false || options.muted || seenNotifications.has(options.key)) return 'suppressed'
  seenNotifications.set(options.key, Date.now())
  if (seenNotifications.size > 2_000) seenNotifications.delete(seenNotifications.keys().next().value!)
  const background = isAppInBackground()
  if (readNotificationPermission() === 'granted' && (options.backgroundOnly === false || background)) {
    try {
      const notification = new Notification(options.title, { body: options.body, tag: options.key })
      notification.onclick = () => { window.focus(); options.onClick?.(); notification.close() }
      return 'system'
    } catch { /* Fall back to the same in-app route without another permission prompt. */ }
  }
  if (options.onInApp) { options.onInApp(); return 'in-app' }
  return 'suppressed'
}

export function readRoomNotificationMuted(userId: string, roomId: string) {
  const key = muteKey(userId, roomId)
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) { const muted = stored === 'muted'; roomMutes.set(key, muted); return muted }
  } catch { /* Session preference remains usable when storage is unavailable. */ }
  return roomMutes.get(key) || false
}

export function setRoomNotificationMuted(userId: string, roomId: string, muted: boolean) {
  const key = muteKey(userId, roomId)
  roomMutes.set(key, muted)
  try { localStorage.setItem(key, muted ? 'muted' : 'unmuted') } catch { /* Apply for this session. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ROOM_NOTIFICATION_EVENT, { detail: { userId, roomId, muted } }))
}

/** Hydration and replay records are baseline, never new mention events. */
export function createChatAttentionTracker(userId: string, joinedAt = Date.now()) {
  const seen = new Set<string>()
  return {
    seed(messages: ReadonlyArray<{ id: string }>) { messages.forEach((message) => seen.add(message.id)) },
    consume(message: { id: string; createdAt: string; user: { id: string }; mentions?: Array<{ userId: string }> }) {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      // A reconnect replay older than this session cannot become a new alert.
      return message.user.id !== userId && Date.parse(message.createdAt) >= joinedAt - 5_000 &&
        Boolean(message.mentions?.some((mention) => mention.userId === userId))
    },
  }
}
