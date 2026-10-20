import { normalizeRealtimeMessage } from './protocol'
import type { ChatMessage } from './model'

const PREFIX = 'soundspin-chat-outbox:'
const TTL_MS = 12 * 60 * 60 * 1000
export const CHAT_OUTBOX_LIMIT = 100
const ownerVersions = new Map<string, number>()
const listeners = new Map<string, Set<() => void>>()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ChatOutboxStorage {
  length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export interface ChatOutboxRecord {
  message: ChatMessage
  acceptedAt: number
  state: 'pending' | 'send-failed' | 'failed'
}

function sessionStorage(): ChatOutboxStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage } catch { return undefined }
}
const ownerPrefix = (userId: string) => `${PREFIX}${encodeURIComponent(userId)}:`
const notify = (key: string) => listeners.get(key)?.forEach(listener => listener())

/** Storage is untrusted. Recovery never grants flair or accepts another account's media. */
function snapshot(value: unknown, userId: string): ChatMessage | null {
  const message = normalizeRealtimeMessage(value)
  if (!message || !uuid.test(message.id) || message.user.id !== userId || message.removedAt ||
    (message.storagePath && (!message.storagePath.startsWith(`${userId}/`) || message.storagePath.includes('..')))) return null
  const raw = value as ChatMessage
  if (raw.replyTo && (!message.replyTo || !uuid.test(message.replyTo.id))) return null
  // Normalization strips credentials, unsafe URLs, reactions, votes and untrusted privileges.
  return structuredClone(message)
}

export class ChatOutboxError extends Error {
  constructor(public readonly reason: 'unavailable' | 'full' | 'invalid') { super(reason) }
}

/** Acceptance succeeds only after the browser has stored the immutable recovery copy. */
export function createChatOutboxStore(userId: string, scope: string, storage = sessionStorage()) {
  const key = `${ownerPrefix(userId)}${encodeURIComponent(scope)}`
  const version = ownerVersions.get(userId) || 0
  const isCurrent = () => version === (ownerVersions.get(userId) || 0)
  let lastRead: ChatOutboxRecord[] = []
  const read = (now = Date.now()): ChatOutboxRecord[] => {
    if (!storage || !isCurrent()) return []
    try {
      const raw = storage.getItem(key)
      if (!raw || raw.length > 2_000_000) { lastRead = []; return [] }
      const value = JSON.parse(raw)
      if (value?.version !== 1 || (ownerVersions.has(userId) && value.ownerVersion !== version) ||
        !Array.isArray(value.records) || value.records.length > CHAT_OUTBOX_LIMIT) return []
      const ids = new Set<string>()
      const records: ChatOutboxRecord[] = value.records.flatMap((record: ChatOutboxRecord) => {
        if (!record || !Number.isFinite(record.acceptedAt) || record.acceptedAt > now || now - record.acceptedAt > TTL_MS ||
          !['pending', 'send-failed', 'failed'].includes(record.state)) return []
        const message = snapshot(record.message, userId)
        if (!message || ids.has(message.id)) return []
        ids.add(message.id)
        return [{ message, state: record.state, acceptedAt: record.acceptedAt }]
      })
      lastRead = records
      return structuredClone(records)
    } catch { return structuredClone(lastRead) }
  }
  const write = (records: ChatOutboxRecord[]) => {
    if (!storage || !isCurrent()) throw new ChatOutboxError('unavailable')
    try {
      if (records.length) storage.setItem(key, JSON.stringify({ version: 1, ownerVersion: version, records }))
      else storage.removeItem(key)
    } catch { throw new ChatOutboxError('unavailable') }
    lastRead = structuredClone(records)
    notify(key)
  }
  return {
    isCurrent, read,
    accept(value: ChatMessage, now = Date.now()) {
      const message = snapshot(value, userId)
      if (!message) throw new ChatOutboxError('invalid')
      if (!storage || !isCurrent()) throw new ChatOutboxError('unavailable')
      try { storage.getItem(key) } catch { throw new ChatOutboxError('unavailable') }
      const records = read(now)
      if (records.length >= CHAT_OUTBOX_LIMIT) throw new ChatOutboxError('full')
      if (records.some(record => record.message.id === message.id)) throw new ChatOutboxError('invalid')
      write([...records, { message, acceptedAt: now, state: 'pending' }])
      return message
    },
    update(id: string, state?: ChatOutboxRecord['state']) {
      if (!isCurrent()) return
      const records = read()
      if (!records.some(record => record.message.id === id)) return
      // A late result may update/remove an existing record; it can never recreate one.
      write(state ? records.map(record => record.message.id === id ? { ...record, state } : record) : records.filter(record => record.message.id !== id))
    },
    subscribe(listener: () => void) {
      let entries = listeners.get(key)
      if (!entries) { entries = new Set(); listeners.set(key, entries) }
      entries.add(listener)
      return () => { entries.delete(listener); if (!entries.size) listeners.delete(key) }
    },
  }
}

/** Sign-out invalidates old workers before removing their recovery copies. */
export function clearUserChatOutbox(userId: string, storage = sessionStorage()) {
  ownerVersions.set(userId, (ownerVersions.get(userId) || 0) + 1)
  const prefix = ownerPrefix(userId)
  if (storage) {
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key)
    } catch { /* A blocked browser store must not interrupt sign-out. */ }
  }
  for (const key of listeners.keys()) if (key.startsWith(prefix)) notify(key)
}
