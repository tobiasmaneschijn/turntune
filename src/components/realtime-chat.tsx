import { ArrowDown, ImagePlus, Images, Reply, Send, Smile, X } from 'lucide-react'
import type { Theme } from 'emoji-picker-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import { cn } from '@/lib/utils'
import { ChatMessageItem } from '@/components/chat-message'
import { useChatScroll } from '@/hooks/use-chat-scroll'
import {
  useRealtimeChat,
  type ChatMessage,
  type ChatReply,
} from '@/hooks/use-realtime-chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const EmojiPicker = lazy(() => import('emoji-picker-react'))

interface RealtimeChatProps {
  client: SupabaseClient
  roomName: string
  user: {
    id: string
    name: string
    avatarSeed: string
  }
  onMessage?: (messages: ChatMessage[]) => void
  onSend?: (message: ChatMessage) => Promise<void> | void
  messages?: ChatMessage[]
  onOpenProfile?: (userId: string) => void
}

/**
 * Realtime chat component
 * @param roomName - The name of the room to join. Each room is a unique chat.
 * @param username - The username of the user
 * @param onMessage - The callback function to handle the messages. Useful if you want to store the messages in a database.
 * @param messages - The messages to display in the chat. Useful if you want to display messages from a database.
 * @returns The chat component
 */
