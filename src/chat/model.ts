import i18n from '../i18n'
import type { User } from '@/types'

export type ChatMessageType = 'text' | 'image' | 'gif'

export interface ChatMessage {
  id: string
  content: string
  type: ChatMessageType
  mediaUrl?: string
  storagePath?: string
  user: User
  mentions?: ChatMention[]
  replyTo?: ChatReply
  reactions?: ChatReaction[]
  poll?: ChatPoll
  createdAt: string
  removedAt?: string
}

/** A small immutable snapshot keeps replies readable without loading a thread. */
export interface ChatReply {
  id: string
  content: string
  type: ChatMessageType
  mediaUrl?: string
  user: Pick<User, 'id' | 'name' | 'isAppAdmin'>
  mentions?: ChatMention[]
  removedAt?: string
}
export interface ChatRemovedEvent { messageId:string;removedAt:string }
export function applyRemovalEvents(messages:ChatMessage[],events:ChatRemovedEvent[]):ChatMessage[]{
  const removed=new Map(events.map(event=>[event.messageId,event.removedAt]))
  return messages.map(message=>{
    const removedAt=message.removedAt||removed.get(message.id)
    const replyRemoved=message.replyTo?.removedAt||removed.get(message.replyTo?.id||'')
    const replyTo=message.replyTo&&replyRemoved?{...message.replyTo,content:i18n.t('chat:removed'),type:'text' as const,mediaUrl:undefined,mentions:[],removedAt:replyRemoved}:message.replyTo
    return removedAt?{id:message.id,user:message.user,createdAt:message.createdAt,content:i18n.t('chat:removed'),type:'text',removedAt,replyTo,reactions:[]}:replyTo!==message.replyTo?{...message,replyTo}:message
  })
}

export interface ChatMention {
  userId: string
  userName: string
  handle: string
}

export interface ChatReaction {
  emoji: string
  userId: string
  userName?: string
}

export interface ChatReactionEvent extends ChatReaction {
  id: string
  messageId: string
  action: 'add' | 'remove'
}

export interface ChatPollVote {
  userId: string
  optionIndex: number
  revision: number
}

export interface ChatPoll {
  options: string[]
  votes: ChatPollVote[]
}

export interface ChatPollVoteEvent extends ChatPollVote {
  messageId: string
}

export interface ChatMedia {
  type: Extract<ChatMessageType, 'image' | 'gif'>
  mediaUrl: string
  storagePath?: string
}

export interface ReactionGroup {
  count: number
  hasReacted: boolean
  reactors: Array<Pick<ChatReaction, 'userId' | 'userName'>>
}

export type ChatUserProfile = Pick<
  User,
  'id' | 'avatarSeed' | 'avatarKey' | 'avatarUrl' | 'isAppAdmin'
>

const reactionKey = (reaction: ChatReaction) => `${reaction.userId}\u0000${reaction.emoji}`
export const CHAT_LIVE_WINDOW_LIMIT = 1000
export function recentChatMessages(messages: ChatMessage[], limit = CHAT_LIVE_WINDOW_LIMIT): ChatMessage[] {
  return messages.length > limit ? messages.slice(-limit) : messages
}

export function createReplySnapshot(message: ChatMessage): ChatReply {
  return {
    id: message.id,
    content: message.content,
    type: message.type,
    mediaUrl: message.mediaUrl,
    mentions: message.mentions,
    user: {
      id: message.user.id,
      name: message.user.name,
      isAppAdmin: message.user.isAppAdmin,
    },
    removedAt:message.removedAt,
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
    if (!messagesById.has(message.id)||message.removedAt&&!messagesById.get(message.id)?.removedAt) messagesById.set(message.id, message)
  }

  return [...messagesById.values()].sort(compareChatMessages)
}

/** Preserve database microsecond order as well as timestamps expressed with different offsets. */
export function compareChatMessages(left: Pick<ChatMessage, 'createdAt' | 'id'>, right: Pick<ChatMessage, 'createdAt' | 'id'>) {
  const remainder = (timestamp: string) => Number((timestamp.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || '').padEnd(6, '0').slice(3, 6))
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || remainder(left.createdAt) - remainder(right.createdAt) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

/**
 * Messages keep their original text and display name, while avatars and
 * trusted admin flair follow the author's current profile.
 */
export function applyChatUserProfiles(
  messages: ChatMessage[],
  profiles: ChatUserProfile[]
): ChatMessage[] {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))

  return messages.map((message) => {
    const profile = profilesById.get(message.user.id)
    const replyProfile = message.replyTo
      ? profilesById.get(message.replyTo.user.id)
      : undefined

    return {
      ...message,
      user: profile ? {
        ...message.user,
        avatarSeed: profile.avatarSeed,
        avatarKey: profile.avatarKey,
        avatarUrl: profile.avatarUrl,
        isAppAdmin: profile.isAppAdmin,
      } : message.user,
      replyTo: message.replyTo ? {
        ...message.replyTo,
        user: replyProfile ? {
          ...message.replyTo.user,
          isAppAdmin: replyProfile.isAppAdmin,
        } : message.replyTo.user,
      } : undefined,
    }
  })
}

