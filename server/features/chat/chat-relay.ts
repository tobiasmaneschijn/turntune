import { serverT } from "../../lib/i18n.js";
import { z } from 'zod'
import { canonicalMessage, chatMessageSchema, chatReactionSchema, immutableMessageKey, type ChatReply, type RelayMessage } from './chat-validation.js'
import type { User } from '../../types.js'
import type { StoredChatMessage } from './chat-history.js'
import { createChatWritePolicy, type ChatWritePolicy } from './chat-write-policy.js'
import type { ChatCommandOrigin, ChatCommandService } from './chat-command-service.js'
import { PublicRequestError, publicRequestFailure } from '../../lib/public-request-error.js'

type EventKind = 'message' | 'reaction' | 'typing'
type Reply = { ok: boolean; error?: string }
export interface ChatRelayOptions {
  getMembership: (socketId: string) => { room: { id: string }; user: User; admissionToken?: string } | null
  canWriteRoom: (userId: string, roomId: string) => Promise<boolean>
  /** Delivery must include only currently authorized admitted recipients. */
  emitToRoom: (roomId: string, event: `chat:${EventKind}`, payload: unknown, origin: { socketId: string; userId: string; assertActive?: () => void }) => void | Promise<void>
  loadReply: (roomId: string, messageId: string) => Promise<ChatReply | null>
  loadMessageById: (messageId: string) => Promise<StoredChatMessage | null>
  resolveMediaUrl?: (roomId: string, storagePath: string, userId: string) => Promise<string>
  now?: () => number
  writePolicy?: ChatWritePolicy
  commands?: ChatCommandService
  getMentionAudience?: (roomId: string, senderId: string) => Promise<User[]>
}

