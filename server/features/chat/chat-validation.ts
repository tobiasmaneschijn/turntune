import { serverT } from "../../lib/i18n.js";
import { z } from 'zod'
import type { User } from '../../types.js'
import { canonicalReactionEmoji } from './chat-reaction-catalog.js'
import { PublicRequestError } from '../../lib/public-request-error.js'
import { chatGameCommand, RPS_CHOICES, type ChatGame, type ChatSongAttachment } from '../../../shared/chat-attachments.js'

export const CHAT_MAX_REACTIONS_PER_USER = 3
export const CHAT_MAX_REACTIONS_PER_MESSAGE = 300
export const CHAT_MAX_POLL_VOTERS = 300
export const CHAT_MAX_HISTORY_MESSAGES = 50
export const CHAT_MAX_HISTORY_CHILDREN = 6000

const mediaUrl = z.string().max(4096).url().refine((value) => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
}, serverT("invalid_chat_image"))
const mention = z.object({ userId: z.string().min(1).max(100), userName: z.string().min(1).max(32), handle: z.string().min(1).max(64) })
const poll = z.object({ options: z.array(z.string().trim().min(1).max(80)).min(2).max(4) }).superRefine((value, context) => {
  if (new Set(value.options.map((option) => option.toLowerCase())).size !== value.options.length) {
    context.addIssue({ code: 'custom', message: serverT("use_different_poll_options") })
  }
})
const song = z.object({ id: z.string().min(1).max(100), positionSeconds: z.number().finite().min(0).max(7 * 86400).optional() })
const game = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('roll'), dice: z.number().int().min(1).max(10), sides: z.number().int().min(2).max(100) }),
  z.object({ kind: z.literal('pick'), options: z.array(z.string().trim().min(1).max(80)).min(2).max(20) }),
  z.object({ kind: z.literal('flip') }),
  z.object({ kind: z.literal('rps'), choice: z.enum(RPS_CHOICES) }),
  z.object({ kind: z.literal('eightball'), question: z.string().max(200).trim().min(1) }),
  z.object({ kind: z.literal('trivia') }),
]).superRefine((value, context) => {
  if (value.kind === 'pick' && new Set(value.options.map(option => option.toLocaleLowerCase())).size !== value.options.length) context.addIssue({ code: 'custom', message: 'Use different choices.' })
  if (chatGameCommand(value).length > 500) context.addIssue({ code: 'custom', message: 'Keep game choices within 500 characters.' })
})
export const chatMessageSchema = z.object({
  id: z.string().uuid(), content: z.string().max(500), type: z.enum(['text', 'image', 'gif']),
  createdAt: z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)), serverT("invalid_message_time")),
  mediaUrl: mediaUrl.optional(), storagePath: z.string().max(1024).optional(), mentions: z.array(mention).max(20).default([]),
  replyTo: z.object({ id: z.string().uuid() }).optional(),
  poll: poll.optional(),
  song: song.optional(),
  game: game.optional(),
}).superRefine((message, context) => {
  if (message.type === 'text' ? !message.content.trim() && !message.song : !message.mediaUrl) context.addIssue({ code: 'custom', message: serverT("enter_a_message_or_choose_an_image") })
  if (message.poll && (message.type !== 'text' || message.content.trim().length > 200)) {
    context.addIssue({ code: 'custom', message: serverT("polls_need_a_question_of_1_200_characters") })
  }
  if ((message.song || message.game) && (message.type !== 'text' || message.poll || (message.song && message.game))) context.addIssue({ code: 'custom', message: 'Attach a song or a game to a text message.' })
})
export const chatReactionSchema = z.object({ id: z.string().uuid().optional(), action: z.enum(['add', 'remove']), messageId: z.string().uuid(), emoji: z.string().min(1).max(32).transform((value, context) => {
  const canonical = canonicalReactionEmoji(value)
  if (!canonical) { context.addIssue({ code: 'custom', message: serverT("choose_a_supported_emoji") }); return z.NEVER }
  return canonical
}) })
export const chatPollVoteSchema = z.object({ optionIndex: z.number().int().min(0).max(3) })
export interface ChatPollVote { userId: string; optionIndex: number; revision: number }
export interface ChatPollVoteEvent extends ChatPollVote { messageId: string }
export type ChatMessageInput = z.infer<typeof chatMessageSchema>
export interface ChatReply { id: string; content: string; type: ChatMessageInput['type']; mediaUrl?: string; mentions?: ChatMessageInput['mentions']; user: Pick<User, 'id' | 'name'>; removedAt?: string }
export type RelayMessage = Omit<ChatMessageInput, 'replyTo' | 'poll' | 'song' | 'game'> & { user: User; replyTo?: ChatReply; poll?: { options: string[]; votes: ChatPollVote[] }; song?: ChatSongAttachment; game?: ChatGame; removedAt?: string }

