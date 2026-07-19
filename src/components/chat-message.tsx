import { lazy, Suspense, useMemo, useState } from 'react'
import { Reply, SmilePlus, X } from 'lucide-react'
import type { Theme } from 'emoji-picker-react'

import { getMessagePreview, groupReactions, type ChatMessage } from '@/chat/model'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/Avatar'

const EmojiPicker = lazy(() => import('emoji-picker-react'))
const QUICK_REACTIONS = ['❤️', '😂', '😮']

interface ChatMessageItemProps {
  message: ChatMessage
  isOwnMessage: boolean
  currentUserId: string
  showHeader: boolean
  onOpenProfile?: (userId: string) => void
  onReply: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: string) => void
  onJumpToMessage: (messageId: string) => void
}

export const ChatMessageItem = ({
  message,
  isOwnMessage,
  currentUserId,
  showHeader,
  onOpenProfile,
  onReply,
  onReact,
  onJumpToMessage,
}: ChatMessageItemProps) => {
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const reply = message.replyTo
  const reactionGroups = useMemo(
    () => groupReactions(message.reactions, currentUserId),
    [currentUserId, message.reactions]
  )

  return (
    <div
      id={`chat-message-${message.id}`}
      tabIndex={-1}
      className={cn('chat-message-item', { 'chat-message-grouped': !showHeader })}
    >
      <div className="chat-message-avatar">
        {showHeader && (
          <button type="button" title={`Open ${message.user.name}'s profile`} onClick={() => onOpenProfile?.(message.user.id)}>
            <Avatar user={message.user} size={30} />
          </button>
        )}
      </div>
      <div className="chat-message-content">
        <div className="chat-message-actions" aria-label="Message actions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={`React with ${emoji}`}
              onClick={() => onReact(message, emoji)}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            title="More reactions"
            aria-label="More reactions"
            onClick={() => setShowReactionPicker((current) => !current)}
          >
            <SmilePlus size={15} />
          </button>
          <button type="button" title="Reply" aria-label="Reply" onClick={() => onReply(message)}>
            <Reply size={15} />
          </button>
        </div>
        {showReactionPicker && (
          <div className="chat-reaction-picker">
            <button
              type="button"
              aria-label="Close reactions"
              onClick={() => setShowReactionPicker(false)}
            >
              <X size={14} />
            </button>
            <Suspense fallback={<div className="chat-reaction-picker-loading">Loading emoji…</div>}>
              <EmojiPicker
                theme={'dark' as Theme}
                width={300}
                height={320}
                lazyLoadEmojis
                onEmojiClick={(emoji) => {
                  onReact(message, emoji.emoji)
                  setShowReactionPicker(false)
                }}
              />
            </Suspense>
          </div>
        )}
        {showHeader && (
          <div className="chat-message-meta">
            <strong>{isOwnMessage ? 'You' : message.user.name}</strong>
            <time>
              {new Date(message.createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })}
            </time>
          </div>
        )}
        {reply && (
          <button
            type="button"
            className="chat-message-reply"
            onClick={() => onJumpToMessage(reply.id)}
          >
            <Reply size={12} />
            <strong>@{reply.user.name}</strong>
            <span>{getMessagePreview(reply)}</span>
          </button>
        )}
        <div className="chat-message-body">
          {message.mediaUrl && (
            <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="chat-media-link">
              <img
                src={message.mediaUrl}
                alt={message.type === 'gif' ? message.content || 'GIF' : message.content || 'Shared image'}
                loading="lazy"
              />
            </a>
          )}
          {message.content && message.type === 'text' && message.content}
          {message.content && message.type !== 'text' && (
            <span className="sr-only">{message.content}</span>
          )}
        </div>
        {reactionGroups.length > 0 && (
          <div className="chat-message-reactions">
            {reactionGroups.map(([emoji, group]) => (
              <button
                key={emoji}
                type="button"
                className={cn({ active: group.hasReacted })}
                aria-label={`${emoji}, ${group.count} ${group.count === 1 ? 'reaction' : 'reactions'}`}
                onClick={() => onReact(message, emoji)}
              >
                <span>{emoji}</span>
                <strong>{group.count}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
