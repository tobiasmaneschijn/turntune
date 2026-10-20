import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import type { SkinTones, Theme } from 'emoji-picker-react'
import { Input } from '@/components/ui/input'
import { chatPickerEmojiStyle, readEmojiSkinTone, saveEmojiSkinTone } from '@/components/platform-emoji-text'
import { approvedImageUrl } from '@/lib/remote-images'
import type { GiphyGif } from '@/features/chat/media'
import type { ChatGifs } from '@/features/chat/hooks/use-chat-gifs'
import '@/styles/chat-pickers.css'

const EmojiPicker = lazy(() => import('../../../components/accessible-emoji-picker'))

interface ChatMediaPickerProps {
  showEmoji: boolean
  showGiphy: boolean
  mediaPanelId: string
  bounds: { left: number; top: number; width: number; height: number }
  giphy: ChatGifs
  onTabChange: (emoji: boolean) => void
  onClose: () => void
  onDismiss: () => void
  onInsertEmoji: (emoji: string) => void
  onSelectGif: (gif: GiphyGif) => void
}

export function ChatMediaPicker({ showEmoji, showGiphy, mediaPanelId, bounds, giphy, onTabChange, onClose, onDismiss, onInsertEmoji, onSelectGif }: ChatMediaPickerProps) {
  const { t } = useTranslation('chat')
  const { resolvedTheme } = useTheme()
  const [skinTone, setSkinTone] = useState<SkinTones>(readEmojiSkinTone)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showEmoji && !showGiphy) return
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || pickerRef.current?.contains(target)) return
      // The opener handles its own toggle or switches between media panels.
      if (target instanceof Element && target.closest('button[aria-controls]')?.getAttribute('aria-controls') === mediaPanelId) return
      onDismiss()
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    return () => document.removeEventListener('pointerdown', dismissOutside, true)
  }, [showEmoji, showGiphy, mediaPanelId, onDismiss])
  const { height } = bounds
  if (!showEmoji && !showGiphy) return null

  return (
    <div ref={pickerRef} className="chat-picker-popover" style={{ position: 'fixed', ...bounds, bottom: 'auto', right: 'auto', '--chat-picker-body-height': `${Math.max(0, height - 44)}px` } as CSSProperties} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="chat-picker-header">
        <div className="chat-picker-tabs" role="tablist" aria-label={t('messageMedia')} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !giphy.configured) return
          event.preventDefault()
          const emoji = event.key === 'End' || (event.key !== 'Home' && !showEmoji)
          onTabChange(emoji)
          document.getElementById(`${mediaPanelId}-${emoji ? 'emoji' : 'gif'}`)?.focus()
        }}>
          <button
            type="button"
            id={`${mediaPanelId}-gif`}
            role="tab"
            aria-selected={showGiphy}
            tabIndex={showGiphy ? 0 : -1}
            aria-controls={mediaPanelId}
            className={showGiphy ? 'active' : undefined}
            disabled={!giphy.configured}
            onClick={() => {
              onTabChange(false)
            }}
          >
            {t('gifs')}
          </button>
          <button
            type="button"
            id={`${mediaPanelId}-emoji`}
            role="tab"
            aria-selected={showEmoji}
            tabIndex={showEmoji ? 0 : -1}
            aria-controls={mediaPanelId}
            className={showEmoji ? 'active' : undefined}
            onClick={() => {
              onTabChange(true)
            }}
          >
            {t('emoji')}
          </button>
        </div>
        <button
          type="button"
          className="chat-picker-close"
          aria-label={t('closeMediaPicker')}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      {showEmoji ? (
        <div id={mediaPanelId} role="tabpanel" aria-labelledby={`${mediaPanelId}-emoji`} className="chat-emoji-panel">
          <Suspense fallback={<div className="chat-picker-loading">{t('loadingEmoji')}</div>}>
            <EmojiPicker
              theme={(resolvedTheme === 'light' ? 'light' : 'dark') as Theme}
              width="100%"
              height={Math.max(180, height - 44)}
              lazyLoadEmojis
              emojiStyle={chatPickerEmojiStyle}
              defaultSkinTone={skinTone}
              previewConfig={{ showPreview: false }}
              searchPlaceholder={t('findPerfectEmoji')}
              onSkinToneChange={(selectedSkinTone) => {
                setSkinTone(selectedSkinTone)
                saveEmojiSkinTone(selectedSkinTone)
              }}
              onEmojiClick={(emoji) => onInsertEmoji(emoji.emoji)}
            />
          </Suspense>
        </div>
      ) : (
        <div id={mediaPanelId} role="tabpanel" aria-labelledby={`${mediaPanelId}-gif`} className="chat-gif-panel">
          <form
            className="chat-gif-search"
            onSubmit={(event) => { event.preventDefault(); giphy.submitSearch() }}
          >
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              aria-label={t('searchGifs')}
              value={giphy.query}
              onChange={(event) => giphy.setQuery(event.target.value)}
              placeholder={t('searchGifs')}
              maxLength={50}
            />
            {giphy.query && (
              <button type="button" aria-label={t('clearGifSearch')} onClick={() => giphy.setQuery('')}>
                <X size={14} />
              </button>
            )}
            <button type="submit" className="sr-only">{t('searchGifs')}</button>
          </form>
          {giphy.loading ? (
            <div className="chat-gif-status">{t('loadingGifs')}</div>
          ) : giphy.query.trim().length === 1 ? (
            <div className="chat-gif-status">{t('gifSearchMore')}</div>
          ) : giphy.gifs.length === 0 ? (
            <div className="chat-gif-status">{t('noGifs')}</div>
          ) : (
            <div className="chat-gif-grid">
              {[0, 1].map((column) => (
                <div key={column}>
                  {giphy.gifs.filter((_, index) => index % 2 === column).map((gif) => (
                    <button
                      type="button"
                      key={gif.id}
                      className="chat-gif-tile"
                      aria-label={gif.title || t('giphyGif')}
                      onClick={() => onSelectGif(gif)}
                    >
                      <img referrerPolicy="no-referrer" src={approvedImageUrl(gif.preview)} alt={gif.title} loading="lazy" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className="chat-gif-footer">{t('giphyAttribution')}</p>
        </div>
      )}
    </div>
  )
}
