import type { User } from '@/types'

export type ChatMessageType = 'text' | 'image' | 'gif'

export interface ChatMessage {
  id: string
  content: string
  type: ChatMessageType
  mediaUrl?: string
  storagePath?: string
  user: User
  replyTo?: ChatReply
  reactions?: ChatReaction[]
  createdAt: string
}

/** A small immutable snapshot keeps replies readable without loading a thread. */
export interface ChatReply {
  id: string
  content: string
  type: ChatMessageType
  mediaUrl?: string
  user: Pick<User, 'id' | 'name' | 'isAppAdmin'>
}

export interface ChatReaction {
  emoji: string
  userId: string
}

export interface ChatReactionEvent extends ChatReaction {
  id: string
  messageId: string
  action: 'add' | 'remove'
}

export interface ChatMedia {
  type: Extract<ChatMessageType, 'image' | 'gif'>
  mediaUrl: string
  storagePath?: string
}

export interface ReactionGroup {
  count: number
  hasReacted: boolean
}

const reactionKey = (reaction: ChatReaction) => `${reaction.userId}\u0000${reaction.emoji}`

export function createReplySnapshot(message: ChatMessage): ChatReply {
  return {
    id: message.id,
    content: message.content,
    type: message.type,
    mediaUrl: message.mediaUrl,
    user: {
      id: message.user.id,
      name: message.user.name,
      isAppAdmin: message.user.isAppAdmin,
    },
  }
}

/**
 * Persisted rows win when the same message also exists in the local realtime
 * buffer because the database copy contains durable reaction state.
 */
export function mergeChatMessages(
  persistedMessages: ChatMessage[],
  realtimeMessages: ChatMessage[]
): ChatMessage[] {
  const messagesById = new Map<string, ChatMessage>()

  for (const message of persistedMessages) messagesById.set(message.id, message)
  for (const message of realtimeMessages) {
    if (!messagesById.has(message.id)) messagesById.set(message.id, message)
  }

  return [...messagesById.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )
}

/** Applies transient Broadcast events on top of the last durable reaction set. */
export function applyReactionEvents(
  messages: ChatMessage[],
  events: ChatReactionEvent[]
): ChatMessage[] {
  const reactionsByMessage = new Map<string, Map<string, ChatReaction>>()

  for (const message of messages) {
    reactionsByMessage.set(
      message.id,
      new Map((message.reactions || []).map((reaction) => [reactionKey(reaction), reaction]))
    )
  }

  for (const event of events) {
    const reactions = reactionsByMessage.get(event.messageId)
    if (!reactions) continue

    const key = reactionKey(event)
    if (event.action === 'add') {
      reactions.set(key, { emoji: event.emoji, userId: event.userId })
    } else {
      reactions.delete(key)
    }
  }

  return messages.map((message) => ({
    ...message,
    reactions: [...(reactionsByMessage.get(message.id)?.values() || [])],
  }))
}

/** Keeps only the newest event for each message/user/emoji tuple. */
export function coalesceReactionEvent(
  events: ChatReactionEvent[],
  nextEvent: ChatReactionEvent
): ChatReactionEvent[] {
  const existingIndex = events.findIndex(
    (event) =>
      event.messageId === nextEvent.messageId &&
      event.userId === nextEvent.userId &&
      event.emoji === nextEvent.emoji
  )
  if (existingIndex === -1) return [...events, nextEvent]

  const nextEvents = [...events]
  nextEvents[existingIndex] = nextEvent
  return nextEvents
}

export function groupReactions(
  reactions: ChatReaction[] | undefined,
  currentUserId: string
): Array<[string, ReactionGroup]> {
  const groups = new Map<string, ReactionGroup>()
  for (const reaction of reactions || []) {
    const group = groups.get(reaction.emoji) || { count: 0, hasReacted: false }
    group.count += 1
    group.hasReacted ||= reaction.userId === currentUserId
    groups.set(reaction.emoji, group)
  }
  return [...groups.entries()]
}

export function getMessagePreview(message: Pick<ChatMessage, 'content' | 'type'>): string {
  return message.content || (message.type === 'gif' ? 'GIF' : 'Image')
}

export function startsNewDay(message: ChatMessage, previous?: ChatMessage): boolean {
  return !previous ||
    new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
}

export function shouldShowMessageHeader(message: ChatMessage, previous?: ChatMessage): boolean {
  if (message.replyTo) return true
  if (!previous || previous.user.id !== message.user.id) return true
  const minutesSincePrevious =
    (new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) / 60_000
  return minutesSincePrevious > 5
}
