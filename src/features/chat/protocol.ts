import type { ChatMessage, ChatMessageType, ChatPollVoteEvent, ChatReactionEvent, ChatReply } from './model'
import type {ChatRemovedEvent} from './model'
import { normalizeChatMentions } from './mentions'
import type { User } from '../../types'
import { normalizeChatGame, normalizeChatSong } from '../../../shared/chat-attachments'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedString(value: unknown, max: number, min = 1): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function messageType(value: unknown): value is ChatMessageType {
  return value === 'text' || value === 'image' || value === 'gif'
}

function removalTimestamp(value: unknown): string | undefined {
  return boundedString(value, 64) && Number.isFinite(Date.parse(value)) ? value : undefined
}

export function normalizeChatPollOptions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return null
  if (value.some((option) => typeof option !== 'string')) return null
  const options = (value as string[]).map((option) => option.trim())
  if (options.some((option) => option.length < 1 || option.length > 80) ||
    new Set(options.map((option) => option.toLowerCase())).size !== options.length) return null
  return options
}

/** Broadcast content is supplied by other clients, not by a trusted database. */
export function safeChatMediaUrl(value: unknown): string | undefined {
  if (!boundedString(value, 4_096)) return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

function normalizeUser(value: unknown): User | null {
  const user = record(value)
  if (!user || !boundedString(user.id, 100) || !boundedString(user.name, 32)) return null
  return {
    id: user.id,
    name: user.name,
    avatarSeed: boundedString(user.avatarSeed, 100) ? user.avatarSeed : user.id,
    avatarKey: boundedString(user.avatarKey, 64) ? user.avatarKey : undefined,
    avatarUrl: safeChatMediaUrl(user.avatarUrl),
    // Only history and server-resolved room profiles may grant this flair.
    isAppAdmin: false,
  }
}

function normalizeReply(value: unknown): ChatReply | undefined {
  const reply = record(value)
  if (!reply || !boundedString(reply.id, 100)) return undefined
  const user = normalizeUser(reply.user)
  if (!user) return undefined
  const replyUser = { id: user.id, name: user.name, isAppAdmin: false }
  const removedAt = removalTimestamp(reply.removedAt)
  if (removedAt) return { id: reply.id, content: '', type: 'text', user: replyUser, mentions: [], removedAt }
  if (!boundedString(reply.content, 500, 0) || !messageType(reply.type)) return undefined
  return {
    id: reply.id,
    content: reply.content,
    type: reply.type,
    mediaUrl: reply.type === 'text' ? undefined : safeChatMediaUrl(reply.mediaUrl),
    user: replyUser,
    mentions: normalizeChatMentions(reply.mentions),
  }
}

export function normalizeRealtimeMessage(value: unknown, options: { trustedGameResults?: boolean } = {}): ChatMessage | null {
  const message = record(value)
  if (
    !message || !boundedString(message.id, 100) ||
    !boundedString(message.createdAt, 64) || !Number.isFinite(Date.parse(message.createdAt))
  ) return null
  const user = normalizeUser(message.user)
  if (!user) return null
  const createdAt = new Date(message.createdAt).toISOString()
  const removedAt = removalTimestamp(message.removedAt)
  // A retry may confirm a message that was removed after its original send.
  // Never validate or retain its former content, attachments, or reply snapshot.
  if (removedAt) return { id: message.id, content: '', type: 'text', createdAt, user, mentions: [], reactions: [], removedAt }
  if (!boundedString(message.content, 500, 0) || !messageType(message.type)) return null
  const pollOptions = message.poll === undefined ? undefined : normalizeChatPollOptions(record(message.poll)?.options)
  if (pollOptions === null || (pollOptions && (message.type !== 'text' || !boundedString(message.content.trim(), 200)))) return null
  const mediaUrl = message.type === 'text' ? undefined : safeChatMediaUrl(message.mediaUrl)
  const song = message.type === 'text' && !pollOptions ? normalizeChatSong(message.song) : undefined
  if (message.type === 'text' ? !message.content.trim() && !song : !mediaUrl) return null
  const game = message.type === 'text' && !pollOptions ? normalizeChatGame(message.game) : undefined
  if (game && !options.trustedGameResults) {
    if (game.kind === 'trivia') delete game.round
    else delete game.result
  }
  return {
    id: message.id,
    content: pollOptions ? message.content.trim() : message.content,
    type: message.type,
    createdAt,
    user,
    mediaUrl,
    storagePath: boundedString(message.storagePath, 1_024) ? message.storagePath : undefined,
    mentions: normalizeChatMentions(message.mentions),
    replyTo: normalizeReply(message.replyTo),
    reactions: [],
    // Vote authority comes from history and accepted server vote events, never message senders.
    poll: pollOptions ? { options: pollOptions, votes: [] } : undefined,
    song,
    game,
  }
}
export function normalizeChatRemoved(value:unknown):ChatRemovedEvent|null { const event=record(value);if(!event||!boundedString(event.messageId,100)||!boundedString(event.removedAt,64)||!Number.isFinite(Date.parse(event.removedAt)))return null;return{messageId:event.messageId,removedAt:event.removedAt} }

export function normalizeRealtimePollVote(value: unknown): ChatPollVoteEvent | null {
  const event = record(value)
  if (!event || !boundedString(event.messageId, 100) || !boundedString(event.userId, 100) ||
    typeof event.optionIndex !== 'number' || !Number.isInteger(event.optionIndex) || event.optionIndex < 0 || event.optionIndex > 3 ||
    typeof event.revision !== 'number' || !Number.isSafeInteger(event.revision) || event.revision < 1) return null
  return { messageId: event.messageId, userId: event.userId, optionIndex: event.optionIndex, revision: event.revision }
}

export function normalizeRealtimeReaction(value: unknown): ChatReactionEvent | null {
  const event = record(value)
  if (
    !event || !boundedString(event.id, 100) || !boundedString(event.messageId, 100) ||
    !boundedString(event.userId, 100) || !boundedString(event.emoji, 32) ||
    (event.action !== 'add' && event.action !== 'remove')
  ) return null
  return { id: event.id, messageId: event.messageId, userId: event.userId, emoji: event.emoji, action: event.action }
}

export interface ChatTypingEvent {
  userId: string
  active: boolean
  sentAt: number
}

export function normalizeTypingEvent(value: unknown): ChatTypingEvent | null {
  const event = record(value)
  if (!event || !boundedString(event.userId, 100) || typeof event.active !== 'boolean' ||
    typeof event.sentAt !== 'number' || !Number.isFinite(event.sentAt)) return null
  return { userId: event.userId, active: event.active, sentAt: event.sentAt }
}
