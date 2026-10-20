import { activeMentions, normalizeChatMentions } from './mentions'
import type { ChatMention } from './model'
import { clearUserChatOutbox } from './outbox'

const PREFIX = 'soundspin-chat-draft:'
export const CHAT_DRAFT_TTL_MS = 12 * 60 * 60 * 1000
const ownerVersions = new Map<string, number>()

export interface ChatDraft {
  text: string
  mentions: ChatMention[]
  replyToId?: string
}

interface DraftStorage {
  length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function sessionDraftStorage(): DraftStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage } catch { return undefined }
}

const ownerPrefix = (userId: string) => `${PREFIX}${encodeURIComponent(userId)}:`

/** Stores text and identifiers only; attachments, credentials, and media blobs stay out. */
export function createChatDraftStore(userId: string, roomName: string, storage = sessionDraftStorage()) {
  const key = `${ownerPrefix(userId)}${encodeURIComponent(roomName)}`
  const ownerVersion = ownerVersions.get(userId) || 0
  const isCurrent = () => ownerVersion === (ownerVersions.get(userId) || 0)
  return {
    read(now = Date.now()): ChatDraft | null {
      if (!storage || !isCurrent()) return null
      try {
        const raw = storage.getItem(key)
        if (!raw) return null
        const value = JSON.parse(raw)
        if (value?.version !== 1 || typeof value.text !== 'string' || value.text.length > 500 ||
          !Number.isFinite(value.updatedAt) || value.updatedAt > now || now - value.updatedAt > CHAT_DRAFT_TTL_MS) {
          storage.removeItem(key)
          return null
        }
        return {
          text: value.text,
          mentions: activeMentions(value.text, normalizeChatMentions(value.mentions)),
          replyToId: typeof value.replyToId === 'string' && value.replyToId.length <= 100 ? value.replyToId : undefined,
        }
      } catch { return null }
    },
    save(draft: ChatDraft, now = Date.now()) {
      if (!storage || !isCurrent()) return
      try {
        if (!draft.text && !draft.replyToId) storage.removeItem(key)
        else storage.setItem(key, JSON.stringify({ version: 1, updatedAt: now, text: draft.text.slice(0, 500),
          mentions: activeMentions(draft.text, normalizeChatMentions(draft.mentions)), replyToId: draft.replyToId }))
      } catch { /* Draft saving must never interrupt typing. */ }
    },
  }
}

/** Invalidates pending/unmount flushes before deleting every room draft for this account. */
export function clearUserChatDrafts(userId: string, storage = sessionDraftStorage()) {
  ownerVersions.set(userId, (ownerVersions.get(userId) || 0) + 1)
  clearUserChatOutbox(userId, storage)
  if (!storage) return
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    for (const key of keys) if (key?.startsWith(ownerPrefix(userId))) storage.removeItem(key)
  } catch { /* Storage may be unavailable in private/restricted browser contexts. */ }
}
