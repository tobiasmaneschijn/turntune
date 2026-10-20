import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, ChatRemovedEvent } from '@/features/chat/model'

interface ChatModerationOptions {
  scope: string
  participantsEnabled: boolean
  onRemoveMessage?: (message: ChatMessage, reason: string) => Promise<void>
  onReportMessage?: (message: ChatMessage, reason: string) => Promise<void>
  canRemoveMessage?: (message: ChatMessage) => boolean
  applyRemoval: (event: ChatRemovedEvent) => void
}

export function useChatModeration({ scope, participantsEnabled, onRemoveMessage, onReportMessage, canRemoveMessage, applyRemoval }: ChatModerationOptions) {
  const { t } = useTranslation('chat')
  const [target, setTarget] = useState<{ kind: 'remove' | 'report'; message: ChatMessage } | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setTarget(null) }, [scope])

  const open = useCallback((kind: 'remove' | 'report', message: ChatMessage) => {
    setTarget({ kind, message })
    setReason('')
    setError('')
  }, [])
  const openRemove = useCallback((message: ChatMessage) => open('remove', message), [open])
  const openReport = useCallback((message: ChatMessage) => open('report', message), [open])
  const close = () => { if (!pending) setTarget(null) }
  const submit = async () => {
    if (!target || pending) return
    const action = target.kind === 'remove' ? onRemoveMessage : onReportMessage
    if (!action || (target.kind === 'remove' && (
      !participantsEnabled || (canRemoveMessage && !canRemoveMessage(target.message))
    ))) {
      setError(target.kind === 'remove' ? t('removeUnavailable') : t('reportUnavailable'))
      return
    }
    setPending(true)
    setError('')
    try {
      await action(target.message, reason.trim())
      if (target.kind === 'remove') applyRemoval({ messageId: target.message.id, removedAt: new Date().toISOString() })
      setTarget(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : t('saveFailed'))
    } finally {
      setPending(false)
    }
  }

  return { target, reason, setReason, pending, error, close, submit, openRemove, openReport }
}

export type ChatModeration = ReturnType<typeof useChatModeration>
