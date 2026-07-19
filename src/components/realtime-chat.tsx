import { ArrowDown, Plus, Reply, Search, Send, Smile, X } from 'lucide-react'
import type { SkinTones, Theme } from 'emoji-picker-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  applyReactionEvents,
  createReplySnapshot,
  getMessagePreview,
  mergeChatMessages,
  shouldShowMessageHeader,
  startsNewDay,
  type ChatMessage,
  type ChatReply,
} from '@/chat/model'
import {
  CHAT_IMAGE_ACCEPT,
  createChatStoragePath,
  fetchGiphyGifs,
  readPastedChatMedia,
  validateChatImage,
  type GiphyGif,
} from '@/chat/media'
import { persistReactionChange } from '@/chat/persistence'
import { cn } from '@/lib/utils'
import { ChatMessageItem } from '@/components/chat-message'
import { DevFlair } from '@/components/DevFlair'
import {
  chatPickerEmojiStyle,
  PlatformEmojiText,
  readEmojiSkinTone,
  saveEmojiSkinTone,
} from '@/components/platform-emoji-text'
import { useChatScroll } from '@/hooks/use-chat-scroll'
import { useRealtimeChat } from '@/hooks/use-realtime-chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { User } from '@/types'

const EmojiPicker = lazy(() => import('emoji-picker-react'))

interface RealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: User
  onMessage?: (messages: ChatMessage[]) => void
  onSend?: (message: ChatMessage) => Promise<void> | void
  messages?: ChatMessage[]
  onOpenProfile?: (userId: string) => void
  adminUserIds?: string[]
}

/**
 * Interactive room chat. `useRealtimeChat` handles low-latency Broadcast
 * delivery; the parent supplies durable history and an `onSend` persistence
 * callback. See `docs/chat.md` for the complete data flow.
 */
