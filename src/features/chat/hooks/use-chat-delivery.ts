import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createChatDeliveryQueue, type ChatSaveStates } from '@/features/chat/delivery'
import { ChatOutboxError, createChatOutboxStore } from '@/features/chat/outbox'
import type { ChatMedia, ChatMention, ChatMessage, ChatReply } from '@/features/chat/model'
import type { ChatGame, ChatSongAttachment } from '../../../../shared/chat-attachments'
import { formatChatGameCommand } from '@/features/chat/chat-games'

export interface ChatComposerSnapshot { text: string; mentions: ChatMention[]; replyTo: ChatReply | null; song?: ChatSongAttachment; revision: number }
interface Options {
  scope: string
  ownerId: string
  isConnected: boolean
  slowModeSeconds?: number
  prepareMessage: (content: string, media?: ChatMedia, reply?: ChatReply, mentions?: ChatMention[], pollOptions?: string[], attachments?: Pick<ChatMessage, 'song' | 'game'>) => ChatMessage
  deliver: (message: ChatMessage) => Promise<unknown>
  persist?: (message: ChatMessage) => Promise<void> | void
  composer: () => ChatComposerSnapshot
  accepted: (snapshot: ChatComposerSnapshot, text: boolean, submitted: ChatMessage) => void
  confirmedSend?: () => void
  beforeTextSend?: () => void
  onError: (message: string) => void
}

/** Composition hands off to a recoverable outbox before any asynchronous delivery. */
export function useChatDelivery(options: Options) {
  const { t } = useTranslation('chat')
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [saveStates, setSaveStates] = useState<ChatSaveStates>({})
  const [outboxMessages, setOutboxMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const sendingRef = useRef(false)
  const uploadingRef = useRef(false)
  const lifetimeRef = useRef({ active: true })
  const queueRef = useRef<ReturnType<typeof createChatDeliveryQueue> | null>(null)

  useEffect(() => {
    const lifetime = { active: true }
    const scope = options.scope
    const ownerId = options.ownerId
    lifetimeRef.current = lifetime
    sendingRef.current = false; uploadingRef.current = false
    setSaveStates({}); setOutboxMessages([]); setSending(false); setUploading(false)
    const current = optionsRef.current
    const queue = createChatDeliveryQueue({
      store: createChatOutboxStore(ownerId, scope),
      connected: () => lifetime.active && optionsRef.current.scope === scope && optionsRef.current.ownerId === ownerId && optionsRef.current.isConnected,
      slowModeSeconds: () => optionsRef.current.slowModeSeconds || 0,
      // Each lifetime retains its own transport and persistence scope.
      deliver: current.deliver,
      persist: current.persist,
      confirmed: () => { if (lifetime.active) optionsRef.current.confirmedSend?.() },
      onChange: (states, messages, busy) => {
        if (!lifetime.active || optionsRef.current.scope !== scope || optionsRef.current.ownerId !== ownerId) return
        sendingRef.current = busy
        setSaveStates(states); setOutboxMessages(messages); setSending(busy)
      },
    })
    queueRef.current = queue
    return () => { lifetime.active = false; queue.dispose(); if (queueRef.current === queue) queueRef.current = null }
  }, [options.scope, options.ownerId])

  const send = useCallback((media?: ChatMedia, caption?: string, pollOptions?: string[], game?: ChatGame, preserveDraft = false) => {
    const current = optionsRef.current
    const snapshot = current.composer()
    const content = game ? formatChatGameCommand(game) : pollOptions ? (caption || '').trim() : media ? (caption?.slice(0, 500) || t('sharedImage')) : snapshot.text.trim()
    const queue = queueRef.current
    if (!queue || !current.isConnected || (!content && !snapshot.song) ||
      (sendingRef.current && (media || pollOptions || (current.slowModeSeconds || 0) > 0)) ||
      (uploadingRef.current && !media?.storagePath)) return null
    current.onError('')
    try {
      const message = current.prepareMessage(content, media, pollOptions || preserveDraft ? undefined : snapshot.replyTo || undefined, media || pollOptions || game ? [] : snapshot.mentions, pollOptions,
        { song: !media && !pollOptions && !game ? snapshot.song : undefined, game })
      const delivered = queue.accept(message)
      // This synchronous callback clears only the accepted draft, never later edits.
      if (!pollOptions && !preserveDraft) current.accepted(snapshot, !media, message)
      if (!media && !pollOptions) current.beforeTextSend?.()
      return delivered
    } catch (error) {
      current.onError(error instanceof ChatOutboxError
        ? t(error.reason === 'full' ? 'outboxFull' : error.reason === 'invalid' ? 'invalidMessage' : 'outboxUnavailable')
        : error instanceof Error ? error.message : t('sendFailed'))
      return null
    }
  }, [t])

  const retrySend = useCallback(async (messageId: string) => {
    if (uploadingRef.current || !optionsRef.current.isConnected || ((optionsRef.current.slowModeSeconds || 0) > 0 && sendingRef.current)) return
    await queueRef.current?.retry(messageId)
  }, [])
  const retrySave = useCallback((messageId: string) => {
    if (!optionsRef.current.isConnected) return
    void queueRef.current?.retry(messageId, true)
  }, [])
  const sendText = useCallback(async () => Boolean(send()), [send])
  const sendPoll = useCallback(async (question: string, pollOptions: string[]) => Boolean(send(undefined, question, pollOptions)), [send])
  const sendGame = useCallback(async (game: ChatGame, options?: { preserveDraft: boolean }) => Boolean(send(undefined, undefined, undefined, game, options?.preserveDraft)), [send])
  const sendMedia = useCallback(async (type: 'image' | 'gif', mediaUrl: string, content: string, storagePath?: string) => {
    const delivered = send({ type, mediaUrl, storagePath }, content)
    return delivered ? await delivered : false
  }, [send])
  const sendMediaWithOwnership = useCallback(async (type: 'image' | 'gif', mediaUrl: string, content: string, storagePath?: string) => {
    const delivered = send({ type, mediaUrl, storagePath }, content)
    return { accepted: Boolean(delivered), delivered: delivered ? await delivered : false }
  }, [send])
  return { saveStates, outboxMessages, sending, uploading, sendingRef, uploadingRef, setUploading, lifetimeRef, sendText, sendPoll, sendGame, sendMedia, sendMediaWithOwnership, retrySend, retrySave }
}
