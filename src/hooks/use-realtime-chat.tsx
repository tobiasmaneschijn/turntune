'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

import {
  coalesceReactionEvent,
  type ChatMedia,
  type ChatMessage,
  type ChatReactionEvent,
  type ChatReply,
} from '@/chat/model'
import type { User } from '@/types'

interface UseRealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: User
}

function stripUntrustedAdminFlair(message: ChatMessage): ChatMessage {
  return {
    ...message,
    user: { ...message.user, isAppAdmin: false },
    replyTo: message.replyTo
      ? { ...message.replyTo, user: { ...message.replyTo.user, isAppAdmin: false } }
      : undefined,
  }
}

const EVENT_MESSAGE_TYPE = 'message'
const EVENT_REACTION_TYPE = 'reaction'

export function useRealtimeChat({ client, roomName, user }: UseRealtimeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [reactionEvents, setReactionEvents] = useState<ChatReactionEvent[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const newChannel = client.channel(roomName)
    channelRef.current = newChannel
    setMessages([])
    setReactionEvents([])
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
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      channelRef.current = null
      void client.removeChannel(newChannel)
    }
  }, [client, roomName])

  const sendMessage = useCallback(
    async (
      content: string,
      media?: ChatMedia,
      replyTo?: ChatReply
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

  return { messages, sendMessage, broadcastReaction, reactionEvents, isConnected }
}