function canonicalMentions(mentions: ChatMessageInput['mentions']) {
  return [...new Map(mentions.map((item) => [item.userId, item])).values()]
}

/** Only current room participants with visible, server-derived handles may receive mentions. */
export function resolveVisibleMentions(input: ChatMessageInput, audience: User[], senderId: string): ChatMessageInput['mentions'] {
  if (input.type !== 'text') return [] // Media captions are not visible content in the chat UI.
  const candidates = [...new Map(audience.filter(user => user.id !== senderId).map(user => [user.id, user])).values()]
  const base = (name: string) => name.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40) || 'listener'
  const counts = new Map<string, number>()
  for (const user of candidates) { const handle = base(user.name).toLocaleLowerCase(); counts.set(handle, (counts.get(handle) || 0) + 1) }
  const claimed = new Set(input.mentions.map(item => item.userId))
  return candidates.flatMap(user => {
    if (!claimed.has(user.id)) return []
    const initial = base(user.name)
    const handle = (counts.get(initial.toLocaleLowerCase()) || 0) > 1 ? `${initial}_${user.id.replaceAll('-', '').slice(0, 4)}` : initial
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|\\s)@${escaped}(?=$|[^\\p{L}\\p{N}_-])`, 'iu').test(input.content)
      ? [{ userId: user.id, userName: user.name, handle }] : []
  }).slice(0, 20)
}

export function canonicalMessage(input: ChatMessageInput, user: User, reply?: ChatReply, audience: User[] = []): RelayMessage {
  if (input.storagePath && !input.storagePath.startsWith(`${user.id}/`)) throw new PublicRequestError(serverT("this_uploaded_image_belongs_to_another_account"), 403)
  return { ...input, content: input.game ? chatGameCommand(input.game) : input.poll ? input.content.trim() : input.content, poll: input.poll ? { options: input.poll.options, votes: [] } : undefined,
    createdAt: new Date(input.createdAt).toISOString(), mediaUrl: input.type === 'text' ? undefined : input.mediaUrl,
    storagePath: input.type === 'text' ? undefined : input.storagePath, user, replyTo: reply,
    mentions: resolveVisibleMentions(input, audience, user.id), song: undefined, game: undefined }
}
export function immutableMessageKey(message: ChatMessageInput | RelayMessage) {
  const storagePath = message.type === 'text' ? null : message.storagePath || null
  const mediaUrl = message.type === 'text' || storagePath ? null : message.mediaUrl || null
  const fields: unknown[] = [message.game ? chatGameCommand(message.game) : message.poll ? message.content.trim() : message.content, message.type, mediaUrl, storagePath,
    new Date(message.createdAt).toISOString(), message.replyTo?.id || null,
    canonicalMentions(message.mentions).map(({ userId, userName, handle }) => [userId, userName, handle]), message.poll?.options || null]
  // Preserve the fingerprint of messages accepted before attachments existed.
  if (message.song || message.game) fields.push(message.song ? [message.song.id, message.song.positionSeconds ?? null] : null,
    message.game?.kind === 'roll' ? ['roll', message.game.dice, message.game.sides] :
    message.game?.kind === 'pick' ? ['pick', message.game.options] :
    message.game?.kind === 'flip' ? ['flip'] :
    message.game?.kind === 'rps' ? ['rps', message.game.choice] :
    message.game?.kind === 'eightball' ? ['eightball', message.game.question] :
    message.game?.kind === 'trivia' ? ['trivia'] : null)
  return JSON.stringify(fields)
}
