import type { ChatSongAttachment } from '../../../shared/chat-attachments'
import type { ChatMessage } from './model'

export interface ChatSongMoment {
  messageId: string
  positionSeconds: number
  author: string
  text: string
}

/** Only loaded, visible comments can contribute a marker to the current song. */
export function songMoments(messages: readonly ChatMessage[], song: Pick<ChatSongAttachment, 'provider' | 'providerId' | 'durationMs'> | undefined, hiddenIds: ReadonlySet<string>): ChatSongMoment[] {
  if (!song) return []
  return messages.filter(message => !message.removedAt && !hiddenIds.has(message.id) && message.content.trim() &&
    message.song?.provider === song.provider && message.song.providerId === song.providerId &&
    Number.isFinite(message.song.positionSeconds) && message.song.positionSeconds! >= 0 &&
    (!song.durationMs || message.song.positionSeconds! <= song.durationMs / 1000))
    .slice(-24)
    .map(message => ({ messageId: message.id, positionSeconds: message.song!.positionSeconds!,
      author: message.user.name, text: message.content.replace(/\s+/g, ' ').slice(0, 160) }))
    .sort((left, right) => left.positionSeconds - right.positionSeconds)
}
