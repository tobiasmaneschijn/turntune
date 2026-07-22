'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

import {
  coalesceReactionEvent,
  type ChatMedia,
  type ChatMention,
  type ChatMessage,
  type ChatReactionEvent,
  type ChatReply,
} from '@/chat/model'
import { normalizeChatMentions } from '@/chat/mentions'
import type { User } from '@/types'

interface UseRealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: User
}

function stripUntrustedAdminFlair(message: ChatMessage): ChatMessage {
  return {
    ...message,
    mentions: normalizeChatMentions(message.mentions),
    user: { ...message.user, isAppAdmin: false },
    replyTo: message.replyTo
      ? {
          ...message.replyTo,
          mentions: normalizeChatMentions(message.replyTo.mentions),
          user: { ...message.replyTo.user, isAppAdmin: false },
        }
      : undefined,
  }
}

const EVENT_MESSAGE_TYPE = 'message'
const EVENT_REACTION_TYPE = 'reaction'
const EVENT_TYPING_TYPE = 'typing'
export const CHAT_TYPING_TTL_MS = 5_000

interface ChatTypingEvent {
  userId: string
  active: boolean
  sentAt: number
}

function normalizeTypingEvent(value: unknown): ChatTypingEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as Partial<ChatTypingEvent>
  if (
    typeof event.userId !== 'string' ||
    !event.userId ||
    event.userId.length > 100 ||
    typeof event.active !== 'boolean' ||
    typeof event.sentAt !== 'number' ||
    !Number.isFinite(event.sentAt)
  ) return null
  return event as ChatTypingEvent
}

export function useRealtimeChat({ client, roomName, user }: UseRealtimeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [reactionEvents, setReactionEvents] = useState<ChatReactionEvent[]>([])
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const typingTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const newChannel = client.channel(roomName)
    channelRef.current = newChannel
    setMessages([])
    setReactionEvents([])
    setTypingUserIds([])
    setIsConnected(false)

    newChannel
      .on('broadcast', { event: EVENT_MESSAGE_TYPE }, (payload) => {
        setMessages((current) => [
          ...current,
          stripUntrustedAdminFlair(payload.payload as ChatMessage),
        ])
      })
      .on('broadcast', { event: EVENT_REACTION_TYPE }, (payload) => {
        const event = payload.payload as ChatReactionEvent
        setReactionEvents((current) => coalesceReactionEvent(current, event))
      })
      .on('broadcast', { event: EVENT_TYPING_TYPE }, (payload) => {
        const event = normalizeTypingEvent(payload.payload)
        if (!event || event.userId === user.id) return

        const previousTimeout = typingTimeoutsRef.current.get(event.userId)
        if (previousTimeout) clearTimeout(previousTimeout)
        typingTimeoutsRef.current.delete(event.userId)

        if (!event.active) {
          setTypingUserIds((current) => current.filter((userId) => userId !== event.userId))
          return
        }

        setTypingUserIds((current) =>
          current.includes(event.userId) ? current : [...current, event.userId]
        )
        const timeout = setTimeout(() => {
          typingTimeoutsRef.current.delete(event.userId)
          setTypingUserIds((current) => current.filter((userId) => userId !== event.userId))
        }, CHAT_TYPING_TTL_MS)
        typingTimeoutsRef.current.set(event.userId, timeout)
      })
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      for (const timeout of typingTimeoutsRef.current.values()) clearTimeout(timeout)
      typingTimeoutsRef.current.clear()
      channelRef.current = null
      void client.removeChannel(newChannel)
    }
  }, [client, roomName, user.id])

  const sendMessage = useCallback(
    async (
      content: string,
      media?: ChatMedia,
      replyTo?: ChatReply,
      mentions: ChatMention[] = []
    ) => {
      const channel = channelRef.current
      if (!channel || !isConnected) return null

      const message = stripUntrustedAdminFlair({
        id: crypto.randomUUID(),
        content,
        type: media?.type || 'text',
        mediaUrl: media?.mediaUrl,
        storagePath: media?.storagePath,
        user,
        mentions,
        replyTo,
        reactions: [],
        createdAt: new Date().toISOString(),
      })

      // Broadcast does not echo to the sender by default, so add the message
      // locally before sending it to the other room members.
      setMessages((current) => [...current, message])

      await channel.send({
        type: 'broadcast',
        event: EVENT_MESSAGE_TYPE,
        payload: message,
      })
      return message
    },
    [isConnected, user]
  )

  const broadcastReaction = useCallback(
    async (event: Omit<ChatReactionEvent, 'id'>) => {
      const channel = channelRef.current
      if (!channel || !isConnected) return

      const reactionEvent: ChatReactionEvent = {
        ...event,
        id: crypto.randomUUID(),
      }
      setReactionEvents((current) => coalesceReactionEvent(current, reactionEvent))
      await channel.send({
        type: 'broadcast',
        event: EVENT_REACTION_TYPE,
        payload: reactionEvent,
      })
    },
    [isConnected]
  )

  const broadcastTyping = useCallback(
    async (active: boolean) => {
      const channel = channelRef.current
      if (!channel || !isConnected) return
      try {
        await channel.send({
          type: 'broadcast',
          event: EVENT_TYPING_TYPE,
          payload: { userId: user.id, active, sentAt: Date.now() } satisfies ChatTypingEvent,
        })
      } catch {
        // Typing is best-effort ephemeral state and should never interrupt chat.
      }
    },
    [isConnected, user.id]
  )

  return {
    messages,
    sendMessage,
    broadcastReaction,
    reactionEvents,
    broadcastTyping,
    typingUserIds,
    isConnected,
  }
}
