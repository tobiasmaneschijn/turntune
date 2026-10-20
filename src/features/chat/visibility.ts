import i18n from '../../i18n'
import { getMessagePreview, type ChatMessage, type ChatReply } from './model'

export const hiddenMessagePreview = () => i18n.t('chat:hidden')

interface VisibilityStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface VisibilitySnapshot {
  ids: ReadonlySet<string>
  available: boolean
}

function browserStorage(): VisibilityStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

/** A device preference containing identifiers only; shared message data stays intact. */
export function createChatVisibilityStore(userId: string, roomName: string, storage = browserStorage()) {
  const key = `soundspin-chat-hidden:${encodeURIComponent(userId)}:${encodeURIComponent(roomName)}`
  const readSnapshot = (): VisibilitySnapshot => {
    if (!storage) return { ids: new Set(), available: false }
    try {
      const ids: unknown = JSON.parse(storage.getItem(key) || '[]')
      if (!Array.isArray(ids)) return { ids: new Set(), available: false }
      return {
        ids: new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100)),
        available: true,
      }
    } catch { return { ids: new Set(), available: false } }
  }
  return {
    key,
    readSnapshot,
    read: () => readSnapshot().ids,
    save(ids: ReadonlySet<string>): boolean {
      if (!storage) return false
      try {
        if (ids.size) storage.setItem(key, JSON.stringify([...ids]))
        else storage.removeItem(key)
        return true
      } catch { return false }
    },
  }
}

/** Unsaved local choices survive storage updates until they can be persisted. */
export function createChatVisibilityState(store: ReturnType<typeof createChatVisibilityStore>) {
  let ids = store.readSnapshot().ids
  const overrides = new Map<string, boolean>()
  const sync = (snapshot = store.readSnapshot()): ReadonlySet<string> => {
    const next = new Set(snapshot.available ? snapshot.ids : ids)
    for (const [id, hidden] of overrides) {
      if (hidden) next.add(id)
      else next.delete(id)
    }
    ids = next
    return ids
  }
  return {
    key: store.key,
    get ids() { return ids },
    sync,
    setHidden(messageId: string, hidden: boolean) {
      overrides.set(messageId, hidden)
      const snapshot = store.readSnapshot()
      const next = sync(snapshot)
      // Do not overwrite other tabs' preferences when the persisted baseline is unreadable.
      const persisted = snapshot.available && store.save(next)
      if (persisted) overrides.clear()
      return { ids: next, persisted }
    },
  }
}

export function getVisibleMessagePreview(message: ChatMessage | ChatReply, hiddenIds: ReadonlySet<string>) {
  return !message.removedAt&&hiddenIds.has(message.id) ? hiddenMessagePreview() : getMessagePreview(message)
}
