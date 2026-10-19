import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createChatSaveTracker, type ChatSaveStates } from '@/chat/delivery'
import { mergeChatMessages, type ChatMedia, type ChatMention, type ChatMessage, type ChatReply } from '@/chat/model'

export interface ChatComposerSnapshot { text: string; mentions: ChatMention[]; replyTo: ChatReply | null; revision: number }
interface Options {
  scope: string
  isConnected: boolean
  prepareMessage: (content: string, media?: ChatMedia, reply?: ChatReply, mentions?: ChatMention[], pollOptions?: string[]) => ChatMessage
  deliver: (message: ChatMessage) => Promise<unknown>
  persist?: (message: ChatMessage) => Promise<void> | void
  composer: () => ChatComposerSnapshot
  confirmed: (snapshot: ChatComposerSnapshot, text: boolean) => void
  confirmedSend?: () => void
  beforeTextSend?: () => void
  onError: (message: string) => void
}

/** Owns delivery lifetimes and immutable retry snapshots independently of composer rendering. */
export function useChatDelivery(options: Options) {
  const { t } = useTranslation('chat')
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
  const completionRef = useRef(new Map<string, { snapshot: ChatComposerSnapshot; text: boolean; poll: boolean }>())
  const textSubmissionRef = useRef<{ key: string; messageId: string } | null>(null)

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
    textSubmissionRef.current = null
    sendingRef.current = false; uploadingRef.current = false
    setSaveStates({}); setOutboxMessages([]); setSending(false); setUploading(false)
    return () => { lifetime.active = false; tracker.dispose() }
  }, [options.scope])

  const finish = useCallback((messageId: string, lifetime: { active: boolean }) => {
    if (!lifetime.active) return
    const completion = completionRef.current.get(messageId)
    if (!completion) return
    completionRef.current.delete(messageId)
    if (textSubmissionRef.current?.messageId === messageId) textSubmissionRef.current = null
    optionsRef.current.confirmedSend?.()
    if(!completion.poll)optionsRef.current.confirmed(completion.snapshot, completion.text)
  }, [])

  const send = useCallback(async (media?: ChatMedia, caption?: string, accepted?: () => void, pollOptions?: string[]) => {
    const current = optionsRef.current
    const snapshot = current.composer()
    const content = pollOptions ? (caption || '').trim() : media ? (caption?.slice(0, 500) || t('sharedImage')) : snapshot.text.trim()
    if (!current.isConnected || !content || sendingRef.current || (uploadingRef.current && !media?.storagePath)) return false
    const textKey = !media && !pollOptions ? JSON.stringify([snapshot.revision, snapshot.text, snapshot.mentions, snapshot.replyTo?.id]) : null
    const previous = textKey && textSubmissionRef.current?.key === textKey ? textSubmissionRef.current : null
    if (!previous && Object.values(saveStatesRef.current).filter((entry) => entry.state === 'failed' || entry.state === 'send-failed').length >= 100) {
      current.onError(t('retryPending')); return false
    }
    const lifetime = lifetimeRef.current
    const tracker = trackerRef.current
    sendingRef.current = true; setSending(true); current.onError('')
    try {
      // A lost acknowledgement can hide an accepted send. Keep its UUID until
      // confirmation or a real composer edit, rather than submitting it twice.
      if (previous) {
        const delivered = await tracker?.retrySend(previous.messageId)
        if (delivered) finish(previous.messageId, lifetime)
        return Boolean(delivered)
      }
      const message = current.prepareMessage(content, media, pollOptions ? undefined : snapshot.replyTo || undefined, media || pollOptions ? [] : snapshot.mentions, pollOptions)
      if (textKey) textSubmissionRef.current = { key: textKey, messageId: message.id }
      completionRef.current.set(message.id, { snapshot, text: !media, poll: Boolean(pollOptions) })
      setOutboxMessages((messages) => mergeChatMessages(messages, [message]))
      accepted?.()
      if (!media && !pollOptions) current.beforeTextSend?.()
      const delivered = await tracker?.send(message, current.deliver, current.persist)
      if (delivered) finish(message.id, lifetime)
      return Boolean(delivered)
    } catch (error) {
      if (lifetime.active) current.onError(error instanceof Error ? error.message : t('sendFailed'))
      return false
    } finally { if (lifetime.active) { sendingRef.current = false; setSending(false) } }
  }, [finish, t])

  const retrySend = useCallback(async (messageId: string) => {
    if (sendingRef.current || uploadingRef.current || !optionsRef.current.isConnected) return
    const lifetime = lifetimeRef.current
    sendingRef.current = true; setSending(true)
    try { if (await trackerRef.current?.retrySend(messageId)) finish(messageId, lifetime) }
    finally { if (lifetime.active) { sendingRef.current = false; setSending(false) } }
  }, [finish, t])
  const retrySave = useCallback((messageId: string) => { void trackerRef.current?.retry(messageId) }, [])
  const sendText = useCallback(() => send(), [send])
  const sendPoll = useCallback(async (question: string, pollOptions: string[]) => {
    let accepted = false
    await send(undefined, question, () => { accepted = true }, pollOptions)
    return accepted
  }, [send])
  const sendMedia = useCallback((type: 'image' | 'gif', mediaUrl: string, content: string, storagePath?: string) => send({ type, mediaUrl, storagePath }, content), [send])
  const sendMediaWithOwnership = useCallback(async (type: 'image' | 'gif', mediaUrl: string, content: string, storagePath?: string) => {
    let accepted = false
    const delivered = await send({ type, mediaUrl, storagePath }, content, () => { accepted = true })
    return { accepted, delivered }
  }, [send])
  return { saveStates, outboxMessages, sending, uploading, sendingRef, uploadingRef, setUploading, lifetimeRef, sendText, sendPoll, sendMedia, sendMediaWithOwnership, retrySend, retrySave }
}