export const RealtimeChat = ({
  client,
  roomName,
  user,
  onMessage,
  onSend,
  onOpenProfile,
  adminUserIds = [],
  messages: initialMessages = [],
}: RealtimeChatProps) => {
  const { containerRef, scrollToBottom, isNearBottom } = useChatScroll()

  const {
    messages: realtimeMessages,
    sendMessage,
    broadcastReaction,
    reactionEvents,
    isConnected,
  } = useRealtimeChat({
    client,
    roomName,
    user,
  })
  const [newMessage, setNewMessage] = useState('')
  const [replyingTo, setReplyingTo] = useState<ChatReply | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showGiphy, setShowGiphy] = useState(false)
  const [skinTone, setSkinTone] = useState<SkinTones>(readEmojiSkinTone)
  const [giphyQuery, setGiphyQuery] = useState('')
  const [gifs, setGifs] = useState<GiphyGif[]>([])
  const [composerError, setComposerError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const pendingReactionsRef = useRef(new Set<string>())
  const previousMessageCountRef = useRef(0)
  const initializedScrollRef = useRef(false)
  const unreadStartRef = useRef<number | null>(null)
  const [giphyKey, setGiphyKey] = useState<string | undefined>(
    import.meta.env.VITE_GIPHY_API_KEY || undefined
  )
  const liveAdminUserIds = useMemo(() => new Set(adminUserIds), [adminUserIds])

  useEffect(() => {
    if (giphyKey) return
    void fetch('/api/config')
      .then((response) => response.json())
      .then((config: { giphyKey?: string | null }) => {
        if (config.giphyKey) setGiphyKey(config.giphyKey)
      })
      .catch(() => {
        // GIF support remains disabled when runtime configuration is unavailable.
      })
  }, [giphyKey])

  const baseMessages = useMemo(
    () => mergeChatMessages(initialMessages, realtimeMessages),
    [initialMessages, realtimeMessages]
  )
  const allMessages = useMemo(
    () => applyReactionEvents(baseMessages, reactionEvents),
    [baseMessages, reactionEvents]
  )

  useEffect(() => {
    if (onMessage) {
      onMessage(allMessages)
    }
  }, [allMessages, onMessage])

  useEffect(() => {
    const nextCount = allMessages.length
    const previousCount = previousMessageCountRef.current
    const addedCount = Math.max(0, nextCount - previousCount)

    if (!initializedScrollRef.current && nextCount > 0) {
      initializedScrollRef.current = true
      requestAnimationFrame(() => scrollToBottom('auto'))
    } else if (addedCount > 0) {
      const newestMessage = allMessages.at(-1)
      if (isNearBottom || newestMessage?.user.id === user.id) {
        requestAnimationFrame(() => scrollToBottom())
        setUnreadCount(0)
        unreadStartRef.current = null
      } else {
        if (unreadStartRef.current === null) unreadStartRef.current = previousCount
        setUnreadCount((current) => current + addedCount)
      }
    }

    previousMessageCountRef.current = nextCount
  }, [allMessages, isNearBottom, scrollToBottom, user.id])

  useEffect(() => {
    if (!isNearBottom) return
    setUnreadCount(0)
    unreadStartRef.current = null
  }, [isNearBottom])

  const handleSendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!newMessage.trim() || !isConnected) return

      const sentMessage = await sendMessage(newMessage, undefined, replyingTo || undefined)
      if (sentMessage) await onSend?.(sentMessage)
      setNewMessage('')
      setReplyingTo(null)
    },
    [newMessage, isConnected, sendMessage, onSend, replyingTo]
  )

  const sendMediaMessage = useCallback(
    async (
      type: 'image' | 'gif',
      mediaUrl: string,
      content: string,
      storagePath?: string
    ) => {
      if (!isConnected) return
      const sentMessage = await sendMessage(
        content,
        { type, mediaUrl, storagePath },
        replyingTo || undefined
      )
      if (sentMessage) await onSend?.(sentMessage)
      setReplyingTo(null)
    },
    [isConnected, onSend, replyingTo, sendMessage]
  )

  const selectReply = useCallback((message: ChatMessage) => {
    setReplyingTo(createReplySnapshot({
      ...message,
      user: {
        ...message.user,
        isAppAdmin: message.user.isAppAdmin || liveAdminUserIds.has(message.user.id),
      },
    }))
    setShowEmoji(false)
    setShowGiphy(false)
    requestAnimationFrame(() => messageInputRef.current?.focus())
  }, [liveAdminUserIds])

  const jumpToMessage = useCallback((messageId: string) => {
    const messageElement = document.getElementById(`chat-message-${messageId}`)
    messageElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    messageElement?.focus({ preventScroll: true })
  }, [])

  const toggleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    if (!isConnected) return
    const key = `${message.id}:${user.id}:${emoji}`
    if (pendingReactionsRef.current.has(key)) return
    pendingReactionsRef.current.add(key)

    const hasReacted = (message.reactions || []).some(
      (reaction) => reaction.userId === user.id && reaction.emoji === emoji
    )
    const action = hasReacted ? 'remove' : 'add'

    try {
      await persistReactionChange(client, {
        action,
        messageId: message.id,
        userId: user.id,
        emoji,
      })
      setComposerError('')
      await broadcastReaction({
        messageId: message.id,
        userId: user.id,
        emoji,
        action,
      })
    } catch {
      setComposerError('Could not update that reaction. Please try again.')
    } finally {
      pendingReactionsRef.current.delete(key)
    }
  }, [broadcastReaction, client, isConnected, user.id])

  const uploadImage = async (file: File) => {
    setComposerError('')
    const validationError = validateChatImage(file)
    if (validationError) return setComposerError(validationError)

    setUploading(true)
    const storagePath = createChatStoragePath(user.id, roomName, file)
    try {
      const { error } = await client.storage.from('chat-media').upload(storagePath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })
      if (error) return setComposerError(error.message)

      const { data } = client.storage.from('chat-media').getPublicUrl(storagePath)
      await sendMediaMessage('image', data.publicUrl, file.name, storagePath)
    } finally {
      setUploading(false)
    }
  }

  const pasteMedia = async (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedMedia = readPastedChatMedia(event.clipboardData)
    if (!pastedMedia) return

    event.preventDefault()
    if (pastedMedia.kind === 'file') {
      await uploadImage(pastedMedia.file)
    } else {
      await sendMediaMessage(
        pastedMedia.media.type,
        pastedMedia.media.mediaUrl,
        pastedMedia.media.content
      )
    }
  }

  const loadGifs = async (query = '') => {
    if (!giphyKey) return
    setComposerError('')

    try {
      setGifs(await fetchGiphyGifs(giphyKey, query))
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Could not load GIFs.')
    }
  }

  const toggleGiphy = () => {
    setShowEmoji(false)
    setShowGiphy((current) => {
      if (!current && !gifs.length) void loadGifs()
      return !current
    })
  }

  return (
    <div className="relative flex flex-col h-full w-full bg-background text-foreground antialiased">
      {/* Messages */}
      <div ref={containerRef} className="chat-message-scroll flex-1 overflow-y-auto p-4 space-y-4">
        {allMessages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        ) : null}
        <div className="chat-message-list space-y-1">
          {allMessages.map((message, index) => {
            const previousMessage = index > 0 ? allMessages[index - 1] : undefined
            const beginsNewDay = startsNewDay(message, previousMessage)
            const showHeader = shouldShowMessageHeader(message, previousMessage)

            return (
              <div
                key={message.id}
                className="animate-in fade-in slide-in-from-bottom-4 duration-300"
              >
                {beginsNewDay && (
                  <div className="chat-date-divider">
                    <span>
                      {new Date(message.createdAt).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                )}
                {unreadStartRef.current === index && (
                  <div className="chat-unread-divider"><span>New messages</span></div>
                )}
                <ChatMessageItem
                  message={message}
                  isOwnMessage={message.user.id === user.id}
                  currentUserId={user.id}
                  showHeader={showHeader}
                  isAuthorAppAdmin={Boolean(message.user.isAppAdmin || liveAdminUserIds.has(message.user.id))}
                  isReplyAuthorAppAdmin={Boolean(message.replyTo && (
                    message.replyTo.user.isAppAdmin || liveAdminUserIds.has(message.replyTo.user.id)
                  ))}
                  onOpenProfile={onOpenProfile}
                  onReply={selectReply}
                  onReact={(selectedMessage, emoji) => void toggleReaction(selectedMessage, emoji)}
                  onJumpToMessage={jumpToMessage}
                />
              </div>
            )
          })}
        </div>
      </div>

      {!isNearBottom && (
        <button
          type="button"
          className="chat-scroll-button"
          onClick={() => {
            scrollToBottom()
            setUnreadCount(0)
            unreadStartRef.current = null
          }}
        >
          {unreadCount > 0 && <span>{unreadCount} new</span>}
          <ArrowDown className="size-4" />
        </button>
      )}

      {(showEmoji || showGiphy) && (
        <div className={cn('chat-picker-popover', { 'chat-picker-with-reply': Boolean(replyingTo) })}>
          <div className="chat-picker-tabs" role="tablist" aria-label="Message media">
            <button
              type="button"
              role="tab"
              aria-selected={showGiphy}
              className={showGiphy ? 'active' : undefined}
              disabled={!giphyKey}
              onClick={() => {
                setShowEmoji(false)
                setShowGiphy(true)
                if (!gifs.length) void loadGifs(giphyQuery)
              }}
            >
              GIFs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showEmoji}
              className={showEmoji ? 'active' : undefined}
              onClick={() => {
                setShowGiphy(false)
                setShowEmoji(true)
              }}
            >
              Emoji
            </button>
            <button
              type="button"
              className="chat-picker-close"
              aria-label="Close media picker"
              onClick={() => { setShowEmoji(false); setShowGiphy(false) }}
            >
              <X size={15} />
            </button>
          </div>
          {showEmoji ? (
            <div className="chat-emoji-panel">
              <Suspense fallback={<div className="chat-picker-loading">Loading emoji…</div>}>
                <EmojiPicker
                  theme={'dark' as Theme}
                  width="100%"
                  height={390}
                  lazyLoadEmojis
                  emojiStyle={chatPickerEmojiStyle}
                  defaultSkinTone={skinTone}
                  previewConfig={{ showPreview: false }}
                  searchPlaceholder="Find the perfect emoji"
                  onSkinToneChange={(selectedSkinTone) => {
                    setSkinTone(selectedSkinTone)
                    saveEmojiSkinTone(selectedSkinTone)
                  }}
                  onEmojiClick={(emoji) => setNewMessage((current) => `${current}${emoji.emoji}`)}
                />
              </Suspense>
            </div>
          ) : (
            <div className="chat-gif-panel">
              <form
                className="chat-gif-search"
                onSubmit={(event) => {
                  event.preventDefault()
                  void loadGifs(giphyQuery)
                }}
              >
                <Search size={16} aria-hidden="true" />
                <Input
                  value={giphyQuery}
                  onChange={(event) => setGiphyQuery(event.target.value)}
                  placeholder="Search GIFs"
                  maxLength={50}
                />
                {giphyQuery && (
                  <button type="button" aria-label="Clear GIF search" onClick={() => setGiphyQuery('')}>
                    <X size={14} />
                  </button>
                )}
                <button type="submit" className="sr-only">Search GIFs</button>
              </form>
              <div className="chat-gif-grid">
                {[0, 1].map((column) => (
                  <div key={column}>
                    {gifs.filter((_, index) => index % 2 === column).map((gif) => (
                      <button
                        type="button"
                        key={gif.id}
                        className="chat-gif-tile"
                        onClick={() => {
                          void sendMediaMessage('gif', gif.url, gif.title || 'GIPHY GIF')
                          setShowGiphy(false)
                        }}
                      >
                        <img src={gif.preview} alt={gif.title} loading="lazy" />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <p className="chat-gif-footer">Powered by GIPHY</p>
            </div>
          )}
        </div>
      )}

      {composerError && <p className="px-4 pt-2 text-xs text-red-400">{composerError}</p>}
      <form
        onSubmit={handleSendMessage}
        className={cn('chat-composer', { 'chat-composer-replying': Boolean(replyingTo) })}
        autoComplete="off"
      >
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={CHAT_IMAGE_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadImage(file)
            event.currentTarget.value = ''
          }}
        />
        {replyingTo && (
          <div className="chat-reply-composer">
            <Reply className="size-3.5" />
            <div>
              <span>
                Replying to <strong>@{replyingTo.user.name}</strong>
                {(replyingTo.user.isAppAdmin || liveAdminUserIds.has(replyingTo.user.id)) && <DevFlair className="chat-dev-flair" />}
              </span>
              <small><PlatformEmojiText text={getMessagePreview(replyingTo)} /></small>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel reply"
              onClick={() => setReplyingTo(null)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
        <div className="chat-composer-bar">
          <Button
            className="chat-composer-add"
            type="button"
            variant="ghost"
            size="icon"
            disabled={!isConnected || uploading}
            aria-label="Upload image"
            title="Upload image"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="size-5" />
          </Button>
          <Input
            ref={messageInputRef}
            className="chat-composer-input"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            aria-autocomplete="none"
            data-form-type="other"
            value={newMessage}
            maxLength={500}
            onChange={(e) => setNewMessage(e.target.value)}
            onPaste={(event) => void pasteMedia(event)}
            placeholder={uploading ? 'Uploading image…' : `Message #${roomName.replace(/^soundspin:/, '')}`}
            disabled={!isConnected || uploading}
          />
          <Button
            className="chat-composer-gif"
            type="button"
            variant="ghost"
            size="icon"
            disabled={!isConnected || !giphyKey}
            aria-label={giphyKey ? 'Add GIF' : 'Add a GIPHY API key to enable GIFs'}
            title={giphyKey ? 'Add GIF' : 'Set VITE_GIPHY_API_KEY to enable GIFs'}
            onClick={toggleGiphy}
          >
            <span>GIF</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!isConnected}
            aria-label="Add emoji"
            title="Add emoji"
            onClick={() => { setShowGiphy(false); setShowEmoji((current) => !current) }}
          >
            <Smile className="size-[18px]" />
          </Button>
          <Button
            className="chat-send-button"
            type="submit"
            size="icon"
            disabled={!isConnected || !newMessage.trim()}
            aria-label="Send message"
            title="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
