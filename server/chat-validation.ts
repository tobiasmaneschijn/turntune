import { z } from 'zod'
import type { User } from './types.js'

const mediaUrl = z.string().max(4096).url().refine((value) => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
}, 'Invalid chat image.')
const mention = z.object({ userId: z.string().min(1).max(100), userName: z.string().min(1).max(32), handle: z.string().min(1).max(64) })
export const chatMessageSchema = z.object({
  id: z.string().uuid(), content: z.string().max(500), type: z.enum(['text', 'image', 'gif']),
  createdAt: z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)), 'Invalid message time.'),
  mediaUrl: mediaUrl.optional(), storagePath: z.string().max(1024).optional(), mentions: z.array(mention).max(20).default([]),
  replyTo: z.object({ id: z.string().uuid() }).optional(),
}).superRefine((message, context) => {
  if (message.type === 'text' ? !message.content.trim() : !message.mediaUrl) context.addIssue({ code: 'custom', message: 'Enter a message or choose an image.' })
})
export const chatReactionSchema = z.object({ action: z.enum(['add', 'remove']), messageId: z.string().uuid(), emoji: z.string().min(1).max(32) })
export type ChatMessageInput = z.infer<typeof chatMessageSchema>
export interface ChatReply { id: string; content: string; type: ChatMessageInput['type']; mediaUrl?: string; mentions?: ChatMessageInput['mentions']; user: Pick<User, 'id' | 'name'> }
export type RelayMessage = Omit<ChatMessageInput, 'replyTo'> & { user: User; replyTo?: ChatReply }

function canonicalMentions(mentions: ChatMessageInput['mentions']) {
  return [...new Map(mentions.map((item) => [item.userId, item])).values()]
}

export function canonicalMessage(input: ChatMessageInput, user: User, reply?: ChatReply): RelayMessage {
  if (input.storagePath && !input.storagePath.startsWith(`${user.id}/`)) throw new Error('This uploaded image belongs to another account.')
  return { ...input, createdAt: new Date(input.createdAt).toISOString(), mediaUrl: input.type === 'text' ? undefined : input.mediaUrl,
    storagePath: input.type === 'text' ? undefined : input.storagePath, user, replyTo: reply,
    mentions: canonicalMentions(input.mentions) }
}
export function immutableMessageKey(message: ChatMessageInput | RelayMessage) {
  const storagePath = message.type === 'text' ? null : message.storagePath || null
  const mediaUrl = message.type === 'text' || storagePath ? null : message.mediaUrl || null
  return JSON.stringify([message.content, message.type, mediaUrl, storagePath,
    new Date(message.createdAt).toISOString(), message.replyTo?.id || null,
    canonicalMentions(message.mentions).map(({ userId, userName, handle }) => [userId, userName, handle])])
}
