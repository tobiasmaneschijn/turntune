import { useCallback, useEffect, useRef, useState } from 'react'
import { createChatSaveTracker, type ChatSaveStates } from '@/chat/delivery'
import { mergeChatMessages, type ChatMedia, type ChatMention, type ChatMessage, type ChatReply } from '@/chat/model'

export interface ChatComposerSnapshot { text: string; mentions: ChatMention[]; replyTo: ChatReply | null }
interface Options {
  scope: string
  isConnected: boolean
  prepareMessage: (content: string, media?: ChatMedia, reply?: ChatReply, mentions?: ChatMention[]) => ChatMessage
  deliver: (message: ChatMessage) => Promise<unknown>
  persist?: (message: ChatMessage) => Promise<void> | void
  composer: () => ChatComposerSnapshot
  confirmed: (snapshot: ChatComposerSnapshot, text: boolean) => void
  beforeTextSend?: () => void
  onError: (message: string) => void
}

/** Owns delivery lifetimes and immutable retry snapshots independently of composer rendering. */
export function useChatDelivery(options: Options) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [saveStates, setSaveStates] = useState<ChatSaveStates>({})
  const saveStatesRef = useRef(saveStates)
  saveStatesRef.current = saveStates
  const [outboxMessages, setOutboxMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const sendingRef = useRef(false)
  const uploadingRef = useRef(false)
  const lifetimeRef = useRef({ active: true })
  const trackerRef = useRef<ReturnType<typeof createChatSaveTracker> | null>(null)
  const completionRef = useRef(new Map<string, { snapshot: ChatComposerSnapshot; text: boolean }>())

  useEffect(() => {
    const lifetime = { active: true }
    lifetimeRef.current = lifetime
    const tracker = createChatSaveTracker((states) => {
      setSaveStates(states)
      // Confirmed rows are also in the realtime buffer. Only recovery rows need an outbox copy.
      setOutboxMessages((messages) => messages.filter((message) => states[message.id]?.state !== 'saved' && states[message.id]?.state !== 'sent-live'))
    })
    trackerRef.current = tracker
    completionRef.current = new Map()
    sendingRef.current = false; uploadingRef.current = false
    setSaveStates({}); setOutboxMessages([]); setSending(false); setUploading(false)
    return () => { lifetime.active = false; tracker.dispose() }
  }, [options.scope])

  const finish = useCallback((messageId: string, lifetime: { active: boolean }) => {
    if (!lifetime.active) return
    const completion = completionRef.current.get(messageId)
    if (!completion) return
    completionRef.current.delete(messageId)
    optionsRef.current.confirmed(completion.snapshot, completion.text)
  }, [])

  const send = useCallback(async (media?: ChatMedia, caption?: string) => {
    const current = optionsRef.current
    const snapshot = current.composer()
    const content = media ? (caption?.slice(0, 500) || 'Shared image') : snapshot.text.trim()
    if (!current.isConnected || !content || sendingRef.current || (uploadingRef.current && !media?.storagePath)) return false
    if (Object.values(saveStatesRef.current).filter((entry) => entry.state === 'failed' || entry.state === 'send-failed').length >= 100) {
      current.onError('Retry pending messages before sending more.'); return false
    }
    const lifetime = lifetimeRef.current
    const tracker = trackerRef.current
    sendingRef.current = true; setSending(true); current.onError('')
    try {
      const message = current.prepareMessage(content, media, snapshot.replyTo || undefined, media ? [] : snapshot.mentions)
      completionRef.current.set(message.id, { snapshot, text: !media })
      setOutboxMessages((messages) => mergeChatMessages(messages, [message]))
      if (!media) current.beforeTextSend?.()
      const delivered = await tracker?.send(message, current.deliver, current.persist)
      if (delivered) finish(message.id, lifetime)
      return Boolean(delivered)
    } catch (error) {
      if (lifetime.active) current.onError(error instanceof Error ? error.message : 'Could not send this message. Please try again.')
      return false
    } finally { if (lifetime.active) { sendingRef.current = false; setSending(false) } }
  }, [finish])

  const retrySend = useCallback(async (messageId: string) => {
    if (sendingRef.current || uploadingRef.current || !optionsRef.current.isConnected) return
    const lifetime = lifetimeRef.current
    sendingRef.current = true; setSending(true)
    try { if (await trackerRef.current?.retrySend(messageId)) finish(messageId, lifetime) }
    finally { if (lifetime.active) { sendingRef.current = false; setSending(false) } }
  }, [finish])
  const retrySave = useCallback((messageId: string) => { void trackerRef.current?.retry(messageId) }, [])
  const sendText = useCallback(() => send(), [send])
  const sendMedia = useCallback((type: 'image' | 'gif', mediaUrl: string, content: string, storagePath?: string) => send({ type, mediaUrl, storagePath }, content), [send])
  return { saveStates, outboxMessages, sending, uploading, sendingRef, uploadingRef, setUploading, lifetimeRef, sendText, sendMedia, retrySend, retrySave }
}
