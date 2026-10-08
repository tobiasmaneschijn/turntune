import { lazy, memo, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, MoreHorizontal, Reply, SmilePlus, X } from 'lucide-react'
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
import type { ChatSaveStates } from '@/chat/delivery'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/Avatar'
import { DevFlair } from '@/components/DevFlair'
import { useChatPickerBounds } from '@/hooks/use-chat-picker-bounds'
import { useChatMediaUrl } from '@/hooks/use-chat-media-url'
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
  saveStatus?: ChatSaveStates[string]
  onRetrySave?: (messageId: string) => void
  onRetrySend?: (messageId: string) => void
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (open: boolean) => void
  reactionPickerOpen?: boolean
  onReactionPickerOpenChange?: (open: boolean) => void
  onResolveMediaUrl?: (storagePath: string) => Promise<string>
}

export const ChatMessageItem = memo(function ChatMessageItem({
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
  saveStatus,
  onRetrySave,
  onRetrySend,
  actionMenuOpen,
  onActionMenuOpenChange,
  reactionPickerOpen,
  onReactionPickerOpenChange,
  onResolveMediaUrl,
}: ChatMessageItemProps) {
  const [localReactionPicker, setLocalReactionPicker] = useState(false)
  const showReactionPicker = reactionPickerOpen ?? localReactionPicker
  const setShowReactionPicker = (open: boolean | ((current: boolean) => boolean)) => {
    const next = typeof open === 'function' ? open(showReactionPicker) : open
    if (!next && pickerRef.current?.contains(document.activeElement)) document.getElementById(`chat-message-${message.id}`)?.querySelector<HTMLButtonElement>('.chat-message-more')?.focus()
    setLocalReactionPicker(next); onReactionPickerOpenChange?.(next)
  }
  const pickerRef = useRef<HTMLDivElement>(null)
  // Reply hands focus to the composer instead of returning to the menu trigger.
  const replyFromMenuRef = useRef(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const pickerBounds = useChatPickerBounds(showReactionPicker, rowRef, 'message')
  useEffect(() => {
    if (!showReactionPicker) return
    pickerRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setShowReactionPicker(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [showReactionPicker])
  const [skinTone, setSkinTone] = useState<SkinTones>(readEmojiSkinTone)
  const reactionTooltipPrefix = useId()
  const reply = message.replyTo
  const media = useChatMediaUrl(safeChatMediaUrl(message.mediaUrl), message.storagePath, onResolveMediaUrl, rowRef)
  const mediaUrl = media.url
  const isMentioned = (message.mentions || []).some((mention) => mention.userId === currentUserId)
  const reactionGroups = useMemo(
    () => groupReactions(message.reactions, currentUserId),
    [currentUserId, message.reactions]
  )

  return (
    <div
      ref={rowRef}
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
        <DropdownMenu open={actionMenuOpen} onOpenChange={(open) => {
          if (open) replyFromMenuRef.current = false
          onActionMenuOpenChange?.(open)
        }}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="chat-message-more" aria-label={`Message actions for ${isOwnMessage ? 'your message' : message.user.name}`} />}><MoreHorizontal size={17} /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="chat-message-menu" finalFocus={() => replyFromMenuRef.current ? false : pickerRef.current?.querySelector<HTMLButtonElement>('button') ?? true}>
            <DropdownMenuItem onClick={() => { replyFromMenuRef.current = true; onReply(message) }}><Reply /> Reply</DropdownMenuItem>
            {QUICK_REACTIONS.map((emoji) => <DropdownMenuItem key={emoji} onClick={() => onReact(message, emoji)}><PlatformEmojiText text={emoji} /> React with {emoji}</DropdownMenuItem>)}
            <DropdownMenuItem onClick={() => setShowReactionPicker(true)}><SmilePlus /> More reactions</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="chat-message-actions" aria-label="Message actions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={`React with ${emoji}`}
              aria-label={`React with ${emoji}`}
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
        {showReactionPicker && createPortal(
          <div ref={pickerRef} className="chat-reaction-picker" role="dialog" aria-label={`React to ${message.user.name}'s message`} style={{ position: 'fixed', ...pickerBounds, right: 'auto' }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setShowReactionPicker(false); document.getElementById(`chat-message-${message.id}`)?.querySelector<HTMLButtonElement>('.chat-message-more')?.focus() } }}>
            <div className="chat-reaction-picker-header"><span>React to {message.user.name}'s message</span>
            <button
              type="button"
              aria-label="Close reactions"
              onClick={() => setShowReactionPicker(false)}
            >
              <X size={14} />
            </button>
            </div>
            <div className="chat-reaction-picker-body">
            <Suspense fallback={<div className="chat-reaction-picker-loading">Loading emoji…</div>}>
              <EmojiPicker
                autoFocusSearch={false}
                theme={'dark' as Theme}
                width="100%"
                height={Math.max(180, pickerBounds.height - 46)}
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
          </div>, document.body
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
                onError={media.onError}
                onLoad={media.onLoad}
              />
            </a>
          )}
          {media.failed && <Button size="sm" variant="ghost" onClick={media.retry}>Retry image</Button>}
          {message.content && message.type === 'text' && <MentionText message={message} onOpenProfile={onOpenProfile} />}
          {message.content && message.type !== 'text' && (
            <span className="sr-only">{message.content}</span>
          )}
        </div>
        {saveStatus && (
          <div className={cn('chat-message-save-state', { 'chat-message-save-failed': saveStatus.state === 'failed' || saveStatus.state === 'send-failed' })} role={saveStatus.state === 'failed' || saveStatus.state === 'send-failed' ? 'alert' : undefined}>
            {saveStatus.state === 'sending' ? 'Sending…' : saveStatus.state === 'send-failed' ? <><span>Could not confirm send</span><Button variant="ghost" size="sm" onClick={() => onRetrySend?.(message.id)}>Retry send</Button></> : saveStatus.state === 'sent-live' ? 'Sent live' : saveStatus.state === 'saved' ? <><Check size={11} /> Saved</> : saveStatus.state === 'saving' ? 'Sent live · saving history…' : <><span>Sent live · history save failed</span><Button variant="ghost" size="sm" onClick={() => onRetrySave?.(message.id)}>Retry save</Button></>}
          </div>
        )}
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
})