/** Room admission is checked for every event, including duplicate retries. Never opens a public topic. */
export function createChatRelay(options: ChatRelayOptions) {
  const now = options.now || Date.now
  const writePolicy = options.writePolicy || createChatWritePolicy(now)
  const accepted = new Map<string, { roomId: string; userId: string; key: string; payload: unknown; pending: Promise<void>; expiresAt: number }>()
  const publishOnce = async (id: string, roomId: string, userId: string, key: string, event: `chat:${EventKind}`, origin: ChatCommandOrigin, createPayload: () => Promise<unknown>) => {
    const existing = accepted.get(id)
    if (existing && existing.expiresAt > now()) {
      if (existing.roomId !== roomId || existing.userId !== userId || existing.key !== key) throw new PublicRequestError(serverT("this_message_id_was_already_used_for_different_content"), 409)
      await existing.pending
      origin.assertActive()
      return
    }
    const record = { roomId, userId, key, payload: undefined as unknown, pending: Promise.resolve(), expiresAt: now() + 24 * 60 * 60_000 }
    accepted.set(id, record)
    // Record before the first await, so concurrent uncertain-ACK retries share this operation.
    record.pending = Promise.resolve().then(() => { origin.assertActive(); return createPayload() }).then(async (payload) => { record.payload = payload; origin.assertActive(); if (payload !== null) await options.emitToRoom(roomId, event, payload, { ...origin, userId }) })
      .catch((error: unknown) => { if (accepted.get(id) === record) accepted.delete(id); throw error })
    if (accepted.size > 20_000) accepted.delete(accepted.keys().next().value!)
    await record.pending
  }
  return {
    async handle(socketId: string, kind: EventKind, value: unknown): Promise<Reply> {
      try {
        const envelope = z.object({ roomId: z.string().regex(/^[a-z0-9-]{3,48}$/), message: z.unknown().optional(), reaction: z.unknown().optional(), typing: z.unknown().optional() }).parse(value)
        const membership = options.getMembership(socketId)
        if (!membership || membership.room.id !== envelope.roomId || (!options.commands && !await options.canWriteRoom(membership.user.id, envelope.roomId))) return { ok: false, error: serverT("join_this_room_before_using_its_chat") }
        // An admission query may yield while the socket leaves or changes room.
        const latest = options.getMembership(socketId)
        if (!latest || latest.room.id !== envelope.roomId || latest.user.id !== membership.user.id || latest.admissionToken !== membership.admissionToken) return { ok: false, error: serverT("this_room_session_has_ended") }
        const roomId = envelope.roomId
        const user = latest.user
        const origin: ChatCommandOrigin = { socketId, assertActive: () => {
          const current = options.getMembership(socketId)
          if (!current || current.room.id !== roomId || current.user.id !== user.id || current.admissionToken !== membership.admissionToken)
            throw new PublicRequestError(serverT('this_room_session_has_ended'), 403)
        } }
        origin.assertActive()
        if (options.commands && kind === 'message') {
          await options.commands.message(roomId,user.id,envelope.message,origin)
          origin.assertActive()
          return {ok:true}
        }
        if (options.commands && kind === 'reaction') {
          await options.commands.reaction(roomId,user.id,envelope.reaction,origin)
          origin.assertActive()
          return {ok:true}
        }
        if (kind === 'message') {
          const input = chatMessageSchema.parse(envelope.message)
          const audience = input.mentions.length ? await options.getMentionAudience?.(roomId, user.id) || [] : []
          const message = canonicalMessage(input, user, undefined, audience)
          const key = immutableMessageKey(message)
          await publishOnce(input.id, roomId, user.id, key, 'chat:message', origin, async () => {
            // A fresh process/cache miss must not let an admitted sender rewrite another stored UUID live.
            // Lookup errors propagate: database outage is not proof that the UUID is unused.
            const stored = await options.loadMessageById(input.id)
            if (stored) {
              if (stored.roomId !== roomId || stored.userId !== user.id || immutableMessageKey(stored.message) !== key) throw new PublicRequestError(serverT("this_message_id_already_belongs_to_different_content_account_or_room"), 409)
              writePolicy.message(roomId, user.id, input, true)
              const current = options.getMembership(socketId)
              if (!current || current.room.id !== roomId || current.user.id !== user.id || !await options.canWriteRoom(user.id, roomId)) throw new PublicRequestError(serverT("this_room_session_has_ended"), 403)
              return null // The durable original proves acceptance; uncertain ACK retry must not rebroadcast it.
            }
            writePolicy.message(roomId, user.id, input)
            const reply = input.replyTo ? await options.loadReply(roomId, input.replyTo.id) : undefined
            if (input.replyTo && !reply) throw new PublicRequestError(serverT("the_message_you_replied_to_is_unavailable"), 400)
            if (input.storagePath) {
              if (!options.resolveMediaUrl) throw new PublicRequestError(serverT("private_chat_images_are_unavailable"), 503)
              message.mediaUrl = await options.resolveMediaUrl(roomId, input.storagePath, user.id)
            }
            const current = options.getMembership(socketId)
            if (!current || current.room.id !== roomId || current.user.id !== user.id || !await options.canWriteRoom(user.id, roomId)) throw new PublicRequestError(serverT("this_room_session_has_ended"), 403)
            return { roomId, message: { ...message, replyTo: reply || undefined } satisfies RelayMessage }
          })
        } else if (kind === 'reaction') {
          const input = z.object({ ...chatReactionSchema.shape, id: z.string().uuid() }).parse(envelope.reaction)
          await publishOnce(input.id, roomId, user.id, JSON.stringify([input.action, input.messageId, input.emoji]), 'chat:reaction', origin, async () => {
            writePolicy.reaction(roomId, user.id, input)
            if (!await options.loadReply(roomId, input.messageId)) throw new PublicRequestError(serverT("this_room_message_is_unavailable"), 404)
            const current = options.getMembership(socketId)
            if (!current || current.room.id !== roomId || current.user.id !== user.id || !await options.canWriteRoom(user.id, roomId)) throw new PublicRequestError(serverT("this_room_session_has_ended"), 403)
            return { roomId, reaction: { ...input, userId: user.id } }
          })
        } else {
          const input = z.object({ active: z.boolean() }).parse(envelope.typing)
          if(options.commands)await options.commands.typing(roomId,user.id,origin)
          else writePolicy.typing(roomId, user.id)
          origin.assertActive()
          await options.emitToRoom(roomId, 'chat:typing', { roomId, typing: { userId: user.id, active: input.active, sentAt: now() } }, { ...origin, userId: user.id })
        }
        origin.assertActive()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof z.ZodError ? serverT("invalid_chat_event") : publicRequestFailure(error, serverT("chat_could_not_be_delivered_try_again")).message }
      }
    },
  }
}
