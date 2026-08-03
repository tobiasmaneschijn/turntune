import { ArrowDown, Plus, Reply, Search, Send, Smile, X } from 'lucide-react'
import type { SkinTones, Theme } from 'emoji-picker-react'
import {
  forwardRef,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  applyChatUserProfiles,
  applyReactionEvents,
  createReplySnapshot,
  getMessagePreview,
  mergeChatMessages,
  shouldShowMessageHeader,
  startsNewDay,
  type ChatMessage,
  type ChatMention,
  type ChatReply,
} from '@/chat/model'
import {
  activeMentions,
  buildRoomMentionOptions,
  findMentionQuery,
  insertMention,
  type MentionQuery,
  type RoomMentionOption,
} from '@/chat/mentions'
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
import { Avatar } from '@/components/Avatar'
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
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
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
  roomUsers?: User[]
  isVisible?: boolean
  onUnreadCountChange?: (count: number) => void
}

export interface RealtimeChatHandle {
  focusComposer: () => void
}

const TYPING_ROOM_LIMIT = 20
const TYPING_BROADCAST_THROTTLE_MS = 2_000
const TYPING_IDLE_MS = 3_000
const GIPHY_SEARCH_DEBOUNCE_MS = 500

interface ChatMessageListProps {
  messages: ChatMessage[]
  currentUserId: string
  liveAdminUserIds: ReadonlySet<string>
  unreadMessageId?: string
  onOpenProfile?: (userId: string) => void
  onReply: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: string) => void
  onJumpToMessage: (messageId: string) => void
}

const ChatMessageList = memo(function ChatMessageList({
  messages,
  currentUserId,
  liveAdminUserIds,
  unreadMessageId,
  onOpenProfile,
  onReply,
  onReact,
  onJumpToMessage,
}: ChatMessageListProps) {
  return (
    <div className="chat-message-list space-y-1">
      {messages.map((message, index) => {
        const previousMessage = index > 0 ? messages[index - 1] : undefined
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
            {unreadMessageId === message.id && (
              <div className="chat-unread-divider"><span>New messages</span></div>
            )}
            <ChatMessageItem
              message={message}
              isOwnMessage={message.user.id === currentUserId}
              currentUserId={currentUserId}
              showHeader={showHeader}
              isAuthorAppAdmin={Boolean(message.user.isAppAdmin || liveAdminUserIds.has(message.user.id))}
              isReplyAuthorAppAdmin={Boolean(message.replyTo && (
                message.replyTo.user.isAppAdmin || liveAdminUserIds.has(message.replyTo.user.id)
              ))}
              onOpenProfile={onOpenProfile}
              onReply={onReply}
              onReact={onReact}
              onJumpToMessage={onJumpToMessage}
            />
          </div>
        )
      })}
    </div>
  )
})

/**
 * Interactive room chat. `useRealtimeChat` handles low-latency Broadcast
 * delivery; the parent supplies durable history and an `onSend` persistence
 * callback. See `docs/chat.md` for the complete data flow.
 */
