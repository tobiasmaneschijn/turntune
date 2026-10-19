import { serverT } from "./i18n.js";
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { User } from './types.js'
import {
  canonicalMessage,
  CHAT_MAX_REACTIONS_PER_USER, CHAT_MAX_REACTIONS_PER_MESSAGE, CHAT_MAX_POLL_VOTERS,
  CHAT_MAX_HISTORY_MESSAGES, CHAT_MAX_HISTORY_CHILDREN,
  chatMessageSchema,
  chatReactionSchema,
  immutableMessageKey,
  type ChatMessageInput,
  type ChatReply,
  type ChatPollVoteEvent,
  type RelayMessage
} from './chat-validation.js'
import { createChatWritePolicy, type ChatWritePolicy } from './chat-write-policy.js'
import { resolveChatMediaUrl } from './chat-media.js'
import { PublicRequestError, trustedSqlRequestError } from './public-request-error.js'

export type ChatParticipationKind = 'message' | 'media' | 'links' | 'poll' | 'reaction' | 'typing' | 'remove'
export interface ChatCommandAuthorization {
  slowModeSeconds?: number
  bypassSlowMode?: boolean
}
export interface ChatCommandServiceOptions {
  client: SupabaseClient | null
  dataDir?: string
  getUser: (userId: string, roomId: string) => Promise<User | null>
  /** Current authorized room audience; missing resolver fails closed for mentions. */
  getMentionAudience?: (roomId: string, senderId: string) => Promise<User[]>
  /** Must check fresh admission and current room policy. Removal checks staff capability. */
  authorize: (
    userId: string,
    roomId: string,
    kind: ChatParticipationKind,
    targetUserId?: string
  ) => Promise<ChatCommandAuthorization | void>
  emit: (
    roomId: string,
    event: 'chat:message' | 'chat:reaction' | 'chat:poll' | 'chat:removed',
    payload: unknown,
    userId: string
  ) => Promise<void>
  writePolicy?: ChatWritePolicy
  now?: () => number
  withRoomOperation?: <T>(roomId: string, run: () => Promise<T>) => Promise<T>
}
export interface ChatRemovalLog {
  id: string
  action: 'remove-message'
  actorId: string
  targetUserId?: string
  messageId: string
  reason: string
  createdAt: number
  requestId: string
}
export interface DurableChatRecord {
  roomId: string
  userId: string
  message: RelayMessage
  fingerprint: string
  removedAt?: string
}
interface Receipt {
  roomId: string
  userId: string
  fingerprint: string
  result: unknown
  createdAt: number
}
interface LocalChatData {
  messages: Record<string, DurableChatRecord>
  receipts: Record<string, Receipt>
  cooldowns: Record<string, number>
  removals: ChatRemovalLog[]
  tombstones: Record<string, { roomId: string; removedAt: string }>
  mentionBudgets: Record<string, { count: number; expiresAt: number }>
}
export interface ChatReadCursor {
  createdAt: string
  id: string
}
export interface ChatReadRow {
  id: string
  room_slug: string
  user_id: string
  user_name: string
  avatar_seed: string
  content: string
  message_type: 'text' | 'image' | 'gif'
  created_at: string
  media_url: string | null
  storage_path: string | null
  mentions: ChatMessageInput['mentions']
  reply_to_id: string | null
  poll_options: string[] | null
  removed_at: string | null
  immutable_fingerprint?: string | null
  soundspin_message_reactions: Array<{ user_id: string; emoji: string }>
  soundspin_poll_votes: Array<{ user_id: string; option_index: number; revision: number }>
}
const BASE_SELECT = 'id,room_slug,user_id,user_name,avatar_seed,content,message_type,created_at,media_url,storage_path,mentions,reply_to_id,poll_options,removed_at,immutable_fingerprint'
const SELECT = `${BASE_SELECT},soundspin_message_reactions(user_id,emoji),soundspin_poll_votes(user_id,option_index,revision)`
const RECEIPT_TTL_MS = 24 * 60 * 60_000
const MAX_ROOM_RECEIPTS = 10_000
const MAX_USER_RECEIPTS = 1_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tombstone = (message: RelayMessage, removedAt: string): RelayMessage => ({
  id: message.id,
  content: 'Message removed',
  type: 'text',
  createdAt: message.createdAt,
  user: message.user,
  mentions: [],
  replyTo: message.replyTo,
  removedAt
})

