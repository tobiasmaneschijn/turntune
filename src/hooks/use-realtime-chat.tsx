'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  coalesceReactionEvent,
  mergeChatMessages,
  type ChatMedia,
  type ChatMention,
  type ChatMessage,
  type ChatReactionEvent,
  type ChatReply,
} from '@/chat/model'
import { normalizeRealtimeMessage } from '@/chat/protocol'
import { createRealtimeChatSession, type RealtimeChatSession } from '@/chat/realtime'
import type { User } from '@/types'

export { CHAT_TYPING_TTL_MS } from '@/chat/realtime'

interface UseRealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: User
  onConnected?: () => void
}

export function useRealtimeChat({ client, roomName, user, onConnected }: UseRealtimeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [reactionEvents, setReactionEvents] = useState<ChatReactionEvent[]>([])
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const sessionRef = useRef<RealtimeChatSession | null>(null)
  const connectedCallbackRef = useRef(onConnected)
  connectedCallbackRef.current = onConnected

  useEffect(() => {
    setMessages([])
    setReactionEvents([])
    setTypingUserIds([])
    setIsConnected(false)
    const session = createRealtimeChatSession(client, roomName, user.id, {
      onMessage: (message) => setMessages((current) => mergeChatMessages(current, [message])),
      onReaction: (event) => setReactionEvents((current) => coalesceReactionEvent(current, event)),
      onTyping: setTypingUserIds,
      onConnection: (connected) => {
        if (connected) {
          setReactionEvents([])
          connectedCallbackRef.current?.()
        }
        setIsConnected(connected)
      },
    })
    sessionRef.current = session
    return () => {
      sessionRef.current = null
      session.dispose()
    }
  }, [client, roomName, user.id])

  const sendMessage = useCallback(async (
    content: string,
    media?: ChatMedia,
    replyTo?: ChatReply,
    mentions: ChatMention[] = []
  ) => {
    const session = sessionRef.current
    if (!session) throw new Error('Chat is reconnecting. Please try again.')
    const message = normalizeRealtimeMessage({
      id: crypto.randomUUID(), content, type: media?.type || 'text',
      mediaUrl: media?.mediaUrl, storagePath: media?.storagePath,
      user, mentions, replyTo, createdAt: new Date().toISOString(),
    })
    if (!message) throw new Error('This message could not be sent. Check its text or image.')
    await session.sendMessage(message)
    return message
  }, [user])

  const broadcastReaction = useCallback(async (event: Omit<ChatReactionEvent, 'id'>) => {
    await sessionRef.current?.sendReaction({ ...event, id: crypto.randomUUID() })
  }, [])

  const broadcastTyping = useCallback(async (active: boolean) => {
    await sessionRef.current?.sendTyping(active)
  }, [])

  return { messages, sendMessage, broadcastReaction, reactionEvents, broadcastTyping, typingUserIds, isConnected }
}