export const RealtimeChat = ({
  client,
  roomName,
  user,
  onMessage,
  onSend,
  onOpenProfile,
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
  const [giphyQuery, setGiphyQuery] = useState('')
  const [gifs, setGifs] = useState<Array<{ id: string; title: string; url: string; preview: string }>>([])
  const [mediaError, setMediaError] = useState('')
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

  // Merge realtime messages with initial messages
  const baseMessages = useMemo(() => {
    const mergedMessages = [...initialMessages, ...realtimeMessages]
    // Remove duplicates based on message id
    const uniqueMessages = mergedMessages.filter(
      (message, index, self) => index === self.findIndex((m) => m.id === message.id)
    )
    // Sort by creation date
    const sortedMessages = uniqueMessages.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    return sortedMessages
  }, [initialMessages, realtimeMessages])

  const allMessages = useMemo(() => baseMessages.map((message) => {
    const reactions = [...(message.reactions || [])]
    for (const event of reactionEvents) {
      if (event.messageId !== message.id) continue
      const reactionIndex = reactions.findIndex(
        (reaction) => reaction.userId === event.userId && reaction.emoji === event.emoji
      )
      if (event.action === 'add' && reactionIndex === -1) {
        reactions.push({ userId: event.userId, emoji: event.emoji })
      } else if (event.action === 'remove' && reactionIndex >= 0) {
        reactions.splice(reactionIndex, 1)
      }
    }
    return { ...message, reactions }
  }), [baseMessages, reactionEvents])

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
    setReplyingTo({
      id: message.id,
      content: message.content,
      type: message.type,
      mediaUrl: message.mediaUrl,
      user: { id: message.user.id, name: message.user.name },
    })
    setShowEmoji(false)
    setShowGiphy(false)
    requestAnimationFrame(() => messageInputRef.current?.focus())
  }, [])

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
    const query = client.from('soundspin_message_reactions')
    const { error } = hasReacted
      ? await query.delete().eq('message_id', message.id).eq('user_id', user.id).eq('emoji', emoji)
      : await query.insert({ message_id: message.id, user_id: user.id, emoji })

    if (error) {
      setMediaError('Could not update that reaction. The chat migration may still need to be deployed.')
    } else {
      setMediaError('')
      await broadcastReaction({
        messageId: message.id,
        userId: user.id,
        emoji,
        action: hasReacted ? 'remove' : 'add',
      })
    }
    pendingReactionsRef.current.delete(key)
  }, [broadcastReaction, client, isConnected, user.id])

  const uploadImage = async (file: File) => {
    setMediaError('')
    if (!file.type.startsWith('image/')) return setMediaError('Please choose an image file.')
    if (file.size > 6 * 1024 * 1024) return setMediaError('Images must be 6 MB or smaller.')

    setUploading(true)
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const safeRoom = roomName.replace(/[^a-zA-Z0-9-]/g, '-')
    const storagePath = `${user.id}/${safeRoom}/${crypto.randomUUID()}.${extension}`
    const { error } = await client.storage.from('chat-media').upload(storagePath, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    })
    setUploading(false)
    if (error) return setMediaError(error.message)

    const { data } = client.storage.from('chat-media').getPublicUrl(storagePath)
    await sendMediaMessage('image', data.publicUrl, file.name, storagePath)
  }

  const pasteMedia = async (event: React.ClipboardEvent<HTMLInputElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    const imageFile = imageItem?.getAsFile()
    if (imageFile) {
      event.preventDefault()
      await uploadImage(imageFile)
      return
    }

    const html = event.clipboardData.getData('text/html')
    const htmlImageUrl = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
    const plainText = event.clipboardData.getData('text/plain').trim()
    const candidate = htmlImageUrl || plainText

    try {
      const url = new URL(candidate)
      const isImageUrl =
        url.protocol === 'https:' &&
        (
          /\.(avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url.href) ||
          /(^|\.)giphy\.com$|(^|\.)giphy\.media$/i.test(url.hostname)
        )

      if (isImageUrl) {
        event.preventDefault()
        const isGif = /\.gif(?:$|[?#])/i.test(url.href) || /giphy/i.test(url.hostname)
        await sendMediaMessage(isGif ? 'gif' : 'image', url.href, isGif ? 'Pasted GIF' : 'Pasted image')
      }
    } catch {
      // Clipboard text is not an image URL, so let the browser paste it normally.
    }
  }

  const loadGifs = async (query = '') => {
    if (!giphyKey) return
    setMediaError('')
    const endpoint = query.trim() ? 'search' : 'trending'
    const params = new URLSearchParams({
      api_key: giphyKey,
      limit: '18',
      rating: 'pg',
      bundle: 'messaging_non_clips',
    })
    if (query.trim()) params.set('q', query.trim())

    try {
      const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`)
      if (!response.ok) throw new Error('Could not load GIFs.')
      const payload = await response.json() as {
        data: Array<{
          id: string
          title: string
          images: {
            fixed_width: { url: string }
            fixed_width_small?: { url: string }
          }
        }>
      }
      setGifs(payload.data.map((gif) => ({
        id: gif.id,
        title: gif.title,
        url: gif.images.fixed_width.url,
        preview: gif.images.fixed_width_small?.url || gif.images.fixed_width.url,
      })))
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Could not load GIFs.')
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
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {allMessages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        ) : null}
        <div className="space-y-1">
          {allMessages.map((message, index) => {
            const prevMessage = index > 0 ? allMessages[index - 1] : null
            const startsNewDay =
              !prevMessage ||
              new Date(prevMessage.createdAt).toDateString() !==
                new Date(message.createdAt).toDateString()
            const minutesSincePrevious = prevMessage
              ? (new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime()) / 60000
              : Number.POSITIVE_INFINITY
            const showHeader =
              !prevMessage ||
              prevMessage.user.id !== message.user.id ||
              minutesSincePrevious > 5

            return (
              <div
                key={message.id}
                className="animate-in fade-in slide-in-from-bottom-4 duration-300"
              >
                {startsNewDay && (
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
        <div className={cn(
          'absolute inset-x-3 z-10 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl',
          replyingTo ? 'bottom-40' : 'bottom-28'
        )}>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <strong className="text-xs">{showEmoji ? 'Choose an emoji' : 'Choose a GIF'}</strong>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => { setShowEmoji(false); setShowGiphy(false) }}>
              <X className="size-3.5" />
            </Button>
          </div>
          {showEmoji ? (
            <Suspense fallback={<div className="grid h-64 place-items-center text-xs text-muted-foreground">Loading emoji…</div>}>
              <EmojiPicker
                theme={'dark' as Theme}
                width="100%"
                height={340}
                lazyLoadEmojis
                onEmojiClick={(emoji) => setNewMessage((current) => `${current}${emoji.emoji}`)}
              />
            </Suspense>
          ) : (
            <div className="p-3">
              <form
                className="mb-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void loadGifs(giphyQuery)
                }}
              >
                <Input
                  value={giphyQuery}
                  onChange={(event) => setGiphyQuery(event.target.value)}
                  placeholder="Search GIPHY"
                  maxLength={50}
                />
                <Button type="submit" size="sm">Search</Button>
              </form>
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
                {gifs.map((gif) => (
                  <button
                    type="button"
                    key={gif.id}
                    className="overflow-hidden rounded-md bg-muted"
                    onClick={() => {
                      void sendMediaMessage('gif', gif.url, gif.title || 'GIPHY GIF')
                      setShowGiphy(false)
                    }}
                  >
                    <img src={gif.preview} alt={gif.title} className="h-24 w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
              <p className="mt-2 text-right text-[10px] text-muted-foreground">Powered by GIPHY</p>
            </div>
          )}
        </div>
      )}

      {mediaError && <p className="px-4 pt-2 text-xs text-red-400">{mediaError}</p>}
      <form onSubmit={handleSendMessage} className="chat-composer" autoComplete="off">
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
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
              <span>Replying to <strong>@{replyingTo.user.name}</strong></span>
              <small>{replyingTo.content || (replyingTo.type === 'gif' ? 'GIF' : 'Image')}</small>
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!isConnected}
          aria-label="Add emoji"
          onClick={() => { setShowGiphy(false); setShowEmoji((current) => !current) }}
        >
          <Smile className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!isConnected || uploading}
          aria-label="Upload image"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!isConnected || !giphyKey}
          aria-label={giphyKey ? 'Add GIF' : 'Add a GIPHY API key to enable GIFs'}
          title={giphyKey ? 'Add GIF' : 'Set VITE_GIPHY_API_KEY to enable GIFs'}
          onClick={toggleGiphy}
        >
          <Images className="size-4" />
        </Button>
        <Input
          ref={messageInputRef}
          className={cn('chat-composer-input')}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          aria-autocomplete="none"
          data-form-type="other"
          value={newMessage}
          maxLength={500}
          onChange={(e) => setNewMessage(e.target.value)}
          onPaste={(event) => void pasteMedia(event)}
          placeholder={uploading ? 'Uploading image…' : 'Type or paste an image…'}
          disabled={!isConnected || uploading}
        />
        <Button
          className="chat-send-button"
          type="submit"
          size="icon"
          disabled={!isConnected || !newMessage.trim()}
        >
          <span>Send</span>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  )
}
