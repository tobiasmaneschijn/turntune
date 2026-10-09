import { lazy, memo, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, MoreHorizontal, Reply, SmilePlus, X,Flag,Trash2 } from 'lucide-react'
import type { SkinTones, Theme } from 'emoji-picker-react'
import { useTheme } from 'next-themes'

import {
  getMessagePreview,
  groupReactions,
  reactionLabel,
  type ChatMessage,
} from '@/chat/model'
import { HIDDEN_MESSAGE_PREVIEW } from '@/chat/visibility'
import { splitMentionText } from '@/chat/mentions'
import { safeChatMediaUrl } from '@/chat/protocol'
import { cn } from '@/lib/utils'
import type { ChatSaveStates } from '@/chat/delivery'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/Avatar'
import { ChatPollView } from '@/components/chat-poll'
import { DevFlair } from '@/components/DevFlair'
import { useChatPickerBounds } from '@/hooks/use-chat-picker-bounds'
import { useChatMediaUrl } from '@/hooks/use-chat-media-url'
import {
  chatPickerEmojiStyle,
  PlatformEmojiText,
  readEmojiSkinTone,
  saveEmojiSkinTone,
} from '@/components/platform-emoji-text'

const EmojiPicker = lazy(() => import('./accessible-emoji-picker'))
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
  isHidden: boolean
  isReplyHidden: boolean
  onHiddenChange: (messageId: string, hidden: boolean) => void
  onOpenProfile?: (userId: string) => void
  onReply: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: string) => void
  onJumpToMessage: (messageId: string) => void
  saveStatus?: ChatSaveStates[string]
  onRetrySave?: (messageId: string) => void
  onRetrySend?: (messageId: string) => void
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (messageId: string, open: boolean) => void
  reactionPickerOpen?: boolean
  onReactionPickerOpenChange?: (messageId: string, open: boolean) => void
  onResolveMediaUrl?: (storagePath: string) => Promise<string>
  onVotePoll?: (message: ChatMessage, optionIndex: number) => void
  pollVoting?: boolean
  pollVotingDisabled?: boolean
  pollVoteError?: string
  onRemove?:(message:ChatMessage)=>void
  onReport?:(message:ChatMessage)=>void
  participationDisabled?:boolean
}

