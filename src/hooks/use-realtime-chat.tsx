'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  coalesceReactionEvent,
  mergeChatMessages,
  recentChatMessages,
  type ChatMedia,
  type ChatMention,
  type ChatMessage,
  type ChatReactionEvent,
  type ChatReply,
} from '@/chat/model'
import { normalizeRealtimeMessage } from '@/chat/protocol'
import { createRealtimeChatSession, type ChatSessionFactory, type RealtimeChatCallbacks, type RealtimeChatSession } from '@/chat/realtime'
import type { User } from '@/types'

export { CHAT_TYPING_TTL_MS } from '@/chat/realtime'

interface UseRealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: User
  onConnected?: () => void
  transport?: ChatSessionFactory
  onBeforeMessage?: (message: ChatMessage, messages: ChatMessage[]) => void
}

export function useRealtimeChat({ client, roomName, user, onConnected, transport, onBeforeMessage }: UseRealtimeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [reactionEvents, setReactionEvents] = useState<ChatReactionEvent[]>([])
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const sessionRef = useRef<RealtimeChatSession | null>(null)
  const connectedCallbackRef = useRef(onConnected)
  connectedCallbackRef.current = onConnected
  const beforeMessageRef = useRef(onBeforeMessage)
  beforeMessageRef.current = onBeforeMessage
  const messageBufferRef = useRef<ChatMessage[]>([])

  useEffect(() => {
    setMessages([])
    messageBufferRef.current = []
    setReactionEvents([])
    setTypingUserIds([])
    setIsConnected(false)
    const callbacks: RealtimeChatCallbacks = {
      onMessage: (message) => {
        const next = mergeChatMessages(messageBufferRef.current, [message])
        beforeMessageRef.current?.(message, next)
        messageBufferRef.current = recentChatMessages(next)
        setMessages(messageBufferRef.current)
      },
      onReaction: (event) => setReactionEvents((current) => coalesceReactionEvent(current, event).slice(-4000)),
      onTyping: setTypingUserIds,
      onConnection: (connected) => {
        if (connected) {
          setReactionEvents([])
          connectedCallbackRef.current?.()
        }
        setIsConnected(connected)
      },
    }
    const session = transport ? transport(user.id, callbacks) : createRealtimeChatSession(client, roomName, user.id, callbacks)
    sessionRef.current = session
    return () => {
      sessionRef.current = null
      session.dispose()
    }
  }, [client, roomName, user.id, transport])

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
  const prepareMessage = useCallback((content: string, media?: ChatMedia, replyTo?: ChatReply, mentions: ChatMention[] = []) => {
    const message = normalizeRealtimeMessage({ id: crypto.randomUUID(), content, type: media?.type || 'text', mediaUrl: media?.mediaUrl,
      storagePath: media?.storagePath, user, mentions, replyTo, createdAt: new Date().toISOString() })
    if (!message) throw new Error('This message could not be sent. Check its text or image.')
    return message
  }, [user])
  const sendExistingMessage = useCallback(async (message: ChatMessage) => {
    if (message.user.id !== user.id) throw new Error('This message belongs to another account.')
    const session = sessionRef.current
    if (!session) throw new Error('Chat is reconnecting. Please try again.')
    await session.sendMessage(message)
    return message
  }, [user.id])

  const broadcastReaction = useCallback(async (event: Omit<ChatReactionEvent, 'id'> & { id?: string }) => {
    await sessionRef.current?.sendReaction({ ...event, id: event.id || crypto.randomUUID() })
  }, [])

  const broadcastTyping = useCallback(async (active: boolean) => {
    await sessionRef.current?.sendTyping(active)
  }, [])

  return { messages, sendMessage, prepareMessage, sendExistingMessage, broadcastReaction, reactionEvents, broadcastTyping, typingUserIds, isConnected }
}
