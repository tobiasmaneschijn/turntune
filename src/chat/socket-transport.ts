import { requestSocketAction } from '../socket-request'
import { normalizeRealtimeMessage, normalizeRealtimePollVote, normalizeRealtimeReaction, normalizeTypingEvent,normalizeChatRemoved } from './protocol'
import { CHAT_TYPING_TTL_MS, type ChatSessionFactory } from './realtime'

type EventHandler = (payload: unknown) => void
export type SocketChatTransport = Parameters<typeof requestSocketAction>[0] & {
  on(event: string, callback: EventHandler): unknown
  off(event: string, callback: EventHandler): unknown
}

/** Production room transport. Uses the already authenticated, password-admitted app socket. */
export function createSocketChatSessionFactory(socket: SocketChatTransport, roomId: string, initialAdmission = false): ChatSessionFactory & { setAdmitted(admitted: boolean): void } {
  let admitted = initialAdmission
  const sessions = new Set<(next: boolean) => void>()
  const factory: ChatSessionFactory = (userId, callbacks) => {
    let active = true
    let ready = admitted && socket.connected
    let reportedInitial = false
    const typing = new Map<string, { timestamp: number; active: boolean; timeout: ReturnType<typeof setTimeout> }>()
    const typingIds = () => [...typing].filter(([, entry]) => entry.active).map(([id]) => id)
    const clearTyping = () => { typing.forEach((entry) => clearTimeout(entry.timeout)); typing.clear(); if (active) callbacks.onTyping([]) }
    const connection = (next: boolean) => { if (!active || ready === next) return; ready = next; reportedInitial = true; if (!next) clearTyping(); callbacks.onConnection(next) }
    const admissionChanged = (next: boolean) => connection(next && socket.connected)
    sessions.add(admissionChanged)
    const envelope = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && (value as { roomId?: unknown }).roomId === roomId ? value as Record<string, unknown> : null
    const receiveMessage: EventHandler = (value) => { const payload = envelope(value); if (!active || !ready || !payload) return; const message = normalizeRealtimeMessage(payload.message); if (message) callbacks.onMessage(message) }
    const receiveReaction: EventHandler = (value) => { const payload = envelope(value); if (!active || !ready || !payload) return; const reaction = normalizeRealtimeReaction(payload.reaction); if (reaction) callbacks.onReaction(reaction) }
    const receivePollVote: EventHandler = (value) => { const payload = envelope(value); if (!active || !ready || !payload) return; const vote = normalizeRealtimePollVote(payload.poll); if (vote) callbacks.onPollVote?.(vote) }
    const receiveRemoved:EventHandler=(value)=>{const payload=envelope(value);if(!active||!ready||!payload)return;const removed=normalizeChatRemoved(payload);if(removed)callbacks.onRemoved?.(removed)}
    const receiveTyping: EventHandler = (value) => {
      const payload = envelope(value)
      if (!active || !ready || !payload) return
      const event = normalizeTypingEvent(payload.typing)
      if (!event || event.userId === userId || Math.abs(event.sentAt - Date.now()) > CHAT_TYPING_TTL_MS) return
      const previous = typing.get(event.userId)
      if (previous && (previous.timestamp > event.sentAt || !previous.active && event.active && previous.timestamp === event.sentAt) || !previous && typing.size >= 100) return
      if (previous) clearTimeout(previous.timeout)
      const timeout = setTimeout(() => { typing.delete(event.userId); if (active) callbacks.onTyping(typingIds()) }, CHAT_TYPING_TTL_MS)
      typing.set(event.userId, { timestamp: event.sentAt, active: event.active, timeout })
      callbacks.onTyping(typingIds())
    }
    const disconnected: EventHandler = () => { admitted = false; connection(false) }
    const connected: EventHandler = () => connection(false) // Only the parent ACK+fresh-snapshot admission can enable chat.
    const listeners: Array<[string, EventHandler]> = [['chat:message', receiveMessage], ['chat:reaction', receiveReaction], ['chat:poll', receivePollVote], ['chat:removed',receiveRemoved], ['chat:typing', receiveTyping], ['disconnect', disconnected], ['connect', connected]]
    listeners.forEach(([event, handler]) => socket.on(event, handler))
    queueMicrotask(() => { if (active && !reportedInitial) { reportedInitial = true; callbacks.onConnection(ready) } })
    const send = (kind: 'message' | 'reaction' | 'typing', payload: unknown) => new Promise<void>((resolve, reject) => {
      if (!active || !ready) { reject(new Error('Chat is reconnecting. Try again.')); return }
      requestSocketAction(socket, `chat:${kind}`, { roomId, [kind]: payload }, (result) => result.ok ? resolve() : reject(new Error(result.error || 'Could not confirm this chat event.')))
    })
    return {
      async sendMessage(message) { await send('message', message); if (active) callbacks.onMessage(message) },
      async sendReaction(event) { if (!active) return; callbacks.onReaction(event); await send('reaction', event) },
      async sendTyping(value) { try { await send('typing', { active: value }) } catch { /* Ephemeral typing never blocks composition. */ } },
      dispose() { if (!active) return; active = false; clearTyping(); sessions.delete(admissionChanged); listeners.forEach(([event, handler]) => socket.off(event, handler)) },
    }
  }
  return Object.assign(factory, { setAdmitted(next: boolean) { admitted = next; sessions.forEach((update) => update(next)) } })
}