/** Both HTTP and socket commands commit the same immutable operation before delivery. */
export class ChatCommandService {
  private data: LocalChatData = { messages: {}, receipts: {}, cooldowns: {}, removals: [], tombstones: {}, mentionBudgets: {} }
  private initialized?: Promise<void>
  private chain: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  private readonly policy: ChatWritePolicy
  constructor(private readonly options: ChatCommandServiceOptions) {
    this.now = options.now || Date.now
    this.policy = options.writePolicy || createChatWritePolicy(this.now)
  }
  private roomOperation<T>(roomId: string, run: () => Promise<T>) {
    return this.options.withRoomOperation ? this.options.withRoomOperation(roomId, run) : run()
  }
  message(roomId: string, userId: string, value: unknown) {
    return this.roomOperation(roomId, () => this.saveMessage(roomId, userId, value))
  }
  reaction(roomId: string, userId: string, value: unknown) {
    return this.roomOperation(roomId, () => this.saveReaction(roomId, userId, value))
  }
  pollVote(roomId: string, userId: string, messageId: string, optionIndex: number, operationId = randomUUID()) {
    return this.roomOperation(roomId, () => this.savePollVote(roomId, userId, messageId, optionIndex, operationId))
  }
  removeMessage(roomId: string, actorId: string, messageId: string, operationId: string, reason = '') {
    return this.roomOperation(roomId, () => this.removeStoredMessage(roomId, actorId, messageId, operationId, reason))
  }
  async checkParticipation(roomId: string, userId: string, kind: ChatParticipationKind) {
    return this.options.authorize(userId, roomId, kind)
  }
  async typing(roomId: string, userId: string) {
    await this.options.authorize(userId, roomId, 'typing')
    this.policy.typing(roomId, userId)
  }
  private async init() {
    if (this.options.client) return
    this.initialized ||= (async () => {
      try {
        this.data = { ...this.data, ...(JSON.parse(await readFile(this.file, 'utf8')) as LocalChatData) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })()
    await this.initialized
  }
  private get file() {
    return path.join(
      this.options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data'),
      'soundspin-chat.json'
    )
  }
  private async local<T>(change: (draft: LocalChatData) => T | Promise<T>): Promise<T> {
    const result = this.chain
      .catch(() => {})
      .then(async () => {
        await this.init()
        const draft = structuredClone(this.data)
        for (const [id, receipt] of Object.entries(draft.receipts))
          if (!Number.isFinite(receipt.createdAt) || receipt.createdAt + RECEIPT_TTL_MS <= this.now()) delete draft.receipts[id]
        const value = await change(draft)
        if (JSON.stringify(draft) === JSON.stringify(this.data)) return value
        await mkdir(path.dirname(this.file), { recursive: true })
        const temp = `${this.file}.tmp`
        await writeFile(temp, JSON.stringify(draft), 'utf8')
        await rename(temp, this.file)
        this.data = draft
        return value
      })
    this.chain = result
    return result
  }
  private checkReceipt(data: LocalChatData, id: string, roomId: string, userId: string, fingerprint: string) {
    const receipt = data.receipts[id]
    if (receipt && (receipt.roomId !== roomId || receipt.userId !== userId || receipt.fingerprint !== fingerprint))
      throw new PublicRequestError(serverT("this_operation_id_belongs_to_different_content_account_or_room"), 409)
    return receipt
  }
  private commitReceipt(data: LocalChatData, id: string, receipt: Omit<Receipt, 'createdAt'>) {
    const entries = Object.values(data.receipts)
    const removal = id.startsWith('remove:')
    if (entries.filter(item => item.roomId === receipt.roomId).length >= MAX_ROOM_RECEIPTS + (removal ? 1000 : 0) ||
        entries.filter(item => item.userId === receipt.userId).length >= MAX_USER_RECEIPTS + (removal ? 1000 : 0))
      throw new PublicRequestError(serverT("chat_operation_limit_reached_try_again_later"), 429)
    data.receipts[id] = { ...receipt, createdAt: this.now() }
  }
  private boundRow(row: ChatReadRow): ChatReadRow {
    return { ...row, soundspin_message_reactions: (row.soundspin_message_reactions || []).slice(0, CHAT_MAX_REACTIONS_PER_MESSAGE),
      soundspin_poll_votes: (row.soundspin_poll_votes || []).slice(0, CHAT_MAX_POLL_VOTERS) }
  }
  private reserveMentions(data: LocalChatData, userId: string, targets: ChatMessageInput['mentions']) {
    if (!targets.length) return
    const keys = [[`sender:${userId}`, targets.length, 20] as const,
      ...targets.map(target => [`recipient:${target.userId}`, 1, 5] as const)]
    for (const [key, cost, max] of keys) {
      const entry = data.mentionBudgets[key]
      if (entry && entry.expiresAt > this.now() && entry.count + cost > max) throw new PublicRequestError(serverT("mention_limit_reached_send_a_message_without_mentions"), 429)
    }
    for (const [key, cost] of keys) {
      const current = data.mentionBudgets[key]
      data.mentionBudgets[key] = { count: (current && current.expiresAt > this.now() ? current.count : 0) + cost, expiresAt: current && current.expiresAt > this.now() ? current.expiresAt : this.now() + 60_000 }
    }
    for (const [key, entry] of Object.entries(data.mentionBudgets)) if (entry.expiresAt <= this.now()) delete data.mentionBudgets[key]
    if (Object.keys(data.mentionBudgets).length > 20_000) throw new PublicRequestError(serverT("mentions_are_temporarily_unavailable"), 503)
  }
  private async rpc(
    kind: string,
    roomId: string,
    userId: string,
    id: string,
    fingerprint: string,
    payload: unknown,
    authorization: ChatCommandAuthorization | void
  ) {
    const { data, error } = await this.options.client!.rpc('soundspin_chat_command', {
      p_kind: kind,
      p_room: roomId,
      p_user: userId,
      p_id: id,
      p_fingerprint: fingerprint,
      p_payload: payload,
      p_slow_seconds: authorization?.bypassSlowMode ? 0 : authorization?.slowModeSeconds || 0
    })
    if (error) throw trustedSqlRequestError(error, {
      'Invalid chat command.': 400,
      'This operation ID belongs to different content, account, or room.': 409,
      'This message ID belongs to different content, account, or room.': 409,
      'This message ID is unavailable.': 409,
      'Slow mode is active. Wait before sending another message.': 429,
      'This uploaded image is unavailable.': 400,
      'This message is unavailable.': 404,
      'This message was removed.': 409,
      'Choose a supported emoji.': 400,
      'This message has reached its reaction limit.': 429,
      'This poll is unavailable.': 400,
      'This poll has reached its voter limit.': 429,
      'Mention limit reached. Send a message without mentions.': 429,
      'Chat operation limit reached. Try again later.': 429
    }, 'Chat could not be saved. Try again.')
    return data as { fresh: boolean; result: unknown }
  }
  private async saveMessage(roomId: string, userId: string, value: unknown): Promise<RelayMessage> {
    const input = chatMessageSchema.parse(value)
    const fingerprint = hash(immutableMessageKey(input))
    const id = `message:${input.id}`
    let authorization = await this.options.authorize(userId, roomId, 'message')
    if (input.type !== 'text') await this.options.authorize(userId, roomId, 'media')
    if (/https?:\/\/|www\./i.test(input.content)) await this.options.authorize(userId, roomId, 'links')
    if (input.poll) await this.options.authorize(userId, roomId, 'poll')
    const user = await this.options.getUser(userId, roomId)
    if (!user || user.id !== userId) throw new PublicRequestError(serverT("this_room_session_has_ended"), 403)
    const reply = input.replyTo ? await this.loadReply(roomId, input.replyTo.id) : undefined
    if (input.replyTo && !reply) throw new PublicRequestError(serverT("the_replied_to_message_is_unavailable"), 400)
    const audience = input.mentions.length ? await this.options.getMentionAudience?.(roomId, userId) || [] : []
    let message = canonicalMessage(input, user, reply || undefined, audience)
    const existing = await this.loadMessage(input.id)
    const removed = existing?.removedAt || (await this.loadTombstone(input.id))?.removedAt
    if (existing && (existing.roomId !== roomId || existing.userId !== userId || existing.fingerprint !== fingerprint))
      throw new PublicRequestError(serverT("this_message_id_belongs_to_different_content_account_or_room"), 409)
    this.policy.message(roomId, userId, input, Boolean(existing))
    if (message.storagePath && !removed)
      message.mediaUrl = (
        await resolveChatMediaUrl(this.options.client, roomId, message.storagePath, userId, true, true)
      ).url
    authorization = await this.options.authorize(userId, roomId, 'message')
    let fresh: boolean
    if (this.options.client)
      fresh = (await this.rpc('message', roomId, userId, id, fingerprint, message, authorization)).fresh
    else
      fresh = await this.local(async (draft) => {
        await this.options.authorize(userId, roomId, 'message')
        if (this.checkReceipt(draft, id, roomId, userId, fingerprint)) return false
        const original = draft.messages[input.id]
        if (
          original &&
          (original.roomId !== roomId || original.userId !== userId || original.fingerprint !== fingerprint)
        )
          throw new PublicRequestError(serverT("this_message_id_belongs_to_different_content_account_or_room"), 409)
        if (original) return false
        const removal = draft.tombstones[input.id]
        if (removal && removal.roomId !== roomId) throw new PublicRequestError(serverT("this_message_id_is_unavailable"), 409)
        if (!removal) this.reserveMentions(draft, userId, message.mentions)
        const cooldownKey = `${roomId}:${userId}`
        const cooldown = authorization?.bypassSlowMode ? 0 : authorization?.slowModeSeconds || 0
        if (!removal && cooldown && (draft.cooldowns[cooldownKey] || 0) + cooldown * 1000 > this.now())
          throw new PublicRequestError(serverT("slow_mode_is_active_wait_before_sending_another_message"), 429)
        draft.messages[input.id] = {
          roomId,
          userId,
          message: removal ? tombstone(message, removal.removedAt) : message,
          fingerprint,
          removedAt: removal?.removedAt
        }
        if (!removal) draft.cooldowns[cooldownKey] = this.now()
        this.commitReceipt(draft, id, { roomId, userId, fingerprint, result: { id: input.id } })
        return !removal
      })
    const record = await this.loadMessage(input.id)
    if (!record) throw new PublicRequestError(serverT("the_saved_message_is_unavailable"), 503)
    message = record.message
    if (record.removedAt)
      await this.options.emit(
        roomId,
        'chat:removed',
        { roomId, messageId: message.id, removedAt: record.removedAt },
        userId
      )
    if (fresh) await this.options.emit(roomId, 'chat:message', { roomId, message }, userId)
    return message
  }
  private async saveReaction(roomId: string, userId: string, value: unknown) {
    const input = chatReactionSchema.parse(value)
    const operationId = input.id || randomUUID()
    const id = `reaction:${operationId}`
    const fingerprint = hash(JSON.stringify([input.messageId, input.action, input.emoji]))
    const authorization = await this.options.authorize(userId, roomId, 'reaction')
    this.policy.reaction(roomId, userId, { ...input, id: operationId })
    const target = await this.loadMessage(input.messageId)
    if (!target || target.roomId !== roomId || target.removedAt) throw new PublicRequestError(serverT("this_message_is_unavailable"), 404)
    const event = { ...input, id: operationId, userId }
    let fresh: boolean
    if (this.options.client) {
      await this.options.authorize(userId, roomId, 'reaction')
      fresh = (await this.rpc('reaction', roomId, userId, id, fingerprint, event, authorization)).fresh
    } else
      fresh = await this.local(async (draft) => {
        await this.options.authorize(userId, roomId, 'reaction')
        if (this.checkReceipt(draft, id, roomId, userId, fingerprint)) return false
        const record = draft.messages[input.messageId]
        if (!record || record.removedAt || record.roomId !== roomId) throw new PublicRequestError(serverT("this_message_is_unavailable"), 404)
        const reactions = ((
          record.message as RelayMessage & { reactions?: Array<{ userId: string; emoji: string }> }
        ).reactions ||= [])
        const index = reactions.findIndex((r) => r.userId === userId && r.emoji === input.emoji)
        if (input.action === 'add' && index < 0) {
          if (reactions.filter(item => item.userId === userId).length >= CHAT_MAX_REACTIONS_PER_USER || reactions.length >= CHAT_MAX_REACTIONS_PER_MESSAGE)
            throw new PublicRequestError(serverT("this_message_has_reached_its_reaction_limit"), 429)
          reactions.push({ userId, emoji: input.emoji })
        } else if (input.action === 'remove' && index >= 0) reactions.splice(index, 1)
        else {
          this.commitReceipt(draft, id, { roomId, userId, fingerprint, result: event })
          return false
        }
        this.commitReceipt(draft, id, { roomId, userId, fingerprint, result: event })
        return true
      })
    if (fresh) await this.options.emit(roomId, 'chat:reaction', { roomId, reaction: event }, userId)
    return event
  }
  private async savePollVote(
    roomId: string,
    userId: string,
    messageId: string,
    optionIndex: number,
    operationId: string
  ): Promise<ChatPollVoteEvent> {
    if (
      !uuid.test(messageId) ||
      !uuid.test(operationId) ||
      !Number.isInteger(optionIndex) ||
      optionIndex < 0 ||
      optionIndex > 3
    )
      throw new PublicRequestError(serverT("choose_a_poll_option"), 400)
    const authorization = await this.options.authorize(userId, roomId, 'reaction')
    this.policy.pollVote(roomId, userId)
    const id = `poll:${operationId}`,
      fingerprint = hash(JSON.stringify([messageId, optionIndex]))
    let result: { fresh: boolean; result: unknown }
    if (this.options.client) {
      await this.options.authorize(userId, roomId, 'reaction')
      result = await this.rpc('poll', roomId, userId, id, fingerprint, { messageId, optionIndex }, authorization)
    } else
      result = await this.local(async (draft) => {
        await this.options.authorize(userId, roomId, 'reaction')
        const receipt = this.checkReceipt(draft, id, roomId, userId, fingerprint)
        if (receipt) return { fresh: false, result: receipt.result }
        const target = draft.messages[messageId]
        if (
          !target ||
          target.roomId !== roomId ||
          target.removedAt ||
          !target.message.poll ||
          optionIndex >= target.message.poll.options.length
        )
          throw new PublicRequestError(serverT("this_poll_is_unavailable"), 400)
        const previous = target.message.poll.votes.find((v) => v.userId === userId)
        if (previous?.optionIndex === optionIndex) {
          const event = { messageId, ...previous }
          this.commitReceipt(draft, id, { roomId, userId, fingerprint, result: event })
          return { fresh: false, result: event }
        }
        if (!previous && target.message.poll.votes.length >= CHAT_MAX_POLL_VOTERS) throw new PublicRequestError(serverT("this_poll_has_reached_its_voter_limit"), 429)
        const event = { messageId, userId, optionIndex, revision: (previous?.revision || 0) + 1 }
        target.message.poll.votes = target.message.poll.votes.filter((v) => v.userId !== userId)
        target.message.poll.votes.push(event)
        this.commitReceipt(draft, id, { roomId, userId, fingerprint, result: event })
        return { fresh: true, result: event }
      })
    const event = result.result as ChatPollVoteEvent
    if (result.fresh) await this.options.emit(roomId, 'chat:poll', { roomId, poll: event }, userId)
    return event
  }
  private async removeStoredMessage(
    roomId: string,
    actorId: string,
    messageId: string,
    operationId: string,
    reason = ''
  ) {
    if (!uuid.test(messageId) || !uuid.test(operationId) || reason.length > 500)
      throw new PublicRequestError(serverT("invalid_message_removal"), 400)
    const target = await this.loadMessage(messageId)
    if (target && target.roomId !== roomId) throw new PublicRequestError(serverT("this_message_is_unavailable"), 404)
    const authorization = await this.options.authorize(actorId, roomId, 'remove', target?.userId)
    const id = `remove:${operationId}`,
      fingerprint = hash(JSON.stringify([messageId, reason]))
    const removedAt = new Date(this.now()).toISOString()
    let fresh: boolean
    if (this.options.client) {
      await this.options.authorize(actorId, roomId, 'remove', target?.userId)
      fresh = (
        await this.rpc('remove', roomId, actorId, id, fingerprint, { messageId, reason, removedAt }, authorization)
      ).fresh
    } else
      fresh = await this.local(async (draft) => {
        const current = draft.messages[messageId]
        if (current && current.roomId !== roomId) throw new PublicRequestError(serverT("this_message_is_unavailable"), 404)
        await this.options.authorize(actorId, roomId, 'remove', current?.userId)
        if (this.checkReceipt(draft, id, roomId, actorId, fingerprint)) return false
        if (draft.tombstones[messageId] && draft.tombstones[messageId].roomId !== roomId)
          throw new PublicRequestError(serverT("this_message_id_is_unavailable"), 409)
        if (draft.tombstones[messageId]) return false
        draft.tombstones[messageId] ||= { roomId, removedAt }
        const record = draft.messages[messageId]
        if (record) {
          record.removedAt ||= removedAt
          record.message = tombstone(record.message, record.removedAt)
        }
        draft.removals.push({
          id: randomUUID(),
          action: 'remove-message',
          actorId,
          targetUserId: record?.userId,
          messageId,
          reason,
          createdAt: this.now(),
          requestId: operationId
        })
        this.commitReceipt(draft, id, {
          roomId,
          userId: actorId,
          fingerprint,
          result: { messageId, removedAt: draft.tombstones[messageId].removedAt }
        })
        return true
      })
    const marker = await this.loadTombstone(messageId)
    if (fresh)
      await this.options.emit(
        roomId,
        'chat:removed',
        { roomId, messageId, removedAt: marker?.removedAt || removedAt },
        actorId
      )
    return { ok: true, messageId, removedAt: marker?.removedAt || removedAt }
  }
  async listRemovalLog(roomId: string): Promise<ChatRemovalLog[]> {
    if (!this.options.client) {
      await this.init()
      return structuredClone(this.data.removals.filter((row) => this.data.tombstones[row.messageId]?.roomId === roomId))
    }
    const { data, error } = await this.options.client
      .from('soundspin_chat_removals')
      .select('*')
      .eq('room_slug', roomId)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) throw error
    return (data || []).map((row) => ({
      id: row.id,
      action: 'remove-message',
      actorId: row.actor_id,
      targetUserId: row.target_user_id || undefined,
      messageId: row.message_id,
      reason: row.reason,
      createdAt: Date.parse(row.created_at),
      requestId: row.operation_id
    }))
  }
  async loadMessage(id: string): Promise<DurableChatRecord | null> {
    if (!uuid.test(id)) return null
    if (!this.options.client) {
      await this.init()
      const record = this.data.messages[id] ? structuredClone(this.data.messages[id]) : null
      if (record) {
        const message = record.message as RelayMessage & { reactions?: Array<{ userId: string; emoji: string }> }
        if (message.reactions) message.reactions = message.reactions.slice(0, CHAT_MAX_REACTIONS_PER_MESSAGE)
        if (message.poll) message.poll.votes = message.poll.votes.slice(0, CHAT_MAX_POLL_VOTERS)
      }
      if (record?.message.replyTo) {
        const source = this.data.messages[record.message.replyTo.id]
        if (source?.roomId === record.roomId) {
          const message = source.message
          record.message.replyTo = {
            id: message.id,
            content: message.content,
            type: message.type,
            mediaUrl: message.mediaUrl,
            mentions: message.mentions,
            user: { id: message.user.id, name: message.user.name },
            removedAt: source.removedAt
          }
        } else record.message.replyTo = undefined
      }
      return record
    }
    const { data, error } = await this.options.client
      .from('soundspin_messages')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const row = data as ChatReadRow
    const { data: receipt, error: receiptError } = await this.options.client
      .from('soundspin_chat_receipts')
      .select('fingerprint')
      .eq('operation_id', `message:${id}`)
      .maybeSingle()
    if (receiptError) throw receiptError
    const message = this.fromRow(row)
    if (row.reply_to_id) {
      const { data: reply, error: replyError } = await this.options.client
        .from('soundspin_messages')
        .select(BASE_SELECT)
        .eq('room_slug', row.room_slug)
        .eq('id', row.reply_to_id)
        .maybeSingle()
      if (replyError) throw replyError
      if (reply) {
        const source = this.fromRow(reply as ChatReadRow)
        message.replyTo = {
          id: source.id,
          content: source.content,
          type: source.type,
          mediaUrl: source.mediaUrl,
          mentions: source.mentions,
          user: { id: source.user.id, name: source.user.name },
          removedAt: source.removedAt
        }
      } else message.replyTo = undefined
    }
    return {
      roomId: row.room_slug,
      userId: row.user_id,
      message,
      fingerprint: row.immutable_fingerprint || receipt?.fingerprint || hash(immutableMessageKey(message)),
      removedAt: row.removed_at || undefined
    }
  }
  private async loadTombstone(id: string): Promise<{ roomId: string; removedAt: string } | null> {
    if (!this.options.client) {
      await this.init()
      return this.data.tombstones[id] || null
    }
    const { data, error } = await this.options.client
      .from('soundspin_chat_tombstones')
      .select('room_slug,removed_at')
      .eq('message_id', id)
      .maybeSingle()
    if (error) throw error
    return data ? { roomId: data.room_slug, removedAt: data.removed_at } : null
  }
  private fromRow(row: ChatReadRow): RelayMessage {
    return {
      id: row.id,
      content: row.content,
      type: row.message_type,
      createdAt: row.created_at,
      user: { id: row.user_id, name: row.user_name, avatarSeed: row.avatar_seed },
      mediaUrl: row.media_url || undefined,
      storagePath: row.storage_path || undefined,
      mentions: row.mentions || [],
      replyTo: row.reply_to_id
        ? { id: row.reply_to_id, content: 'Message', type: 'text', user: { id: row.user_id, name: row.user_name } }
        : undefined,
      poll: row.poll_options
        ? {
            options: row.poll_options,
            votes: (row.soundspin_poll_votes || []).slice(0, CHAT_MAX_POLL_VOTERS).map((v) => ({
              userId: v.user_id,
              optionIndex: v.option_index,
              revision: v.revision
            }))
          }
        : undefined,
      removedAt: row.removed_at || undefined,
      ...{ reactions: (row.soundspin_message_reactions || []).slice(0, CHAT_MAX_REACTIONS_PER_MESSAGE).map((r) => ({ userId: r.user_id, emoji: r.emoji })) }
    }
  }
  async loadReply(roomId: string, id: string): Promise<ChatReply | null> {
    const target = await this.loadMessage(id)
    if (!target || target.roomId !== roomId) return null
    const m = target.message
    return {
      id: m.id,
      content: m.content,
      type: m.type,
      mediaUrl: m.mediaUrl,
      mentions: m.mentions,
      user: { id: m.user.id, name: m.user.name },
      removedAt: target.removedAt
    }
  }
  private toRow(record: DurableChatRecord): ChatReadRow {
    const m = record.message
    return {
      id: m.id,
      room_slug: record.roomId,
      user_id: record.userId,
      user_name: m.user.name,
      avatar_seed: m.user.avatarSeed,
      content: m.content,
      message_type: m.type,
      created_at: m.createdAt,
      media_url: m.mediaUrl || null,
      storage_path: m.storagePath || null,
      mentions: m.mentions,
      reply_to_id: m.replyTo?.id || null,
      poll_options: m.poll?.options || null,
      removed_at: record.removedAt || null,
      immutable_fingerprint: record.fingerprint,
      soundspin_message_reactions: (
        (m as RelayMessage & { reactions?: Array<{ userId: string; emoji: string }> }).reactions || []
      ).map((r) => ({ user_id: r.userId, emoji: r.emoji })),
      soundspin_poll_votes: (m.poll?.votes || []).map((v) => ({
        user_id: v.userId,
        option_index: v.optionIndex,
        revision: v.revision
      }))
    }
  }
  async readPage(
    roomId: string,
    cursor?: ChatReadCursor,
    direction: 'older' | 'newer' = 'older',
    limit = 200,
    search?: string
  ) {
    limit = Math.min(CHAT_MAX_HISTORY_MESSAGES, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : CHAT_MAX_HISTORY_MESSAGES))
    let rows: ChatReadRow[]
    if (this.options.client) {
      let query = this.options.client.from('soundspin_messages').select(SELECT).eq('room_slug', roomId)
      if (cursor) {
        const op = direction === 'older' ? 'lt' : 'gt'
        query = query.or(
          `created_at.${op}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${op}.${cursor.id})`
        )
      }
      if (search)
        query = query.is('removed_at', null).ilike('content', `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      const result = await query
        .order('created_at', { ascending: direction === 'newer' })
        .order('id', { ascending: direction === 'newer' })
        .limit(limit + 1)
      if (result.error) throw result.error
      rows = (result.data || []) as ChatReadRow[]
    } else {
      await this.init()
      rows = Object.values(this.data.messages)
        .filter((r) => r.roomId === roomId)
        .map((r) => this.toRow(r))
      if (search) rows = rows.filter((r) => !r.removed_at && r.content.toLowerCase().includes(search.toLowerCase()))
      rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
      if (cursor)
        rows = rows.filter((r) =>
          direction === 'older'
            ? r.created_at < cursor.createdAt || (r.created_at === cursor.createdAt && r.id < cursor.id)
            : r.created_at > cursor.createdAt || (r.created_at === cursor.createdAt && r.id > cursor.id)
        )
      if (direction === 'older') rows.reverse()
    }
    let hasMore = rows.length > limit
    rows = rows.slice(0, limit).map(row => this.boundRow(row))
    let children = 0, count = 0
    for (const row of rows) {
      const next = row.soundspin_message_reactions.length + row.soundspin_poll_votes.length
      if (count && children + next > CHAT_MAX_HISTORY_CHILDREN) break
      children += next; count++
    }
    if (count < rows.length) { hasMore = true; rows = rows.slice(0, count) }
    const last = rows.at(-1)
    if (direction === 'older') rows.reverse()
    return { rows, cursor: last ? { createdAt: last.created_at, id: last.id } : undefined, hasMore }
  }
  async readPayload(roomId: string, rows: ChatReadRow[]) {
    if (rows.length > CHAT_MAX_HISTORY_MESSAGES) throw new PublicRequestError(serverT("chat_history_page_is_too_large"), 400)
    rows = rows.map(row => this.boundRow(row))
    // A context page combines two bounded 6,000-child pages and one 600-child target.
    if (rows.reduce((count, row) => count + row.soundspin_message_reactions.length + row.soundspin_poll_votes.length, 0) > CHAT_MAX_HISTORY_CHILDREN * 2 + CHAT_MAX_REACTIONS_PER_MESSAGE + CHAT_MAX_POLL_VOTERS)
      throw new PublicRequestError(serverT("chat_history_children_exceed_the_page_limit"), 400)
    const replies: ChatReadRow[] = [],
      replyIds = [...new Set(rows.flatMap((row) => (row.reply_to_id ? [row.reply_to_id] : [])))]
    if (this.options.client) {
      for (let i = 0; i < replyIds.length; i += 100) {
        const { data, error } = await this.options.client
          .from('soundspin_messages')
          .select(BASE_SELECT)
          .eq('room_slug', roomId)
          .in('id', replyIds.slice(i, i + 100))
        if (!error) replies.push(...((data || []) as ChatReadRow[]))
      }
    } else {
      for (const id of replyIds) {
        const record = await this.loadMessage(id)
        if (record?.roomId === roomId) replies.push({ ...this.toRow(record), soundspin_message_reactions: [], soundspin_poll_votes: [] })
      }
    }
    const sign = async (items: ChatReadRow[]) => {
      const result = [...items]
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        while (next < items.length) {
          const index = next++, row = items[index]
          if (!row.storage_path || row.removed_at) continue
          try {
            result[index] = {
              ...row,
              media_url: (await resolveChatMediaUrl(this.options.client, roomId, row.storage_path, undefined, true)).url
            }
          } catch {
            result[index] = { ...row, media_url: null }
          }
        }
      }))
      return result
    }
    const [signedRows, signedReplies] = await Promise.all([sign(rows), sign(replies)])
    const profiles: unknown[] = [],
      markers = new Map<string, string>(),
      ids = [...new Set([...rows, ...replies].map((row) => row.id))]
    if (this.options.client) {
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await this.options.client
          .from('soundspin_chat_tombstones')
          .select('message_id,removed_at')
          .eq('room_slug', roomId)
          .in('message_id', ids.slice(i, i + 100))
        if (error) throw error
        for (const marker of data || []) markers.set(marker.message_id, marker.removed_at)
      }
      const userIds = [...new Set([...rows, ...replies].map((row) => row.user_id))]
      for (let i = 0; i < userIds.length; i += 100) {
        const { data, error } = await this.options.client
          .from('soundspin_profiles')
          .select('user_id,display_name,is_app_admin,avatar_key,avatar_url')
          .in('user_id', userIds.slice(i, i + 100))
        if (!error) profiles.push(...(data || []))
      }
    } else
      for (const id of ids) {
        const marker = this.data.tombstones[id]
        if (marker?.roomId === roomId) markers.set(id, marker.removedAt)
      }
    const redact = (items: ChatReadRow[]) =>
      items.map(({ immutable_fingerprint: _internalFingerprint, ...row }) => {
        const removedAt = row.removed_at || markers.get(row.id)
        return removedAt
          ? {
              ...row,
              removed_at: removedAt,
              content: serverT("message_removed"),
              message_type: 'text' as const,
              media_url: null,
              storage_path: null,
              mentions: [],
              poll_options: null,
              soundspin_message_reactions: [],
              soundspin_poll_votes: []
            }
          : row
      })
    return { rows: redact(signedRows), replies: redact(signedReplies), profiles }
  }
  async readMessage(roomId: string, id: string) {
    const record = await this.loadMessage(id)
    return record?.roomId === roomId ? this.readPayload(roomId, [this.toRow(record)]) : null
  }
}
