import { useId } from 'react'
import { Check } from 'lucide-react'

import { getPollResults, type ChatMessage } from '@/chat/model'
import { PlatformEmojiText } from '@/components/platform-emoji-text'

interface ChatPollViewProps {
  poll: NonNullable<ChatMessage['poll']>
  currentUserId: string
  onVote: (optionIndex: number) => void
  voting?: boolean
  disabled?: boolean
  error?: string
}

export function ChatPollView({
  poll,
  currentUserId,
  onVote,
  voting = false,
  disabled = false,
  error,
}: ChatPollViewProps) {
  const id = useId()
  const { counts, totalVotes, selectedOption } = getPollResults(poll, currentUserId)

  return (
    <div className="chat-poll" aria-busy={voting || undefined}>
      <div className="chat-poll-options" role="group" aria-label="Poll options" aria-describedby={`${id}-hint`}>
        {poll.options.map((option, index) => {
          const count = counts[index] || 0
          const selected = index === selectedOption
          return (
            <button
              type="button"
              className="chat-poll-option"
              key={index}
              aria-pressed={selected}
              aria-label={`${option}, ${count} ${count === 1 ? 'vote' : 'votes'}${selected ? ', your vote' : ''}`}
              disabled={disabled || voting}
              onClick={() => { if (!selected) onVote(index) }}
            >
              <span className="chat-poll-result-fill" aria-hidden="true" style={{ width: totalVotes ? `${count / totalVotes * 100}%` : '0%' }} />
              <span className="chat-poll-option-label">
                {selected && <Check size={16} aria-hidden="true" />}
                <PlatformEmojiText text={option} />
              </span>
              <span className="chat-poll-option-count" aria-hidden="true">{count}</span>
            </button>
          )
        })}
      </div>
      <div className="chat-poll-footer">
        <span className="chat-poll-total" aria-live="polite" aria-atomic="true">{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
        <p id={`${id}-hint`}>One vote per account. You can change your vote.</p>
      </div>
      {error && <p className="chat-poll-error" role="alert">{error}</p>}
    </div>
  )
}
