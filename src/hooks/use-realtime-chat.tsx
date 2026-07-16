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
  createdAt: string
}

const EVENT_MESSAGE_TYPE = 'message'

export function useRealtimeChat({ client, roomName, user }: UseRealtimeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const newChannel = client.channel(roomName)

    newChannel
      .on('broadcast', { event: EVENT_MESSAGE_TYPE }, (payload) => {
        setMessages((current) => [...current, payload.payload as ChatMessage])
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
      }
    ) => {
      if (!channel || !isConnected) return null

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        content,
        type: media?.type || 'text',
        mediaUrl: media?.mediaUrl,
        storagePath: media?.storagePath,
        user,
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

  return { messages, sendMessage, isConnected }
}