export const RealtimeChat = forwardRef<RealtimeChatHandle, RealtimeChatProps>(function RealtimeChat({
  client,
  roomName,
  user,
  onMessage,
  onSend,
  onOpenProfile,
  adminUserIds = [],
  roomUsers = [],
  isVisible = true,
  onUnreadCountChange,
  messages: initialMessages = [],
}, ref) {
  const {
    containerRef,
    scrollToBottom,
    refreshPosition,
    isNearBottom,
    scrollRevision,
  } = useChatScroll()

  const {
    messages: realtimeMessages,
    sendMessage,
    broadcastReaction,
    reactionEvents,
    broadcastTyping,
    typingUserIds,
    isConnected,
  } = useRealtimeChat({
    client,
    roomName,
    user,
  })
  const [hasDraft, setHasDraft] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ChatReply | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showGiphy, setShowGiphy] = useState(false)
  const [skinTone, setSkinTone] = useState<SkinTones>(readEmojiSkinTone)
  const [giphyQuery, setGiphyQuery] = useState('')
  const [gifs, setGifs] = useState<GiphyGif[]>([])
  const [gifsLoading, setGifsLoading] = useState(false)
  const [composerError, setComposerError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [selectedMentions, setSelectedMentions] = useState<ChatMention[]>([])
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [unreadMessageIds, setUnreadMessageIds] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const draftMessageRef = useRef('')
  const pendingReactionsRef = useRef(new Set<string>())
  const previousMessageIdsRef = useRef(new Set<string>())
  const initializedScrollRef = useRef(false)
  const previousVisibilityRef = useRef(isVisible)
  const ignoreNextVisibleScrollRef = useRef(false)
  const typingActiveRef = useRef(false)
  const lastTypingBroadcastRef = useRef(0)
  const typingIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const giphyCacheRef = useRef(new Map<string, GiphyGif[]>())
  const giphyRequestRef = useRef(0)
  const giphyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [giphyConfigured, setGiphyConfigured] = useState(false)
  const liveAdminUserIds = useMemo(() => new Set(adminUserIds), [adminUserIds])
  const reactionNamesByUserId = useMemo(
    () => new Map(roomUsers.map((roomUser) => [roomUser.id, roomUser.name])),
    [roomUsers]
  )
  const roomMentionOptions = useMemo(
    () => buildRoomMentionOptions(roomUsers, user.id),
    [roomUsers, user.id]
  )
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return []
    const query = mentionQuery.query.toLocaleLowerCase()
    return roomMentionOptions.filter((option) =>
      option.mention.handle.toLocaleLowerCase().includes(query) ||
      option.user.name.toLocaleLowerCase().includes(query)
    ).slice(0, 8)
  }, [mentionQuery, roomMentionOptions])

  useEffect(() => {
    void fetch('/api/config')
      .then((response) => response.json())
      .then((config: { giphyConfigured?: boolean }) => {
        setGiphyConfigured(Boolean(config.giphyConfigured))
      })
      .catch(() => {
        // GIF support remains disabled when runtime configuration is unavailable.
      })
  }, [])

  const baseMessages = useMemo(
    () => mergeChatMessages(initialMessages, realtimeMessages),
    [initialMessages, realtimeMessages]
  )
  const profiledMessages = useMemo(
    () => applyChatUserProfiles(baseMessages, roomUsers),
    [baseMessages, roomUsers]
  )
  const allMessages = useMemo(
    () => applyReactionEvents(profiledMessages, reactionEvents, reactionNamesByUserId),
    [profiledMessages, reactionEvents, reactionNamesByUserId]
  )
  const typingNames = useMemo(() => {
    if (roomUsers.length > TYPING_ROOM_LIMIT) return []
    const typingIds = new Set(typingUserIds)
    return roomUsers
      .filter((roomUser) => roomUser.id !== user.id && typingIds.has(roomUser.id))
      .map((roomUser) => roomUser.name)
  }, [roomUsers, typingUserIds, user.id])
  const typingLabel = typingNames.length === 1
    ? `${typingNames[0]} is typing…`
    : typingNames.length === 2
      ? `${typingNames[0]} and ${typingNames[1]} are typing…`
      : typingNames.length > 2 ? 'Several people are typing…' : ''

  useImperativeHandle(ref, () => ({
    focusComposer: () => messageInputRef.current?.focus(),
  }), [])

  useEffect(() => {
    if (onMessage) {
      onMessage(allMessages)
    }
  }, [allMessages, onMessage])

  const clearUnread = useCallback(() => setUnreadMessageIds([]), [])

  useEffect(() => {
    initializedScrollRef.current = false
    ignoreNextVisibleScrollRef.current = false
    previousMessageIdsRef.current = new Set()
    previousVisibilityRef.current = isVisible
    clearUnread()
  }, [clearUnread, roomName])

  useEffect(() => {
    onUnreadCountChange?.(unreadMessageIds.length)
  }, [onUnreadCountChange, unreadMessageIds.length])

  useEffect(() => {
    const currentIds = new Set(allMessages.map((message) => message.id))
    const addedMessages = allMessages.filter(
      (message) => !previousMessageIdsRef.current.has(message.id)
    )

    if (!initializedScrollRef.current && allMessages.length > 0) {
      initializedScrollRef.current = true
      requestAnimationFrame(() => scrollToBottom('auto'))
    } else if (addedMessages.length > 0) {
      const newestMessage = addedMessages.at(-1)
      if (isVisible && (isNearBottom || newestMessage?.user.id === user.id)) {
        requestAnimationFrame(() => scrollToBottom())
        clearUnread()
      } else {
        const receivedIds = addedMessages
          .filter((message) => message.user.id !== user.id)
          .map((message) => message.id)
        if (receivedIds.length > 0) {
          setUnreadMessageIds((current) => [
            ...current,
            ...receivedIds.filter((messageId) => !current.includes(messageId)),
          ])
        }
      }
    }

    previousMessageIdsRef.current = currentIds
  }, [allMessages, clearUnread, isNearBottom, isVisible, scrollToBottom, user.id])

  useEffect(() => {
    const becameVisible = isVisible && !previousVisibilityRef.current
    previousVisibilityRef.current = isVisible
    if (becameVisible) {
      ignoreNextVisibleScrollRef.current = true
      requestAnimationFrame(refreshPosition)
      return
    }
    if (ignoreNextVisibleScrollRef.current) {
      ignoreNextVisibleScrollRef.current = false
      return
    }
    if (!isVisible || !isNearBottom) return
    clearUnread()
  }, [clearUnread, isNearBottom, isVisible, refreshPosition, scrollRevision])

  const stopTyping = useCallback(() => {
    if (typingIdleTimeoutRef.current) clearTimeout(typingIdleTimeoutRef.current)
    typingIdleTimeoutRef.current = null
    if (!typingActiveRef.current) return
    typingActiveRef.current = false
    void broadcastTyping(false)
  }, [broadcastTyping])

  const noteTyping = useCallback(() => {
    if (!isConnected || roomUsers.length > TYPING_ROOM_LIMIT) return
    const now = Date.now()
    if (
      !typingActiveRef.current ||
      now - lastTypingBroadcastRef.current >= TYPING_BROADCAST_THROTTLE_MS
    ) {
      typingActiveRef.current = true
      lastTypingBroadcastRef.current = now
      void broadcastTyping(true)
    }
    if (typingIdleTimeoutRef.current) clearTimeout(typingIdleTimeoutRef.current)
    typingIdleTimeoutRef.current = setTimeout(stopTyping, TYPING_IDLE_MS)
  }, [broadcastTyping, isConnected, roomUsers.length, stopTyping])

  useEffect(() => {
    if (roomUsers.length > TYPING_ROOM_LIMIT || !isConnected) stopTyping()
  }, [isConnected, roomUsers.length, stopTyping])

  useEffect(() => () => stopTyping(), [stopTyping])

  const handleSendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const content = draftMessageRef.current.trim()
      if (!content || !isConnected) return

      const sentMessage = await sendMessage(
        content,
        undefined,
        replyingTo || undefined,
        activeMentions(content, selectedMentions)
      )
      if (sentMessage) await onSend?.(sentMessage)
      draftMessageRef.current = ''
      if (messageInputRef.current) messageInputRef.current.value = ''
      setHasDraft(false)
      setSelectedMentions([])
      setMentionQuery(null)
      setReplyingTo(null)
      stopTyping()
    },
    [isConnected, sendMessage, onSend, replyingTo, selectedMentions, stopTyping]
  )

  const chooseMention = useCallback((option: RoomMentionOption) => {
    if (!mentionQuery) return
    const inserted = insertMention(draftMessageRef.current, mentionQuery, option.mention)
    if (inserted.text.length > 500) return
    draftMessageRef.current = inserted.text
    if (messageInputRef.current) messageInputRef.current.value = inserted.text
    setHasDraft(Boolean(inserted.text.trim()))
    setSelectedMentions((current) => [
      ...current.filter((mention) => mention.userId !== option.mention.userId),
      option.mention,
    ])
    setMentionQuery(null)
    setActiveMentionIndex(0)
    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(inserted.caret, inserted.caret)
    })
  }, [mentionQuery])

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

  const handleReaction = useCallback((message: ChatMessage, emoji: string) => {
    void toggleReaction(message, emoji)
  }, [toggleReaction])

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

  const loadGifs = useCallback(async (query = '') => {
    if (!giphyConfigured) return
    const normalizedQuery = query.trim()
    const cacheKey = normalizedQuery.toLocaleLowerCase()
    const cached = giphyCacheRef.current.get(cacheKey)
    if (cached) {
      setGifs(cached)
      setGifsLoading(false)
      return
    }

    const requestId = ++giphyRequestRef.current
    setComposerError('')
    setGifsLoading(true)

    try {
      const { data } = await client.auth.getSession()
      const results = await fetchGiphyGifs(normalizedQuery, data.session?.access_token)
      if (requestId !== giphyRequestRef.current) return
      giphyCacheRef.current.set(cacheKey, results)
      setGifs(results)
    } catch (error) {
      if (requestId !== giphyRequestRef.current) return
      setComposerError(error instanceof Error ? error.message : 'Could not load GIFs.')
      setGifs([])
    } finally {
      if (requestId === giphyRequestRef.current) setGifsLoading(false)
    }
  }, [client, giphyConfigured])

  useEffect(() => {
    if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
    giphyDebounceRef.current = null
    if (!showGiphy || !giphyConfigured) return

    const normalizedQuery = giphyQuery.trim()
    if (normalizedQuery.length === 1) {
      giphyRequestRef.current += 1
      setGifs([])
      setGifsLoading(false)
      return
    }
    if (!normalizedQuery) {
      void loadGifs()
      return
    }

    giphyDebounceRef.current = setTimeout(
      () => void loadGifs(normalizedQuery),
      GIPHY_SEARCH_DEBOUNCE_MS
    )
    return () => {
      if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
      giphyDebounceRef.current = null
    }
  }, [giphyConfigured, giphyQuery, loadGifs, showGiphy])

  const toggleGiphy = () => {
    setShowEmoji(false)
    setShowGiphy((current) => !current)
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
        <ChatMessageList
          messages={allMessages}
          currentUserId={user.id}
          liveAdminUserIds={liveAdminUserIds}
          unreadMessageId={unreadMessageIds[0]}
          onOpenProfile={onOpenProfile}
          onReply={selectReply}
          onReact={handleReaction}
          onJumpToMessage={jumpToMessage}
        />
      </div>

      {(!isNearBottom || unreadMessageIds.length > 0) && (
        <button
          type="button"
          className="chat-scroll-button"
          onClick={() => {
            scrollToBottom()
            clearUnread()
          }}
        >
          <span>{unreadMessageIds.length > 0 ? `${unreadMessageIds.length} new` : 'Jump to latest'}</span>
          <ArrowDown className="size-4" />
        </button>
      )}

      {(showEmoji || showGiphy) && (
        <div className={cn('chat-picker-popover', {
          'chat-picker-with-reply': Boolean(replyingTo),
          'chat-picker-with-typing': Boolean(typingLabel),
        })}>
          <div className="chat-picker-tabs" role="tablist" aria-label="Message media">
            <button
              type="button"
              role="tab"
              aria-selected={showGiphy}
              className={showGiphy ? 'active' : undefined}
              disabled={!giphyConfigured}
              onClick={() => {
                setShowEmoji(false)
                setShowGiphy(true)
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
                  onEmojiClick={(emoji) => {
                    const nextMessage = `${draftMessageRef.current}${emoji.emoji}`.slice(0, 500)
                    draftMessageRef.current = nextMessage
                    if (messageInputRef.current) messageInputRef.current.value = nextMessage
                    setHasDraft(Boolean(nextMessage.trim()))
                    noteTyping()
                    requestAnimationFrame(() => {
                      messageInputRef.current?.focus()
                      messageInputRef.current?.setSelectionRange(nextMessage.length, nextMessage.length)
                    })
                  }}
                />
              </Suspense>
            </div>
          ) : (
            <div className="chat-gif-panel">
              <form
                className="chat-gif-search"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (giphyDebounceRef.current) clearTimeout(giphyDebounceRef.current)
                  giphyDebounceRef.current = null
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
              {gifsLoading ? (
                <div className="chat-gif-status">Loading GIFs…</div>
              ) : giphyQuery.trim().length === 1 ? (
                <div className="chat-gif-status">Type one more character to search.</div>
              ) : gifs.length === 0 ? (
                <div className="chat-gif-status">No GIFs found.</div>
              ) : (
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
              )}
              <p className="chat-gif-footer">Powered by GIPHY</p>
            </div>
          )}
        </div>
      )}

      {typingLabel && (
        <div className="chat-typing-indicator" aria-live="polite">
          <i /><i /><i />
          <span>{typingLabel}</span>
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
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="chat-mention-picker" id="chat-mention-list" role="listbox" aria-label="Tag a listener">
            <div className="chat-mention-picker-heading"><strong>Tag someone</strong><span>In this room</span></div>
            {mentionCandidates.map((option, index) => (
              <button
                id={`chat-mention-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeMentionIndex}
                className={index === activeMentionIndex ? 'active' : undefined}
                key={option.user.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveMentionIndex(index)}
                onClick={() => chooseMention(option)}
              >
                <Avatar user={option.user} size={34} />
                <span><strong>{option.user.name}</strong><small>@{option.mention.handle}</small></span>
              </button>
            ))}
          </div>
        )}
        <InputGroup className="chat-composer-bar">
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
          <InputGroupInput
            ref={messageInputRef}
            className="chat-composer-input"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            aria-autocomplete="list"
            aria-controls={mentionQuery && mentionCandidates.length ? 'chat-mention-list' : undefined}
            aria-expanded={Boolean(mentionQuery && mentionCandidates.length)}
            aria-activedescendant={mentionQuery && mentionCandidates.length ? `chat-mention-option-${activeMentionIndex}` : undefined}
            data-form-type="other"
            maxLength={500}
            onChange={(event) => {
              const nextMessage = event.target.value
              draftMessageRef.current = nextMessage
              const nextHasDraft = Boolean(nextMessage.trim())
              setHasDraft((current) => current === nextHasDraft ? current : nextHasDraft)
              setSelectedMentions((current) => current.length > 0
                ? activeMentions(nextMessage, current)
                : current)
              setMentionQuery(findMentionQuery(nextMessage, event.target.selectionStart))
              setActiveMentionIndex(0)
              if (nextMessage.trim()) noteTyping()
              else stopTyping()
            }}
            onKeyDown={(event) => {
              if (!mentionQuery || mentionCandidates.length === 0) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveMentionIndex((current) => (current + 1) % mentionCandidates.length)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length)
              } else if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                chooseMention(mentionCandidates[activeMentionIndex] || mentionCandidates[0])
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setMentionQuery(null)
              }
            }}
            onClick={(event) => setMentionQuery(findMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart))}
            onBlur={() => {
              setMentionQuery(null)
              stopTyping()
            }}
            onPaste={(event) => void pasteMedia(event)}
            placeholder={uploading ? 'Uploading image…' : `Message #${roomName.replace(/^soundspin:/, '')}`}
            disabled={!isConnected || uploading}
          />
          <Button
            className="chat-composer-gif"
            type="button"
            variant="ghost"
            size="icon"
            disabled={!isConnected || !giphyConfigured}
            aria-label={giphyConfigured ? 'Add GIF' : 'Add a GIPHY API key to enable GIFs'}
            title={giphyConfigured ? 'Add GIF' : 'Set GIPHY_API_KEY to enable GIFs'}
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
            disabled={!isConnected || !hasDraft}
            aria-label="Send message"
            title="Send message"
          >
            <Send className="size-4" />
          </Button>
        </InputGroup>
      </form>
    </div>
  )
})
