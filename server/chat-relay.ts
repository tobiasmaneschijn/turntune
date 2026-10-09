import { z } from 'zod'
import { canonicalMessage, chatMessageSchema, chatReactionSchema, immutableMessageKey, type ChatReply, type RelayMessage } from './chat-validation.js'
import type { User } from './types.js'
import type { StoredChatMessage } from './chat-history.js'
import { createChatWritePolicy, type ChatWritePolicy } from './chat-write-policy.js'
import type { ChatCommandService } from './chat-command-service.js'

type EventKind = 'message' | 'reaction' | 'typing'
type Reply = { ok: boolean; error?: string }
export interface ChatRelayOptions {
  getMembership: (socketId: string) => { room: { id: string }; user: User } | null
  canWriteRoom: (userId: string, roomId: string) => Promise<boolean>
  /** Delivery must include only currently authorized admitted recipients. */
  emitToRoom: (roomId: string, event: `chat:${EventKind}`, payload: unknown, origin: { socketId: string; userId: string }) => void | Promise<void>
  loadReply: (roomId: string, messageId: string) => Promise<ChatReply | null>
  loadMessageById: (messageId: string) => Promise<StoredChatMessage | null>
  resolveMediaUrl?: (roomId: string, storagePath: string, userId: string) => Promise<string>
  now?: () => number
  writePolicy?: ChatWritePolicy
  commands?: ChatCommandService
}

/** Room admission is checked for every event, including duplicate retries. Never opens a public topic. */
export function createChatRelay(options: ChatRelayOptions) {
  const now = options.now || Date.now
  const writePolicy = options.writePolicy || createChatWritePolicy(now)
  const accepted = new Map<string, { roomId: string; userId: string; key: string; payload: unknown; pending: Promise<void>; expiresAt: number }>()
  const publishOnce = async (id: string, roomId: string, userId: string, key: string, event: `chat:${EventKind}`, socketId: string, createPayload: () => Promise<unknown>) => {
    const existing = accepted.get(id)
    if (existing && existing.expiresAt > now()) {
      if (existing.roomId !== roomId || existing.userId !== userId || existing.key !== key) throw new Error('This message ID was already used for different content.')
      await existing.pending
      return
    }
    const record = { roomId, userId, key, payload: undefined as unknown, pending: Promise.resolve(), expiresAt: now() + 24 * 60 * 60_000 }
    accepted.set(id, record)
    // Record before the first await, so concurrent uncertain-ACK retries share this operation.
    record.pending = Promise.resolve().then(createPayload).then(async (payload) => { record.payload = payload; if (payload !== null) await options.emitToRoom(roomId, event, payload, { socketId, userId }) })
      .catch((error: unknown) => { if (accepted.get(id) === record) accepted.delete(id); throw error })
    if (accepted.size > 20_000) accepted.delete(accepted.keys().next().value!)
    await record.pending
  }
  return {
    async handle(socketId: string, kind: EventKind, value: unknown): Promise<Reply> {
      try {
        const envelope = z.object({ roomId: z.string().regex(/^[a-z0-9-]{3,48}$/), message: z.unknown().optional(), reaction: z.unknown().optional(), typing: z.unknown().optional() }).parse(value)
        const membership = options.getMembership(socketId)
        if (!membership || membership.room.id !== envelope.roomId || !await options.canWriteRoom(membership.user.id, envelope.roomId)) return { ok: false, error: 'Join this room before using its chat.' }
        // An admission query may yield while the socket leaves or changes room.
        const latest = options.getMembership(socketId)
        if (!latest || latest.room.id !== envelope.roomId || latest.user.id !== membership.user.id) return { ok: false, error: 'This room session has ended.' }
        const roomId = envelope.roomId
        const user = latest.user
        if (options.commands && kind === 'message') {
          await options.commands.message(roomId,user.id,envelope.message)
          return {ok:true}
        }
        if (options.commands && kind === 'reaction') {
          await options.commands.reaction(roomId,user.id,envelope.reaction)
          return {ok:true}
        }
        if (kind === 'message') {
          const input = chatMessageSchema.parse(envelope.message)
          const message = canonicalMessage(input, user)
          const key = immutableMessageKey(input)
          await publishOnce(input.id, roomId, user.id, key, 'chat:message', socketId, async () => {
            // A fresh process/cache miss must not let an admitted sender rewrite another stored UUID live.
            // Lookup errors propagate: database outage is not proof that the UUID is unused.
            const stored = await options.loadMessageById(input.id)
            if (stored) {
              if (stored.roomId !== roomId || stored.userId !== user.id || immutableMessageKey(stored.message) !== key) throw new Error('This message ID already belongs to different content, account, or room.')
              writePolicy.message(roomId, user.id, input, true)
              const current = options.getMembership(socketId)
              if (!current || current.room.id !== roomId || current.user.id !== user.id || !await options.canWriteRoom(user.id, roomId)) throw new Error('This room session has ended.')
              return null // The durable original proves acceptance; uncertain ACK retry must not rebroadcast it.
            }
            writePolicy.message(roomId, user.id, input)
            const reply = input.replyTo ? await options.loadReply(roomId, input.replyTo.id) : undefined
            if (input.replyTo && !reply) throw new Error('The message you replied to is unavailable.')
            if (input.storagePath) {
              if (!options.resolveMediaUrl) throw new Error('Private chat images are unavailable.')
              message.mediaUrl = await options.resolveMediaUrl(roomId, input.storagePath, user.id)
            }
            const current = options.getMembership(socketId)
            if (!current || current.room.id !== roomId || current.user.id !== user.id || !await options.canWriteRoom(user.id, roomId)) throw new Error('This room session has ended.')
            return { roomId, message: { ...message, replyTo: reply || undefined } satisfies RelayMessage }
          })
        } else if (kind === 'reaction') {
          const input = z.object({ ...chatReactionSchema.shape, id: z.string().uuid() }).parse(envelope.reaction)
          await publishOnce(input.id, roomId, user.id, JSON.stringify([input.action, input.messageId, input.emoji]), 'chat:reaction', socketId, async () => {
            writePolicy.reaction(roomId, user.id, input)
            if (!await options.loadReply(roomId, input.messageId)) throw new Error('This room message is unavailable.')
            const current = options.getMembership(socketId)
            if (!current || current.room.id !== roomId || current.user.id !== user.id || !await options.canWriteRoom(user.id, roomId)) throw new Error('This room session has ended.')
            return { roomId, reaction: { ...input, userId: user.id } }
          })
        } else {
          const input = z.object({ active: z.boolean() }).parse(envelope.typing)
          if(options.commands)await options.commands.typing(roomId,user.id)
          else writePolicy.typing(roomId, user.id)
          await options.emitToRoom(roomId, 'chat:typing', { roomId, typing: { userId: user.id, active: input.active, sentAt: now() } }, { socketId, userId: user.id })
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof z.ZodError ? 'Invalid chat event.' : error instanceof Error ? error.message : 'Chat could not be delivered.' }
      }
    },
  }
}
