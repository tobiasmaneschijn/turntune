import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { applyRemovalEvents, type ChatRemovedEvent } from '@/features/chat/model'
import type { useChatHistory } from '@/features/chat/hooks/use-chat-history'
import { getVisibleMessagePreview } from '@/features/chat/visibility'

type SearchHistory = Pick<ReturnType<typeof useChatHistory>,
  'search' | 'searchLoading' | 'searchError' | 'searchTerm' | 'searchResults' | 'searchHasMore'>

interface ChatHistorySearchProps {
  id: string
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  onClose: () => void
  history: SearchHistory
  hiddenIds: ReadonlySet<string>
  removalEvents: ChatRemovedEvent[]
  onJumpToMessage: (messageId: string) => void
}

export function ChatHistorySearch({ id, inputRef, query, onQueryChange, onClose, history, hiddenIds, removalEvents, onJumpToMessage }: ChatHistorySearchProps) {
  const { t, i18n } = useTranslation('chat')
  return (
    <section id={id} className="chat-history-search" aria-label={t('searchHistory')} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <form onSubmit={(event) => { event.preventDefault(); void history.search(query) }}>
        <Input ref={inputRef} aria-label={t('searchSavedMessages')} value={query} maxLength={100} placeholder={t('searchMessageText')} onChange={(event) => onQueryChange(event.target.value)} />
        <Button size="sm" type="submit" disabled={history.searchLoading || query.trim().length < 2}>{t('search')}</Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t('closeSearch')} onClick={onClose}><X size={15} /></Button>
      </form>
      {history.searchLoading && <p role="status">{t('searching')}</p>}
      {history.searchError && <p role="alert">{history.searchError}</p>}
      {!history.searchLoading && history.searchTerm && !history.searchError && history.searchResults.length === 0 && <p>{t('noSearchResults', { term: history.searchTerm })}</p>}
      <div className="chat-history-results">
        {applyRemovalEvents([...history.searchResults].reverse(), removalEvents).filter((message) => !message.removedAt).map((message) => (
          <button
            key={message.id}
            type="button"
            onClick={() => onJumpToMessage(message.id)}
            aria-label={t('viewMessage', { name: message.user.name, preview: getVisibleMessagePreview(message, hiddenIds) })}
          >
            <strong>{message.user.name}</strong>
            <time>{new Date(message.createdAt).toLocaleString(i18n.resolvedLanguage)}</time>
            <span>{getVisibleMessagePreview(message, hiddenIds)}</span>
          </button>
        ))}
      </div>
      {history.searchHasMore && <Button variant="ghost" size="sm" disabled={history.searchLoading} onClick={() => void history.search(history.searchTerm, true)}>{t('moreResults')}</Button>}
    </section>
  )
}
