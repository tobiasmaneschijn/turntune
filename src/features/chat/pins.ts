import i18n from '@/i18n'
import { requestJson } from '@/lib/authenticated-http'
import { chatMessagesFromRows, type ChatHistoryRow } from '@/features/chat/persistence'
import type { ChatMessage } from '@/features/chat/model'
import { CHAT_MAX_PINS, isChatPin, normalizeChatPinEvent, type ChatPin, type ChatPinEvent } from '../../../shared/chat-pins'

export type { ChatPin, ChatPinEvent } from '../../../shared/chat-pins'
export interface ChatPinnedMessages { pins: ChatPin[]; messages: ChatMessage[] }
export interface ChatPinSource {
  loadPins(signal?: AbortSignal): Promise<ChatPinnedMessages>
  setPinned(messageId: string, pinned: boolean): Promise<ChatPinEvent>
}

interface PinPayload {
  pins: ChatPin[]
  rows: ChatHistoryRow[]
  replies?: ChatHistoryRow[]
  profiles?: Parameters<typeof chatMessagesFromRows>[2]
}

export function createChatPinSource(accessToken: string, roomSlug: string, fetchImpl: typeof fetch = fetch): ChatPinSource {
  const prefix = `/api/rooms/${encodeURIComponent(roomSlug)}/chat/pins`
  return {
    async loadPins(signal) {
      const payload = await requestJson<PinPayload>(prefix, {
        accessToken, signal, errorMessage: i18n.t('chat:pins.loadFailed', { defaultValue: "Couldn't load pinned messages. Try again." }),
        validate: (value): value is PinPayload => Boolean(value && typeof value === 'object' &&
          Array.isArray((value as PinPayload).pins) && (value as PinPayload).pins.length <= CHAT_MAX_PINS &&
          (value as PinPayload).pins.every(isChatPin) && Array.isArray((value as PinPayload).rows)),
      }, fetchImpl)
      return { pins: payload.pins, messages: chatMessagesFromRows(payload.rows, payload.replies, payload.profiles) }
    },
    async setPinned(messageId, pinned) {
      return requestJson<ChatPinEvent>(`${prefix}/${encodeURIComponent(messageId)}`, {
        accessToken, method: 'POST', body: JSON.stringify({ pinned }),
        errorMessage: i18n.t('chat:pins.saveFailed', { defaultValue: "Couldn't update pinned messages. Try again." }),
        validate: (value): value is ChatPinEvent => {
          const event = normalizeChatPinEvent(value)
          return Boolean(event && event.messageId === messageId && event.pinned === pinned)
        },
      }, fetchImpl)
    },
  }
}
