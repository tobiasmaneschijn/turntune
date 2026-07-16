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
    <div className={`flex mt-2 gap-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
      {!isOwnMessage && showHeader && (
        <Avatar user={message.user} size={28} />
      )}
      <div
        className={cn('max-w-[75%] w-fit flex flex-col gap-1', {
          'items-end': isOwnMessage,
        })}
      >
        {showHeader && (
          <div
            className={cn('flex items-center gap-2 text-xs px-3', {
              'justify-end flex-row-reverse': isOwnMessage,
            })}
          >
            <span className={'font-medium'}>{message.user.name}</span>
            <span className="text-foreground/50 text-xs">
              {new Date(message.createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })}
            </span>
          </div>
        )}
        <div
          className={cn(
            'py-2 px-3 rounded-xl text-sm w-fit',
            isOwnMessage ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
          )}
        >
          {message.mediaUrl && (
            <img
              src={message.mediaUrl}
              alt={message.type === 'gif' ? message.content || 'GIF' : message.content || 'Shared image'}
              className="mb-1 max-h-64 w-full rounded-lg object-contain"
              loading="lazy"
            />
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
