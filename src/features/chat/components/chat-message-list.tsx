import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shouldShowMessageHeader, startsNewDay, type ChatMessage } from '@/features/chat/model'
import type { ChatSaveStates } from '@/features/chat/delivery'
import { ChatMessageItem } from '@/features/chat/components/chat-message'

interface ChatMessageListProps {
  messages: ChatMessage[]
  hiddenIds: ReadonlySet<string>
  onHiddenChange: (messageId: string, hidden: boolean) => void
  onResolveMediaUrl?: (storagePath: string) => Promise<string>
  currentUserId: string
  liveAdminUserIds: ReadonlySet<string>
  unreadMessageId?: string
  onOpenProfile?: (userId: string) => void
  onReply: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: string) => void
  onJumpToMessage: (messageId: string) => void
  saveStates: ChatSaveStates
  onRetrySave: (messageId: string) => void
  onRetrySend: (messageId: string) => void
  onVotePoll: (message: ChatMessage, optionIndex: number) => void
  pollVoteStates: Record<string, { pending: boolean; error?: string }>
  pollVotingEnabled: boolean
  onRemove?: (message: ChatMessage) => void
  onReport?: (message: ChatMessage) => void
  canRemoveMessage?: (message: ChatMessage) => boolean
  participationDisabled?: boolean
}

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  hiddenIds,
  onHiddenChange,
  onResolveMediaUrl,
  currentUserId,
  liveAdminUserIds,
  unreadMessageId,
  onOpenProfile,
  onReply,
  onReact,
  onJumpToMessage,
  saveStates,
  onRetrySave,
  onRetrySend,
  onVotePoll,
  pollVoteStates,
  pollVotingEnabled,
  onRemove,
  onReport,
  canRemoveMessage,
  participationDisabled,
}: ChatMessageListProps) {
  const { t, i18n } = useTranslation('chat')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [openPickerId, setOpenPickerId] = useState<string | null>(null)
  const handleActionMenuOpenChange = useCallback((messageId: string, open: boolean) => {
    setOpenMenuId((current) => open ? messageId : current === messageId ? null : current)
    if (open) setOpenPickerId(null)
  }, [])
  const handleReactionPickerOpenChange = useCallback((messageId: string, open: boolean) => {
    setOpenPickerId((current) => open ? messageId : current === messageId ? null : current)
    if (open) setOpenMenuId(null)
  }, [])
  return (
    <div className="chat-message-list space-y-1">
      {messages.map((message, index) => {
        const previousMessage = index > 0 ? messages[index - 1] : undefined
        const beginsNewDay = startsNewDay(message, previousMessage)
        const showHeader = shouldShowMessageHeader(message, previousMessage)

        return (
          <div
            key={message.id}
            className="chat-message-wrapper"
          >
            {beginsNewDay && (
              <div className="chat-date-divider">
                <span>
                  {new Date(message.createdAt).toLocaleDateString(i18n.resolvedLanguage, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}
            {unreadMessageId === message.id && (
              <div className="chat-unread-divider"><span>{t('newMessages')}</span></div>
            )}
            <ChatMessageItem
              message={message}
              isHidden={hiddenIds.has(message.id)}
              isReplyHidden={Boolean(message.replyTo && hiddenIds.has(message.replyTo.id))}
              onHiddenChange={onHiddenChange}
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
              saveStatus={message.user.id === currentUserId ? saveStates[message.id] : undefined}
              onRetrySave={onRetrySave}
              onRetrySend={onRetrySend}
              onVotePoll={onVotePoll}
              pollVoting={pollVoteStates[message.id]?.pending}
              pollVoteError={pollVoteStates[message.id]?.error}
              pollVotingDisabled={!pollVotingEnabled}
              onResolveMediaUrl={onResolveMediaUrl}
              onRemove={canRemoveMessage && !canRemoveMessage(message) ? undefined : onRemove}
              onReport={onReport}
              participationDisabled={participationDisabled}
              actionMenuOpen={openMenuId === message.id}
              onActionMenuOpenChange={handleActionMenuOpenChange}
              reactionPickerOpen={openPickerId === message.id}
              onReactionPickerOpenChange={handleReactionPickerOpenChange}
            />
          </div>
        )
      })}
    </div>
  )
})
