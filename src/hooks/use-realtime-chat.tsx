import { useTranslation } from 'react-i18next'
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  coalesceReactionEvent,
  coalescePollVoteEvent,
  mergeChatMessages,
  recentChatMessages,
  applyRemovalEvents,
  type ChatMedia,
  type ChatMention,
  type ChatMessage,
  type ChatReactionEvent,
  type ChatPollVoteEvent,
  type ChatReply,
  type ChatRemovedEvent,
} from '@/chat/model'
import { normalizeRealtimeMessage, normalizeRealtimePollVote } from '@/chat/protocol'
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
  const { t } = useTranslation('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [reactionEvents, setReactionEvents] = useState<ChatReactionEvent[]>([])
  const [pollVoteEvents, setPollVoteEvents] = useState<ChatPollVoteEvent[]>([])
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const [removalEvents,setRemovalEvents]=useState<ChatRemovedEvent[]>([])
  const removalMarkersRef=useRef(new Map<string,ChatRemovedEvent>())
  const applyRemoval=useCallback((event:ChatRemovedEvent)=>{removalMarkersRef.current.set(event.messageId,event);setRemovalEvents(current=>current.some(item=>item.messageId===event.messageId)?current:[...current,event])},[])
  const sessionRef = useRef<RealtimeChatSession | null>(null)
  const connectedCallbackRef = useRef(onConnected)
  connectedCallbackRef.current = onConnected
  const beforeMessageRef = useRef(onBeforeMessage)
  beforeMessageRef.current = onBeforeMessage
  const messageBufferRef = useRef<ChatMessage[]>([])
  const applyPollVote = useCallback((event: ChatPollVoteEvent) => {
    const normalized = normalizeRealtimePollVote(event)
    if (normalized) setPollVoteEvents((current) => coalescePollVoteEvent(current, normalized).slice(-4000))
  }, [])

  useEffect(() => {
    setMessages([])
    setRemovalEvents([])
    removalMarkersRef.current.clear()
    messageBufferRef.current = []
    setReactionEvents([])
    setPollVoteEvents([])
    setTypingUserIds([])
    setIsConnected(false)
    const callbacks: RealtimeChatCallbacks = {
      onMessage: (message) => {
        message=applyRemovalEvents([message],[...removalMarkersRef.current.values()])[0]
        const next = mergeChatMessages(messageBufferRef.current, [message])
        if(!message.removedAt)beforeMessageRef.current?.(message, next)
        messageBufferRef.current = recentChatMessages(next)
        setMessages(messageBufferRef.current)
      },
      onReaction: (event) => setReactionEvents((current) => coalesceReactionEvent(current, event).slice(-4000)),
      onPollVote: applyPollVote,
      onRemoved:applyRemoval,
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
  }, [client, roomName, user.id, transport, applyPollVote,applyRemoval])

  const sendMessage = useCallback(async (
    content: string,
    media?: ChatMedia,
    replyTo?: ChatReply,
    mentions: ChatMention[] = []
  ) => {
    const session = sessionRef.current
    if (!session) throw new Error(t('reconnecting'))
    const message = normalizeRealtimeMessage({
      id: crypto.randomUUID(), content, type: media?.type || 'text',
      mediaUrl: media?.mediaUrl, storagePath: media?.storagePath,
      user, mentions, replyTo, createdAt: new Date().toISOString(),
    })
    if (!message) throw new Error(t('invalidMessage'))
    await session.sendMessage(message)
    return message
  }, [user, t])
  const prepareMessage = useCallback((content: string, media?: ChatMedia, replyTo?: ChatReply, mentions: ChatMention[] = [], pollOptions?: string[]) => {
    const message = normalizeRealtimeMessage({ id: crypto.randomUUID(), content, type: media?.type || 'text', mediaUrl: media?.mediaUrl,
      storagePath: media?.storagePath, user, mentions, replyTo, createdAt: new Date().toISOString(),
      poll: pollOptions ? { options: pollOptions } : undefined })
    if (!message) throw new Error(t('invalidMessage'))
    return message
  }, [user, t])
  const sendExistingMessage = useCallback(async (message: ChatMessage) => {
    if (message.user.id !== user.id) throw new Error(t('otherAccount'))
    const session = sessionRef.current
    if (!session) throw new Error(t('reconnecting'))
    await session.sendMessage(message)
    return message
  }, [user.id, t])

  const broadcastReaction = useCallback(async (event: Omit<ChatReactionEvent, 'id'> & { id?: string }) => {
    await sessionRef.current?.sendReaction({ ...event, id: event.id || crypto.randomUUID() })
  }, [])

  const broadcastTyping = useCallback(async (active: boolean) => {
    await sessionRef.current?.sendTyping(active)
  }, [])

  return { messages, sendMessage, prepareMessage, sendExistingMessage, broadcastReaction, reactionEvents, pollVoteEvents, applyPollVote,removalEvents,applyRemoval, broadcastTyping, typingUserIds, isConnected }
}
