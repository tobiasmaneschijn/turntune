export const CHAT_MAX_PINS = 50

export interface ChatPin {
  messageId: string
  pinnedBy: string
  pinnedAt: string
}

export interface ChatPinEvent {
  messageId: string
  pinned: boolean
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeChatPinEvent(value: unknown): ChatPinEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as Partial<ChatPinEvent>
  return typeof event.messageId === 'string' && uuid.test(event.messageId) && typeof event.pinned === 'boolean'
    ? { messageId: event.messageId, pinned: event.pinned }
    : null
}

export function isChatPin(value: unknown): value is ChatPin {
  if (!value || typeof value !== 'object') return false
  const pin = value as Partial<ChatPin>
  return typeof pin.messageId === 'string' && uuid.test(pin.messageId) &&
    typeof pin.pinnedBy === 'string' && pin.pinnedBy.length > 0 && pin.pinnedBy.length <= 100 &&
    typeof pin.pinnedAt === 'string' && pin.pinnedAt.length <= 64 && Number.isFinite(Date.parse(pin.pinnedAt))
}