/** Applies transient Broadcast events on top of the last durable reaction set. */
export function applyReactionEvents(
  messages: ChatMessage[],
  events: ChatReactionEvent[],
  userNamesById: ReadonlyMap<string, string> = new Map()
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
      reactions.set(key, {
        emoji: event.emoji,
        userId: event.userId,
        userName: userNamesById.get(event.userId),
      })
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

/** One account's latest accepted vote wins, even when acknowledgements arrive out of order. */
export function coalescePollVoteEvent(events: ChatPollVoteEvent[], nextEvent: ChatPollVoteEvent): ChatPollVoteEvent[] {
  const existingIndex = events.findIndex((event) => event.messageId === nextEvent.messageId && event.userId === nextEvent.userId)
  if (existingIndex === -1) return [...events, nextEvent]
  if (events[existingIndex].revision >= nextEvent.revision) return events
  const nextEvents = [...events]
  nextEvents[existingIndex] = nextEvent
  return nextEvents
}

/** History owns the options and its durable vote revisions; only newer live votes overlay it. */
export function applyPollVoteEvents(messages: ChatMessage[], events: ChatPollVoteEvent[]): ChatMessage[] {
  const byMessage = new Map<string, ChatPollVoteEvent[]>()
  for (const event of events) {
    const pending = byMessage.get(event.messageId) || []
    pending.push(event)
    byMessage.set(event.messageId, pending)
  }
  return messages.map((message) => {
    if (!message.poll || !byMessage.has(message.id)) return message
    const votes = latestPollVotes(message.poll)
    for (const event of byMessage.get(message.id)!) {
      if (!Number.isInteger(event.optionIndex) || event.optionIndex < 0 || event.optionIndex >= message.poll.options.length ||
        !Number.isSafeInteger(event.revision) || event.revision < 1 || !event.userId) continue
      const current = votes.get(event.userId)
      if (!current || event.revision > current.revision) votes.set(event.userId, {
        userId: event.userId, optionIndex: event.optionIndex, revision: event.revision,
      })
    }
    return { ...message, poll: { options: message.poll.options, votes: [...votes.values()] } }
  })
}

export function getPollResults(poll: ChatPoll, currentUserId: string): {
  counts: number[]; totalVotes: number; selectedOption: number | null
} {
  const counts = poll.options.map(() => 0)
  let selectedOption: number | null = null
  for (const vote of latestPollVotes(poll).values()) {
    counts[vote.optionIndex] += 1
    if (vote.userId === currentUserId) selectedOption = vote.optionIndex
  }
  return { counts, totalVotes: counts.reduce((total, count) => total + count, 0), selectedOption }
}

function latestPollVotes(poll: ChatPoll): Map<string, ChatPollVote> {
  const votes = new Map<string, ChatPollVote>()
  for (const vote of poll.votes) {
    if (!vote.userId || !Number.isInteger(vote.optionIndex) || vote.optionIndex < 0 || vote.optionIndex >= poll.options.length ||
      !Number.isSafeInteger(vote.revision) || vote.revision < 1 || (votes.get(vote.userId)?.revision || 0) >= vote.revision) continue
    votes.set(vote.userId, vote)
  }
  return votes
}

export function groupReactions(
  reactions: ChatReaction[] | undefined,
  currentUserId: string
): Array<[string, ReactionGroup]> {
  const groups = new Map<string, ReactionGroup>()
  for (const reaction of reactions || []) {
    const group = groups.get(reaction.emoji) || {
      count: 0,
      hasReacted: false,
      reactors: [],
    }
    group.count += 1
    group.hasReacted ||= reaction.userId === currentUserId
    group.reactors.push({ userId: reaction.userId, userName: reaction.userName })
    groups.set(reaction.emoji, group)
  }
  return [...groups.entries()]
}

export function reactionLabel(group: ReactionGroup, currentUserId: string): string {
  const names = group.reactors.map((reactor) =>
    reactor.userId === currentUserId ? i18n.t('chat:you') : reactor.userName || i18n.t('chat:unknownListener')
  )
  const visibleNames = names.slice(0, 5)
  const remaining = names.length - visibleNames.length
  if (remaining > 0) visibleNames.push(i18n.t('chat:otherReactors', { count: remaining }))
  return new Intl.ListFormat(i18n.resolvedLanguage, { style: 'long', type: 'conjunction' }).format(visibleNames)
}

export function getMessagePreview(message: Pick<ChatMessage, 'content' | 'type' | 'removedAt'>): string {
  return message.removedAt?i18n.t('chat:removed'):message.content || (message.type === 'gif' ? i18n.t('chat:gif') : i18n.t('chat:image'))
}

export function startsNewDay(message: ChatMessage, previous?: ChatMessage): boolean {
  return !previous ||
    new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
}

export function shouldShowMessageHeader(message: ChatMessage, previous?: ChatMessage): boolean {
  if (message.replyTo) return true
  if (startsNewDay(message, previous)) return true
  if (!previous || previous.user.id !== message.user.id) return true
  const minutesSincePrevious =
    (new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) / 60_000
  return minutesSincePrevious > 5
}
