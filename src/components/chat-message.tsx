import { lazy, Suspense, useId, useMemo, useState } from 'react'
import { Reply, SmilePlus, X } from 'lucide-react'
import type { SkinTones, Theme } from 'emoji-picker-react'

import {
  getMessagePreview,
  groupReactions,
  reactionLabel,
  type ChatMessage,
} from '@/chat/model'
import { splitMentionText } from '@/chat/mentions'
import { safeChatMediaUrl } from '@/chat/protocol'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/Avatar'
import { DevFlair } from '@/components/DevFlair'
import {
  chatPickerEmojiStyle,
  PlatformEmojiText,
  readEmojiSkinTone,
  saveEmojiSkinTone,
} from '@/components/platform-emoji-text'

const EmojiPicker = lazy(() => import('emoji-picker-react'))
const QUICK_REACTIONS = ['❤️', '😂', '😮']

function MentionText({
  message,
  onOpenProfile,
}: {
  message: ChatMessage
  onOpenProfile?: (userId: string) => void
}) {
  return splitMentionText(message.content, message.mentions || []).map((part, index) =>
    part.mention ? (
      <button
        type="button"
        className="chat-mention"
        title={`Open ${part.mention.userName}'s profile`}
        key={`${part.mention.userId}:${index}`}
        onClick={() => onOpenProfile?.(part.mention!.userId)}
      >
        {part.text}
      </button>
    ) : <PlatformEmojiText text={part.text} key={`text:${index}`} />
  )
}

interface ChatMessageItemProps {
  message: ChatMessage
  isOwnMessage: boolean
  currentUserId: string
  showHeader: boolean
  isAuthorAppAdmin: boolean
  isReplyAuthorAppAdmin: boolean
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
  isAuthorAppAdmin,
  isReplyAuthorAppAdmin,
  onOpenProfile,
  onReply,
  onReact,
  onJumpToMessage,
}: ChatMessageItemProps) => {
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [skinTone, setSkinTone] = useState<SkinTones>(readEmojiSkinTone)
  const reactionTooltipPrefix = useId()
  const reply = message.replyTo
  const mediaUrl = safeChatMediaUrl(message.mediaUrl)
  const isMentioned = (message.mentions || []).some((mention) => mention.userId === currentUserId)
  const reactionGroups = useMemo(
    () => groupReactions(message.reactions, currentUserId),
    [currentUserId, message.reactions]
  )

  return (
    <div
      id={`chat-message-${message.id}`}
      tabIndex={-1}
      className={cn('chat-message-item', {
        'chat-message-grouped': !showHeader,
        'chat-message-own': isOwnMessage,
        'chat-message-mentioned': isMentioned,
        'chat-message-has-reply': Boolean(reply),
      })}
    >
      {reply && (
        <button
          type="button"
          className="chat-message-reply"
          onClick={() => onJumpToMessage(reply.id)}
        >
          <Reply size={12} />
          <strong>{reply.user.name}</strong>
          {isReplyAuthorAppAdmin && <DevFlair className="chat-dev-flair" />}
          <PlatformEmojiText text={getMessagePreview(reply)} />
        </button>
      )}
      <div className="chat-message-avatar">
        {showHeader && (
          <button type="button" title={`Open ${message.user.name}'s profile`} onClick={() => onOpenProfile?.(message.user.id)}>
            <Avatar user={message.user} size={46} />
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
              <PlatformEmojiText text={emoji} />
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
                emojiStyle={chatPickerEmojiStyle}
                defaultSkinTone={skinTone}
                previewConfig={{ showPreview: false }}
                searchPlaceholder="Find an emoji"
                onSkinToneChange={(selectedSkinTone) => {
                  setSkinTone(selectedSkinTone)
                  saveEmojiSkinTone(selectedSkinTone)
                }}
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
            {isAuthorAppAdmin && <DevFlair className="chat-dev-flair" />}
            {isMentioned && <span className="chat-mentioned-badge">Mentioned you</span>}
            <time>
              {new Date(message.createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })}
            </time>
          </div>
        )}
        <div className="chat-message-body">
          {mediaUrl && (
            <a href={mediaUrl} target="_blank" rel="noreferrer" className="chat-media-link">
              <img
                src={mediaUrl}
                alt={message.type === 'gif' ? message.content || 'GIF' : message.content || 'Shared image'}
                loading="lazy"
              />
            </a>
          )}
          {message.content && message.type === 'text' && <MentionText message={message} onOpenProfile={onOpenProfile} />}
          {message.content && message.type !== 'text' && (
            <span className="sr-only">{message.content}</span>
          )}
        </div>
        {reactionGroups.length > 0 && (
          <div className="chat-message-reactions">
            {reactionGroups.map(([emoji, group], index) => {
              const reactors = reactionLabel(group, currentUserId)
              const tooltipId = `${reactionTooltipPrefix}-${index}`
              return (
                <button
                  key={emoji}
                  type="button"
                  className={cn({ active: group.hasReacted })}
                  aria-label={`${emoji} reacted by ${reactors}`}
                  aria-describedby={tooltipId}
                  onClick={() => onReact(message, emoji)}
                >
                  <PlatformEmojiText text={emoji} />
                  <strong>{group.count}</strong>
                  <span id={tooltipId} role="tooltip" className="chat-reaction-tooltip">
                    {reactors}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
