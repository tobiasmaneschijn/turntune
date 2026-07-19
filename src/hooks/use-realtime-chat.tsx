'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

interface UseRealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: {
    id: string
    name: string
    avatarSeed: string
    avatarKey?: string
  }
}

export interface ChatMessage {
  id: string
  content: string
  type: 'text' | 'image' | 'gif'
  mediaUrl?: string
  storagePath?: string
  user: {
    id: string
    name: string
    avatarSeed: string
    avatarKey?: string
  }
  replyTo?: ChatReply
  reactions?: ChatReaction[]
  createdAt: string
}

export interface ChatReply {
  id: string
  content: string
  type: ChatMessage['type']
  mediaUrl?: string
  user: Pick<ChatMessage['user'], 'id' | 'name'>
}

export interface ChatReaction {
  emoji: string
  userId: string
}

export interface ChatReactionEvent extends ChatReaction {
  id: string
  messageId: string
  action: 'add' | 'remove'
}

const EVENT_MESSAGE_TYPE = 'message'
const EVENT_REACTION_TYPE = 'reaction'

export function useRealtimeChat({ client, roomName, user }: UseRealtimeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [reactionEvents, setReactionEvents] = useState<ChatReactionEvent[]>([])

  useEffect(() => {
    const newChannel = client.channel(roomName)

    newChannel
      .on('broadcast', { event: EVENT_MESSAGE_TYPE }, (payload) => {
        setMessages((current) => [...current, payload.payload as ChatMessage])
      })
      .on('broadcast', { event: EVENT_REACTION_TYPE }, (payload) => {
        setReactionEvents((current) => [...current, payload.payload as ChatReactionEvent])
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true)
        } else {
          setIsConnected(false)
        }
      })

    setChannel(newChannel)

    return () => {
      client.removeChannel(newChannel)
    }
  }, [client, roomName])

  const sendMessage = useCallback(
    async (
      content: string,
      media?: {
        type: 'image' | 'gif'
        mediaUrl: string
        storagePath?: string
      },
      replyTo?: ChatReply
    ) => {
      if (!channel || !isConnected) return null

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        content,
        type: media?.type || 'text',
        mediaUrl: media?.mediaUrl,
        storagePath: media?.storagePath,
        user,
        replyTo,
        reactions: [],
        createdAt: new Date().toISOString(),
      }

      // Update local state immediately for the sender
      setMessages((current) => [...current, message])

      await channel.send({
        type: 'broadcast',
        event: EVENT_MESSAGE_TYPE,
        payload: message,
      })
      return message
    },
    [channel, isConnected, user]
  )

  const broadcastReaction = useCallback(
    async (event: Omit<ChatReactionEvent, 'id'>) => {
      if (!channel || !isConnected) return

      const reactionEvent: ChatReactionEvent = {
        ...event,
        id: crypto.randomUUID(),
      }
      setReactionEvents((current) => [...current, reactionEvent])
      await channel.send({
        type: 'broadcast',
        event: EVENT_REACTION_TYPE,
        payload: reactionEvent,
      })
    },
    [channel, isConnected]
  )

  return { messages, sendMessage, broadcastReaction, reactionEvents, isConnected }
}
