import { useTranslation } from 'react-i18next'
import { approvedImageUrl } from "../../../lib/remote-images"
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
} from '@/features/chat/model'
import { splitMentionText } from '@/features/chat/mentions'
import { safeChatMediaUrl } from '@/features/chat/protocol'
import { cn } from '@/lib/utils'
import type { ChatSaveStates } from '@/features/chat/delivery'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/Avatar'
import { ChatPollView } from '@/features/chat/components/chat-poll'
import { DevFlair } from '@/components/DevFlair'
import { useChatPickerBounds } from '@/features/chat/hooks/use-chat-picker-bounds'
import { useChatMediaUrl } from '@/features/chat/hooks/use-chat-media-url'
import {
  chatPickerEmojiStyle,
  PlatformEmojiText,
  readEmojiSkinTone,
  saveEmojiSkinTone,
} from '@/components/platform-emoji-text'

const EmojiPicker = lazy(() => import('../../../components/accessible-emoji-picker'))
const QUICK_REACTIONS = ['❤️', '😂', '😮']

function MentionText({
  message,
  onOpenProfile,
}: {
  message: ChatMessage
  onOpenProfile?: (userId: string) => void
}) {
  const { t } = useTranslation('chat')
  return splitMentionText(message.content, message.mentions || []).map((part, index) =>
    part.mention ? (
      <button
        type="button"
        className="chat-mention"
        title={t('openProfile', { name: part.mention.userName })}
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
  const { t, i18n } = useTranslation('chat')
  isHidden=isHidden&&!message.removedAt
  const { resolvedTheme } = useTheme()
  const [localReactionPicker, setLocalReactionPicker] = useState(false)
  const showReactionPicker = reactionPickerOpen ?? localReactionPicker
  const setShowReactionPicker = (open: boolean | ((current: boolean) => boolean)) => {
    const next = typeof open === 'function' ? open(showReactionPicker) : open
    if (!next && pickerRef.current?.contains(document.activeElement)) {
      const trigger = reactionFromMenuRef.current ? moreTriggerRef.current : reactionTriggerRef.current
      trigger?.focus({ preventScroll: true })
    }
    setLocalReactionPicker(next); onReactionPickerOpenChange?.(message.id, next)
  }
  const pickerRef = useRef<HTMLDivElement>(null)
  const reactionTriggerRef = useRef<HTMLButtonElement>(null)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const reactionFromMenuRef = useRef(false)
  const pickerOwnsFocusRef = useRef(false)
  // Reply and React hand focus to their destination after the menu closes.
  const menuHandsOffFocusRef = useRef(false)
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
  const mediaUrl = approvedImageUrl(media.url)
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
          <PlatformEmojiText text={isReplyHidden ? t('hidden') : getMessagePreview(reply)} />
        </button>
      )}
      <div className="chat-message-avatar">
        {showHeader && (
          <button type="button" title={t('openProfile', { name: message.user.name })} onClick={() => onOpenProfile?.(message.user.id)}>
            <Avatar user={message.user} size={46} />
          </button>
        )}
      </div>
      <div className="chat-message-content">
        <DropdownMenu open={actionMenuOpen} onOpenChange={(open) => {
          if (open) menuHandsOffFocusRef.current = false
          onActionMenuOpenChange?.(message.id, open)
        }}>
          <DropdownMenuTrigger render={<Button ref={moreTriggerRef} variant="ghost" size="icon-sm" className="chat-message-more" aria-label={isOwnMessage ? t('ownMessageActions') : t('namedMessageActions', { name: message.user.name })} />}><MoreHorizontal size={17} /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="chat-message-menu" finalFocus={() => menuHandsOffFocusRef.current ? false : true}>
            {!isHidden && !message.removedAt&&!participationDisabled&&<>
              <DropdownMenuItem onClick={() => { menuHandsOffFocusRef.current = true; onReply(message) }}><Reply /> {t('reply')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                menuHandsOffFocusRef.current = true
                reactionFromMenuRef.current = true
                setShowReactionPicker(true)
              }}><SmilePlus />{t('react')}</DropdownMenuItem>
            </>}
            {onReport&&!isOwnMessage&&<DropdownMenuItem onClick={()=>onReport(message)}><Flag/>{t('report')}</DropdownMenuItem>}
            {onRemove&&!message.removedAt&&<DropdownMenuItem onClick={()=>onRemove(message)}><Trash2/>{t('removeMessage')}</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => {
              setShowReactionPicker(false)
              onHiddenChange(message.id, !isHidden)
            }}>{isHidden ? <Eye /> : <EyeOff />}{isHidden ? t('unhideMessage') : t('hideMessage')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!isHidden&&!message.removedAt&&!participationDisabled && <div className="chat-message-actions" aria-label={t('messageActions')}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={t('reactWith', { emoji })}
              aria-label={t('reactWith', { emoji })}
              onClick={() => onReact(message, emoji)}
            >
              <PlatformEmojiText text={emoji} />
            </button>
          ))}
          <button
            ref={reactionTriggerRef}
            className="chat-message-react"
            type="button"
            title={t('moreReactions')}
            aria-label={t('moreReactions')}
            aria-haspopup="dialog"
            aria-expanded={showReactionPicker}
            onClick={() => { reactionFromMenuRef.current = false; setShowReactionPicker((current) => !current) }}
          >
            <SmilePlus size={15} />
          </button>
          <button type="button" title={t('reply')} aria-label={t('reply')} onClick={() => onReply(message)}>
            <Reply size={15} />
          </button>
        </div>}
        {!isHidden&&!message.removedAt&&!participationDisabled && showReactionPicker && createPortal(
          <div ref={pickerRef} className="chat-reaction-picker" role="dialog" aria-label={t('reactTo', { name: message.user.name })} style={{ position: 'fixed', ...pickerBounds, right: 'auto' }}
            onFocusCapture={() => { pickerOwnsFocusRef.current = true }}
            onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pickerOwnsFocusRef.current = false }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setShowReactionPicker(false) } }}>
            <div className="chat-reaction-picker-header"><span>{t('reactTo', { name: message.user.name })}</span>
            <button
              type="button"
              aria-label={t('closeReactions')}
              onClick={() => setShowReactionPicker(false)}
            >
              <X size={14} />
            </button>
            </div>
            <div className="chat-reaction-picker-body">
            <Suspense fallback={<div className="chat-reaction-picker-loading">{t('loadingEmoji')}</div>}>
              <EmojiPicker
                autoFocusSearch={false}
                theme={(resolvedTheme === 'light' ? 'light' : 'dark') as Theme}
                width="100%"
                height={Math.max(180, pickerBounds.height - 46)}
                lazyLoadEmojis
                emojiStyle={chatPickerEmojiStyle}
                defaultSkinTone={skinTone}
                previewConfig={{ showPreview: false }}
                searchPlaceholder={t('findEmoji')}
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
            <strong>{isOwnMessage ? t('you') : message.user.name}</strong>
            {isAuthorAppAdmin && <DevFlair className="chat-dev-flair" />}
            {isMentioned && <span className="chat-mentioned-badge">{t('mentionedYou')}</span>}
            <time>
              {new Date(message.createdAt).toLocaleTimeString(i18n.resolvedLanguage, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
        )}
        {message.removedAt?<div className="chat-message-body text-muted-foreground">{t('removed')}</div>:isHidden ? <div className="chat-message-body chat-message-hidden-placeholder" aria-label={t('hiddenOnDevice')}><EyeOff size={14} aria-hidden="true" /><span>{t('hidden')}</span></div> : <div className="chat-message-body">
          {mediaUrl && (
            <a href={mediaUrl} target="_blank" rel="noreferrer" className="chat-media-link">
              <img
                src={approvedImageUrl(mediaUrl)}
                referrerPolicy="no-referrer"
                alt={message.type === 'gif' ? message.content || t('gif') : message.content || t('sharedImage')}
                loading="lazy"
                onError={media.onError}
                onLoad={media.onLoad}
              />
            </a>
          )}
          {media.failed && <Button size="sm" variant="ghost" onClick={media.retry}>{t('retryImage')}</Button>}
          {message.content && message.type === 'text' && <MentionText message={message} onOpenProfile={onOpenProfile} />}
          {message.content && message.type !== 'text' && (
            <span className="sr-only">{message.content}</span>
          )}
          {message.poll && <ChatPollView poll={message.poll} currentUserId={currentUserId} onVote={(optionIndex) => onVotePoll?.(message, optionIndex)} voting={pollVoting} disabled={pollVotingDisabled} error={pollVoteError} />}
        </div>}
        {saveStatus && saveStatus.state !== 'saved' && saveStatus.state !== 'sent-live' && !message.removedAt && (
          <div className={cn('chat-message-save-state', { 'chat-message-save-failed': saveStatus.state === 'failed' || saveStatus.state === 'send-failed' })} role={saveStatus.state === 'failed' || saveStatus.state === 'send-failed' ? 'alert' : 'status'}>
            {saveStatus.state === 'queued' ? t('queued') : saveStatus.state === 'sending' ? t('sending') : saveStatus.state === 'send-failed' ? <><span>{t('confirmSendFailed')}</span><Button variant="ghost" size="sm" onClick={() => onRetrySend?.(message.id)}>{t('retrySend')}</Button></> : saveStatus.state === 'saving' ? t('saving') : <><span>{t('confirmSaveFailed')}</span><Button variant="ghost" size="sm" onClick={() => onRetrySave?.(message.id)}>{t('retrySave')}</Button></>}
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
                  aria-label={t('reactedBy', { emoji, names: reactors })}
                  aria-describedby={tooltipId}
                  onClick={() => onReact(message, emoji)}
                  disabled={participationDisabled}
                >
                  <PlatformEmojiText text={emoji} />
                  <strong>{group.count.toLocaleString(i18n.resolvedLanguage)}</strong>
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
