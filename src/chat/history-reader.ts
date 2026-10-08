import type { ChatMessage } from './model'
import { chatHistoryCursorFilter, chatMessagesFromRows, type ChatHistoryCursor, type ChatHistoryPage, type ChatHistoryRow } from './persistence'
import { requestJson } from '../lib/authenticated-http'

export interface ChatMessageContext { messages: ChatMessage[]; olderCursor: ChatHistoryCursor; newerCursor: ChatHistoryCursor; hasOlder: boolean; hasNewer: boolean }
export interface ChatHistorySource {
  loadPage(cursor?: ChatHistoryCursor, options?: { direction?: 'older' | 'newer'; pageSize?: number }): Promise<ChatHistoryPage>
  search(query: string, cursor?: ChatHistoryCursor): Promise<ChatHistoryPage>
  loadContext(messageId: string): Promise<ChatMessageContext | null>
  loadMessage(messageId: string): Promise<ChatMessage | null>
  saveMessage(message: ChatMessage): Promise<void>
  saveReaction(change: { id?: string; action: 'add' | 'remove'; messageId: string; userId?: string; emoji: string }): Promise<void>
  loadMediaUrl(storagePath: string, signal?: AbortSignal): Promise<string>
}
interface RowsPayload { rows: ChatHistoryRow[]; replies?: ChatHistoryRow[]; profiles?: Parameters<typeof chatMessagesFromRows>[2] }

/** The server checks fresh room admission before it reads privileged database history. */
export function createChatHistorySource(accessToken: string, roomSlug: string, fetchImpl: typeof fetch = fetch): ChatHistorySource {
  const prefix = `/api/rooms/${encodeURIComponent(roomSlug)}/chat`
  const request = async <T>(path: string, params = new URLSearchParams(), body?: unknown, signal?: AbortSignal): Promise<T> => {
    return requestJson<T>(`${prefix}${path}${params.size ? `?${params}` : ''}`, {
      accessToken, signal, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      errorMessage: 'Room chat could not be loaded or saved. Try again.', validate: (value): value is T => value === null || typeof value === 'object'
    }, fetchImpl)
  }
  const cursorParams = (cursor?: ChatHistoryCursor) => {
    const params = new URLSearchParams()
    if (cursor) { chatHistoryCursorFilter(cursor); params.set('beforeAt', cursor.createdAt); params.set('beforeId', cursor.id) }
    return params
  }
  const messages = (payload: RowsPayload) => chatMessagesFromRows(payload.rows, payload.replies, payload.profiles)
  return {
    async loadPage(cursor, options = {}) {
      const params = cursorParams(cursor)
      if (options.direction) params.set('direction', options.direction)
      if (options.pageSize) params.set('pageSize', String(options.pageSize))
      const payload = await request<RowsPayload & { cursor?: ChatHistoryCursor; hasMore: boolean }>('/history', params)
      return { messages: messages(payload), cursor: payload.cursor, hasMore: payload.hasMore }
    },
    async search(query, cursor) {
      const params = cursorParams(cursor); params.set('q', query)
      const payload = await request<RowsPayload & { cursor?: ChatHistoryCursor; hasMore: boolean }>('/search', params)
      return { messages: messages(payload), cursor: payload.cursor, hasMore: payload.hasMore }
    },
    async loadContext(id) {
      const payload = await request<(RowsPayload & Omit<ChatMessageContext, 'messages'>) | null>(`/context/${encodeURIComponent(id)}`)
      return payload ? { messages: messages(payload), olderCursor: payload.olderCursor, newerCursor: payload.newerCursor, hasOlder: payload.hasOlder, hasNewer: payload.hasNewer } : null
    },
    async loadMessage(id) {
      const payload = await request<RowsPayload | null>(`/messages/${encodeURIComponent(id)}`)
      return payload ? messages(payload)[0] || null : null
    },
    async saveMessage(message) { await request('/messages', undefined, message) },
    async saveReaction(change) { await request('/reactions', undefined, { id: change.id, action: change.action, messageId: change.messageId, emoji: change.emoji }) },
    async loadMediaUrl(storagePath, signal) { return (await request<{ url: string }>('/media-url', undefined, { storagePath }, signal)).url },
  }
}
