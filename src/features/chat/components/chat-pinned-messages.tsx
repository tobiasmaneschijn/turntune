import { useTranslation } from 'react-i18next'
import { PinOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { applyRemovalEvents, type ChatRemovedEvent } from '@/features/chat/model'
import { getVisibleMessagePreview } from '@/features/chat/visibility'
import type { ChatPins } from '@/features/chat/hooks/use-chat-pins'
import '@/styles/chat-pins.css'

interface Props {
  id: string
  pins: ChatPins
  hiddenIds: ReadonlySet<string>
  removalEvents: ChatRemovedEvent[]
  canManage: boolean
  onJumpToMessage: (messageId: string) => void
  onClose: () => void
}

export function ChatPinnedMessages({ id, pins, hiddenIds, removalEvents, canManage, onJumpToMessage, onClose }: Props) {
  const { t, i18n } = useTranslation('chat')
  const messages = new Map(applyRemovalEvents(pins.messages, removalEvents).filter(message => !message.removedAt).map(message => [message.id, message]))
  const visiblePins = pins.pins.filter(pin => messages.has(pin.messageId))
  return <section id={id} className="chat-pinned-messages" aria-label={t('pins.title', { defaultValue: 'Pinned messages' })}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="chat-pins-heading">
      <strong>{t('pins.title', { defaultValue: 'Pinned messages' })}</strong>
      <Button autoFocus type="button" variant="ghost" size="icon-sm" aria-label={t('pins.close', { defaultValue: 'Close pinned messages' })} onClick={onClose}><X size={16} /></Button>
    </div>
    {pins.loading && <p role="status">{t('pins.loading', { defaultValue: 'Loading pinned messages…' })}</p>}
    {pins.error && <div className="chat-pins-error" role="alert"><span>{pins.error}</span><Button type="button" variant="ghost" size="sm" onClick={() => void pins.retry()}>{t('retry')}</Button></div>}
    {!pins.loading && !pins.error && !visiblePins.length && <p>{t('pins.empty', { defaultValue: 'No pinned messages.' })}</p>}
    <div className="chat-pins-list">
      {visiblePins.map(pin => {
        const message = messages.get(pin.messageId)!
        const preview = getVisibleMessagePreview(message, hiddenIds)
        return <div className="chat-pin-row" key={pin.messageId}>
          <button type="button" className="chat-pin-jump" aria-label={t('viewMessage', { name: message.user.name, preview })} onClick={() => onJumpToMessage(message.id)}>
            <strong>{message.user.name}</strong>
            <time dateTime={pin.pinnedAt}>{new Date(pin.pinnedAt).toLocaleDateString(i18n.resolvedLanguage)}</time>
            <span>{preview}</span>
          </button>
          {canManage && <Button type="button" variant="ghost" size="icon-sm" disabled={pins.pendingIds.has(pin.messageId)} aria-label={t('pins.unpin', { defaultValue: 'Unpin message' })} onClick={() => void pins.setPinned(pin.messageId, false)}><PinOff size={16} /></Button>}
        </div>
      })}
    </div>
  </section>
}