export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  isOwnMessage,
  currentUserId,
  showHeader,
  isAuthorAppAdmin,
  isReplyAuthorAppAdmin,
  isHidden,
  isReplyHidden,
  onHiddenChange,
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
  onVotePoll,
  pollVoting,
  pollVotingDisabled,
  pollVoteError,
  onRemove,onReport,participationDisabled=false,
}: ChatMessageItemProps) {
  isHidden=isHidden&&!message.removedAt
  const { resolvedTheme } = useTheme()
  const [localReactionPicker, setLocalReactionPicker] = useState(false)
  const showReactionPicker = reactionPickerOpen ?? localReactionPicker
  const setShowReactionPicker = (open: boolean | ((current: boolean) => boolean)) => {
    const next = typeof open === 'function' ? open(showReactionPicker) : open
    if (!next && pickerRef.current?.contains(document.activeElement)) reactionTriggerRef.current?.focus({ preventScroll: true })
    setLocalReactionPicker(next); onReactionPickerOpenChange?.(message.id, next)
  }
  const pickerRef = useRef<HTMLDivElement>(null)
  const reactionTriggerRef = useRef<HTMLButtonElement>(null)
  const pickerOwnsFocusRef = useRef(false)
  // Reply hands focus to the composer instead of returning to the menu trigger.
  const replyFromMenuRef = useRef(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const pickerBounds = useChatPickerBounds(showReactionPicker && !isHidden, rowRef, 'message')
  useEffect(() => {
    if (!isHidden || !showReactionPicker) return
    if (pickerOwnsFocusRef.current) rowRef.current?.querySelector<HTMLButtonElement>('.chat-message-more')?.focus({ preventScroll: true })
    pickerOwnsFocusRef.current = false
    setShowReactionPicker(false)
  }, [isHidden, showReactionPicker])
  useEffect(() => {
    if (!showReactionPicker || isHidden) return
    pickerRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setShowReactionPicker(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [showReactionPicker, isHidden])
  const [skinTone, setSkinTone] = useState<SkinTones>(readEmojiSkinTone)
  const reactionTooltipPrefix = useId()
  const reply = message.replyTo
  const media = useChatMediaUrl(isHidden||message.removedAt ? undefined : safeChatMediaUrl(message.mediaUrl), isHidden||message.removedAt ? undefined : message.storagePath, onResolveMediaUrl, rowRef)
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
        'chat-message-has-reply': Boolean(reply) && !isHidden,
        'chat-message-hidden': isHidden,
      })}
    >
      {reply && !isHidden && (
        <button
          type="button"
          className="chat-message-reply"
          onClick={() => onJumpToMessage(reply.id)}
        >
          <Reply size={12} />
          <strong>{reply.user.name}</strong>
          {isReplyAuthorAppAdmin && <DevFlair className="chat-dev-flair" />}
          <PlatformEmojiText text={isReplyHidden ? HIDDEN_MESSAGE_PREVIEW : getMessagePreview(reply)} />
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
          onActionMenuOpenChange?.(message.id, open)
        }}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="chat-message-more" aria-label={`Message actions for ${isOwnMessage ? 'your message' : message.user.name}`} />}><MoreHorizontal size={17} /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="chat-message-menu" finalFocus={() => replyFromMenuRef.current ? false : true}>
            {!isHidden && !message.removedAt&&!participationDisabled&&<DropdownMenuItem onClick={() => { replyFromMenuRef.current = true; onReply(message) }}><Reply /> Reply</DropdownMenuItem>}
            {onReport&&!isOwnMessage&&<DropdownMenuItem onClick={()=>onReport(message)}><Flag/>Report</DropdownMenuItem>}
            {onRemove&&!message.removedAt&&<DropdownMenuItem onClick={()=>onRemove(message)}><Trash2/>Remove message</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => {
              setShowReactionPicker(false)
              onHiddenChange(message.id, !isHidden)
            }}>{isHidden ? <Eye /> : <EyeOff />}{isHidden ? 'Unhide message' : 'Hide message'}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!isHidden&&!message.removedAt&&!participationDisabled && <div className="chat-message-actions" aria-label="Message actions">
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
            ref={reactionTriggerRef}
            className="chat-message-react"
            type="button"
            title="More reactions"
            aria-label="More reactions"
            aria-haspopup="dialog"
            aria-expanded={showReactionPicker}
            onClick={() => setShowReactionPicker((current) => !current)}
          >
            <SmilePlus size={15} />
          </button>
          <button type="button" title="Reply" aria-label="Reply" onClick={() => onReply(message)}>
            <Reply size={15} />
          </button>
        </div>}
        {!isHidden&&!message.removedAt&&!participationDisabled && showReactionPicker && createPortal(
          <div ref={pickerRef} className="chat-reaction-picker" role="dialog" aria-label={`React to ${message.user.name}'s message`} style={{ position: 'fixed', ...pickerBounds, right: 'auto' }}
            onFocusCapture={() => { pickerOwnsFocusRef.current = true }}
            onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pickerOwnsFocusRef.current = false }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setShowReactionPicker(false); reactionTriggerRef.current?.focus({ preventScroll: true }) } }}>
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
                theme={(resolvedTheme === 'light' ? 'light' : 'dark') as Theme}
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
        {message.removedAt?<div className="chat-message-body text-muted-foreground">Message removed</div>:isHidden ? <div className="chat-message-body chat-message-hidden-placeholder" aria-label="Message hidden on this device"><EyeOff size={14} aria-hidden="true" /><span>{HIDDEN_MESSAGE_PREVIEW}</span></div> : <div className="chat-message-body">
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
          {message.poll && <ChatPollView poll={message.poll} currentUserId={currentUserId} onVote={(optionIndex) => onVotePoll?.(message, optionIndex)} voting={pollVoting} disabled={pollVotingDisabled} error={pollVoteError} />}
        </div>}
        {saveStatus && saveStatus.state !== 'saved' && saveStatus.state !== 'sent-live' && !message.removedAt && (
          <div className={cn('chat-message-save-state', { 'chat-message-save-failed': saveStatus.state === 'failed' || saveStatus.state === 'send-failed' })} role={saveStatus.state === 'failed' || saveStatus.state === 'send-failed' ? 'alert' : undefined}>
            {saveStatus.state === 'sending' ? 'Sending…' : saveStatus.state === 'send-failed' ? <><span>Could not confirm send</span><Button variant="ghost" size="sm" onClick={() => onRetrySend?.(message.id)}>Retry send</Button></> : saveStatus.state === 'saving' ? 'Saving…' : <><span>Could not confirm save</span><Button variant="ghost" size="sm" onClick={() => onRetrySave?.(message.id)}>Retry save</Button></>}
          </div>
        )}
        {!isHidden&&!message.removedAt && reactionGroups.length > 0 && (
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
                  disabled={participationDisabled}
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
