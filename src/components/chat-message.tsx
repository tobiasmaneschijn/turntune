import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/hooks/use-realtime-chat'
import { Avatar } from '@/components/Avatar'

interface ChatMessageItemProps {
  message: ChatMessage
  isOwnMessage: boolean
  showHeader: boolean
}

export const ChatMessageItem = ({ message, isOwnMessage, showHeader }: ChatMessageItemProps) => {
  return (
    <div className={cn('chat-message-item', { 'chat-message-grouped': !showHeader })}>
      <div className="chat-message-avatar">
        {showHeader && <Avatar user={message.user} size={30} />}
      </div>
      <div className="chat-message-content">
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
      </div>
    </div>
  )
}
