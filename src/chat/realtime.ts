import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage, ChatReactionEvent } from './model'
import { normalizeRealtimeMessage, normalizeRealtimeReaction, normalizeTypingEvent } from './protocol'

export const CHAT_TYPING_TTL_MS = 5_000

export interface RealtimeChatCallbacks {
  onMessage: (message: ChatMessage) => void
  onReaction: (event: ChatReactionEvent) => void
  onTyping: (userIds: string[]) => void
  onConnection: (connected: boolean) => void
}

/** One room's transport lifetime, independent of React render timing. */
export function createRealtimeChatSession(
  client: SupabaseClient,
  roomName: string,
  userId: string,
  callbacks: RealtimeChatCallbacks
) {
  let active = true
  let connected = false
  const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  const typingTimestamps = new Map<string, number>()
  const expiryTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  const channel = client.channel(roomName, { config: { broadcast: { ack: true } } })

  const clearTyping = () => {
    for (const timeout of [...typingTimeouts.values(), ...expiryTimeouts.values()]) clearTimeout(timeout)
    typingTimeouts.clear()
    expiryTimeouts.clear()
    typingTimestamps.clear()
  }

  const send = async (event: string, payload: unknown) => {
    if (!active || !connected) throw new Error('Chat is reconnecting. Please try again.')
    const result = await channel.send({ type: 'broadcast', event, payload })
    if (result !== 'ok') throw new Error('Could not confirm delivery. Please try again.')
  }

  channel
    .on('broadcast', { event: 'message' }, ({ payload }) => {
      if (!active) return
      const message = normalizeRealtimeMessage(payload)
      if (message) callbacks.onMessage(message)
    })
    .on('broadcast', { event: 'reaction' }, ({ payload }) => {
      if (!active) return
      const event = normalizeRealtimeReaction(payload)
      if (event) callbacks.onReaction(event)
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!active) return
      const event = normalizeTypingEvent(payload)
      if (!event || event.userId === userId) return
      const now = Date.now()
      if (event.sentAt > now + CHAT_TYPING_TTL_MS || event.sentAt < now - CHAT_TYPING_TTL_MS) return
      if (event.sentAt < (typingTimestamps.get(event.userId) || 0)) return
      if (!typingTimestamps.has(event.userId) && typingTimestamps.size >= 100) return
      typingTimestamps.set(event.userId, event.sentAt)
      const previousTimeout = typingTimeouts.get(event.userId)
      const previousExpiry = expiryTimeouts.get(event.userId)
      if (previousTimeout) clearTimeout(previousTimeout)
      if (previousExpiry) clearTimeout(previousExpiry)
      typingTimeouts.delete(event.userId)
      expiryTimeouts.delete(event.userId)
      if (event.active) {
        typingTimeouts.set(event.userId, setTimeout(() => {
          if (!active) return
          typingTimeouts.delete(event.userId)
          typingTimestamps.delete(event.userId)
          callbacks.onTyping([...typingTimeouts.keys()])
        }, CHAT_TYPING_TTL_MS))
      } else {
        // Keep the stop timestamp briefly so a delayed active event cannot revive it.
        expiryTimeouts.set(event.userId, setTimeout(() => {
          expiryTimeouts.delete(event.userId)
          typingTimestamps.delete(event.userId)
        }, CHAT_TYPING_TTL_MS))
      }
      callbacks.onTyping([...typingTimeouts.keys()])
    })
    .subscribe((status) => {
      if (!active) return
      connected = status === 'SUBSCRIBED'
      if (!connected) {
        clearTyping()
        callbacks.onTyping([])
      }
      callbacks.onConnection(connected)
    })

  return {
    async sendMessage(message: ChatMessage) {
      await send('message', message)
      // A late acknowledgement still allows the caller to save the message,
      // but must not repopulate another room's timeline.
      if (active) callbacks.onMessage(message)
    },
    async sendReaction(event: ChatReactionEvent) {
      if (!active) return
      // The caller already persisted this reaction; retain its local state even
      // if the live notification cannot be delivered.
      callbacks.onReaction(event)
      await send('reaction', event)
    },
    async sendTyping(typing: boolean) {
      try {
        await send('typing', { userId, active: typing, sentAt: Date.now() })
      } catch {
        // Typing never interrupts a message or creates an unhandled rejection.
      }
    },
    dispose() {
      if (!active) return
      active = false
      connected = false
      clearTyping()
      void client.removeChannel(channel).catch(() => {
        // The room is already inactive locally, including all late callbacks.
      })
    },
  }
}

export type RealtimeChatSession = ReturnType<typeof createRealtimeChatSession>
export type ChatSessionFactory = (userId: string, callbacks: RealtimeChatCallbacks) => RealtimeChatSession
