import i18n from '../../i18n'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  applyChatUserProfiles,
  type ChatMessage,
  type ChatMessageType,
  type ChatPoll,
  type ChatUserProfile,
} from '@/features/chat/model'
import type { User } from '@/types'
import { normalizeChatMentions } from '@/features/chat/mentions'
import { normalizeChatPollOptions, normalizeRealtimePollVote, safeChatMediaUrl } from '@/features/chat/protocol'
import { normalizeChatGame, normalizeChatSong } from '../../../shared/chat-attachments'

export const CHAT_HISTORY_LIMIT = 200
export const CHAT_SEARCH_LIMIT = 40

export interface ChatHistoryCursor { createdAt: string; id: string }
export interface ChatHistoryPage { messages: ChatMessage[]; cursor?: ChatHistoryCursor; hasMore: boolean }
export const chatHistoryCursor = (message: Pick<ChatMessage, 'createdAt' | 'id'>): ChatHistoryCursor => ({ createdAt: message.createdAt, id: message.id })

/** Cursor values are inserted into PostgREST's raw OR grammar; never interpolate arbitrary input. */
export function chatHistoryCursorFilter(cursor: ChatHistoryCursor, direction: 'older' | 'newer' = 'older') {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt) ||
    !Number.isFinite(Date.parse(cursor.createdAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) {
    throw new Error(i18n.t('chat:historyCursorInvalid'))
  }
  const operator = direction === 'older' ? 'lt' : 'gt'
  return `created_at.${operator}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${operator}.${cursor.id})`
}

export function chatSearchPattern(query: string) {
  const term = query.trim().slice(0, 100)
  if (term.length < 2) throw new Error(i18n.t('chat:searchTooShort'))
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

// Keep this flat: PostgREST may not expose the composite self-reference used
// by reply_to_id as an embeddable relationship. Replies are joined in memory.
const CHAT_HISTORY_SELECT = [
  'id',
  'content',
  'message_type',
  'media_url',
  'storage_path',
  'mentions',
  'user_id',
  'user_name',
  'avatar_seed',
  'created_at',
  'reply_to_id',
  'poll_options',
  'removed_at',
  'song',
  'game',
  'soundspin_message_reactions(emoji, user_id)',
  'soundspin_poll_votes(user_id, option_index, revision)',
].join(', ')

export interface ChatHistoryRow {
  id: string
  content: string
  message_type: ChatMessageType
  media_url: string | null
  storage_path: string | null
  mentions: unknown
  user_id: string
  user_name: string
  avatar_seed: string
  created_at: string
  removed_at?:string|null
  song?: unknown
  game?: unknown
  reply_to_id: string | null
  soundspin_message_reactions: Array<{ emoji: string; user_id: string }> | null
  poll_options?: string[] | null
  soundspin_poll_votes?: Array<{ user_id: string; option_index: number; revision: number }> | null
}

export async function loadChatHistory(
  client: SupabaseClient,
  roomSlug: string
): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from('soundspin_messages')
    .select(CHAT_HISTORY_SELECT)
    .eq('room_slug', roomSlug)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CHAT_HISTORY_LIMIT)

  if (error) throw error

  return hydrateChatHistoryRows(client, roomSlug, ([...(data || [])] as unknown as ChatHistoryRow[]).reverse())
}

/** Keyset pagination remains stable when new messages arrive or timestamps are equal. */
export async function loadChatHistoryPage(client: SupabaseClient, roomSlug: string, cursor?: ChatHistoryCursor, options: {
  direction?: 'older' | 'newer'; pageSize?: number; search?: string; signal?: AbortSignal
} = {}): Promise<ChatHistoryPage> {
  const direction = options.direction || 'older'
  const limit = Math.max(1, Math.min(CHAT_HISTORY_LIMIT, options.pageSize || CHAT_HISTORY_LIMIT))
  let query = client.from('soundspin_messages').select(CHAT_HISTORY_SELECT).eq('room_slug', roomSlug)
  if (cursor) query = query.or(chatHistoryCursorFilter(cursor, direction))
  if (options.search !== undefined) query = query.ilike('content', chatSearchPattern(options.search))
  query = query.order('created_at', { ascending: direction === 'newer' }).order('id', { ascending: direction === 'newer' }).limit(limit + 1)
  if (options.signal) query = query.abortSignal(options.signal)
  const { data, error } = await query
  if (error) throw error
  const rows = (data || []) as unknown as ChatHistoryRow[]
  const selected = rows.slice(0, limit)
  const next = selected.at(-1)
  const chronological = direction === 'older' ? selected.reverse() : selected
  return { messages: await hydrateChatHistoryRows(client, roomSlug, chronological), hasMore: rows.length > limit,
    cursor: next ? { createdAt: next.created_at, id: next.id } : undefined }
}

export function searchChatHistory(client: SupabaseClient, roomSlug: string, search: string, cursor?: ChatHistoryCursor, signal?: AbortSignal) {
  return loadChatHistoryPage(client, roomSlug, cursor, { search, pageSize: CHAT_SEARCH_LIMIT, signal })
}

/** Reveal an authorized target with contiguous neighbors, without loading an entire room. */
export async function loadChatMessageContext(client: SupabaseClient, roomSlug: string, messageId: string, signal?: AbortSignal) {
  let query = client.from('soundspin_messages').select(CHAT_HISTORY_SELECT).eq('room_slug', roomSlug).eq('id', messageId)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as ChatHistoryRow
  const cursor = { createdAt: row.created_at, id: row.id }
  const [older, newer, target] = await Promise.all([
    loadChatHistoryPage(client, roomSlug, cursor, { pageSize: 20, signal }),
    loadChatHistoryPage(client, roomSlug, cursor, { direction: 'newer', pageSize: 20, signal }),
    hydrateChatHistoryRows(client, roomSlug, [row]),
  ])
  return { messages: [...older.messages, ...target, ...newer.messages], olderCursor: older.cursor || cursor,
    newerCursor: newer.cursor || cursor, hasOlder: older.hasMore, hasNewer: newer.hasMore }
}

export async function loadChatMessage(client: SupabaseClient, roomSlug: string, messageId: string): Promise<ChatMessage | null> {
  const { data, error } = await client.from('soundspin_messages').select(CHAT_HISTORY_SELECT).eq('room_slug', roomSlug).eq('id', messageId).maybeSingle()
  if (error) throw error
  return data ? (await hydrateChatHistoryRows(client, roomSlug, [data as unknown as ChatHistoryRow]))[0] : null
}

async function hydrateChatHistoryRows(client: SupabaseClient, roomSlug: string, history: ChatHistoryRow[]): Promise<ChatMessage[]> {
  const rowsById = new Map(history.map((row) => [row.id, row]))
  const missingReplyIds = [...new Set(history.flatMap((row) =>
    row.reply_to_id && !rowsById.has(row.reply_to_id) ? [row.reply_to_id] : []
  ))]
  if (missingReplyIds.length > 0) {
    const { data: replies, error: replyError } = await client
      .from('soundspin_messages')
      .select(CHAT_HISTORY_SELECT)
      .eq('room_slug', roomSlug)
      .in('id', missingReplyIds)
    // A missing/deleted preview must not hide otherwise readable history.
    if (!replyError) {
      for (const reply of (replies || []) as unknown as ChatHistoryRow[]) rowsById.set(reply.id, reply)
    }
  }
  const userIds = [...new Set([...rowsById.values()].flatMap((row) => [
    row.user_id,
    ...(row.soundspin_message_reactions || []).map((reaction) => reaction.user_id),
  ]))]
  const currentProfiles: ChatUserProfile[] = []
  const profileNames = new Map<string, string>()

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await client
      .from('soundspin_profiles')
      .select('user_id, display_name, is_app_admin, avatar_key, avatar_url')
      .in('user_id', userIds)

    // Profile enrichment is optional; retain message snapshots if it is unavailable.
    for (const profile of profileError ? [] : profiles || []) {
      profileNames.set(profile.user_id, profile.display_name)
      currentProfiles.push({
        id: profile.user_id,
        avatarSeed: profile.user_id,
        avatarKey: profile.avatar_key,
        avatarUrl: safeChatMediaUrl(profile.avatar_url),
        isAppAdmin: profile.is_app_admin,
      })
    }
  }

  return mapChatRows(history, rowsById, currentProfiles, profileNames)
}

export function chatMessagesFromRows(history: ChatHistoryRow[], replies: ChatHistoryRow[] = [], profiles: Array<{
  user_id: string; display_name: string; is_app_admin?: boolean; avatar_key?: string; avatar_url?: string | null
}> = []) {
  const rowsById = new Map([...history, ...replies].map((row) => [row.id, row]))
  const names = new Map(profiles.map((profile) => [profile.user_id, profile.display_name]))
  const users: ChatUserProfile[] = profiles.map((profile) => ({ id: profile.user_id, avatarSeed: profile.user_id,
    avatarKey: profile.avatar_key, avatarUrl: safeChatMediaUrl(profile.avatar_url), isAppAdmin: Boolean(profile.is_app_admin) }))
  return mapChatRows(history, rowsById, users, names)
}

function mapChatRows(history: ChatHistoryRow[], rowsById: Map<string, ChatHistoryRow>, currentProfiles: ChatUserProfile[], profileNames: Map<string, string>) {
  const messages = history.map((row) => {
    const reply = row.reply_to_id ? rowsById.get(row.reply_to_id) : undefined
    return {
      id: row.id,
      content: row.content,
      type: row.message_type,
      mediaUrl: safeChatMediaUrl(row.media_url),
      storagePath: row.storage_path || undefined,
      mentions: normalizeChatMentions(row.mentions),
      user: {
        id: row.user_id,
        name: row.user_name,
        avatarSeed: row.avatar_seed,
      },
      replyTo: reply ? {
        id: reply.id,
        content: reply.content || normalizeChatSong(reply.song)?.title || '',
        type: reply.message_type,
        mediaUrl: safeChatMediaUrl(reply.media_url),
        mentions: normalizeChatMentions(reply.mentions),
        removedAt:reply.removed_at||undefined,
        user: {
          id: reply.user_id,
          name: reply.user_name,
        },
      } : undefined,
      reactions: (row.soundspin_message_reactions || []).map((reaction) => ({
        emoji: reaction.emoji,
        userId: reaction.user_id,
        userName: profileNames.get(reaction.user_id),
      })),
      poll: pollFromRow(row),
      song: row.removed_at ? undefined : normalizeChatSong(row.song),
      game: row.removed_at ? undefined : normalizeChatGame(row.game),
      createdAt: row.created_at,
      removedAt:row.removed_at||undefined,
    }
  })

  return applyChatUserProfiles(messages, currentProfiles)
}

function pollFromRow(row: ChatHistoryRow): ChatPoll | undefined {
  const options = normalizeChatPollOptions(row.poll_options)
  if (!options || row.message_type !== 'text' || !row.content.trim() || row.content.trim().length > 200) return undefined
  const votes = new Map<string, ChatPoll['votes'][number]>()
  for (const value of row.soundspin_poll_votes || []) {
    const vote = normalizeRealtimePollVote({ messageId: row.id, userId: value.user_id, optionIndex: value.option_index, revision: value.revision })
    if (!vote || vote.optionIndex >= options.length || (votes.get(vote.userId)?.revision || 0) >= vote.revision) continue
    votes.set(vote.userId, { userId: vote.userId, optionIndex: vote.optionIndex, revision: vote.revision })
  }
  return { options, votes: [...votes.values()] }
}

export async function saveChatMessage(
  client: SupabaseClient,
  roomSlug: string,
  currentUser: User,
  message: ChatMessage
): Promise<void> {
  const values = {
    id: message.id,
    room_slug: roomSlug,
    user_id: currentUser.id,
    user_name: currentUser.name,
    avatar_seed: currentUser.avatarSeed,
    content: message.content,
    message_type: message.type,
    media_url: message.mediaUrl || null,
    storage_path: message.storagePath || null,
    mentions: message.mentions || [],
    reply_to_id: message.replyTo?.id || null,
    poll_options: message.poll?.options || null,
    created_at: message.createdAt,
    song: message.song || null,
    game: message.game || null,
  }
  const { error } = await client.from('soundspin_messages').insert(values)
  if (!error) return
  if (error.code !== '23505') throw error

  // A lost response can leave a successful insert looking like a failure.
  // Verify the original owned message rather than overwriting or broadcasting it.
  const { data: existing, error: lookupError } = await client
    .from('soundspin_messages')
    .select('id, room_slug, user_id, content, message_type, media_url, storage_path, mentions, reply_to_id, poll_options, created_at, song, game')
    .eq('id', message.id)
    .eq('room_slug', roomSlug)
    .eq('user_id', currentUser.id)
    .maybeSingle()
  if (lookupError || !existing) throw lookupError || error
  const matches = existing.content === values.content && existing.message_type === values.message_type &&
    existing.media_url === values.media_url && existing.storage_path === values.storage_path &&
    existing.reply_to_id === values.reply_to_id &&
    JSON.stringify(existing.poll_options || null) === JSON.stringify(values.poll_options) &&
    JSON.stringify(existing.song || null) === JSON.stringify(values.song) &&
    JSON.stringify(existing.game || null) === JSON.stringify(values.game) &&
    new Date(existing.created_at).getTime() === new Date(values.created_at).getTime() &&
    JSON.stringify(normalizeChatMentions(existing.mentions).map(({ userId, userName, handle }) => [userId, userName, handle])) ===
      JSON.stringify(normalizeChatMentions(values.mentions).map(({ userId, userName, handle }) => [userId, userName, handle]))
  if (!matches) throw error
}

export async function persistReactionChange(
  client: SupabaseClient,
  change: {
    action: 'add' | 'remove'
    messageId: string
    userId: string
    emoji: string
  }
): Promise<void> {
  const { error } = change.action === 'remove'
    ? await client
        .from('soundspin_message_reactions')
        .delete()
        .eq('message_id', change.messageId)
        .eq('user_id', change.userId)
        .eq('emoji', change.emoji)
    : await client.from('soundspin_message_reactions').insert({
        message_id: change.messageId,
        user_id: change.userId,
        emoji: change.emoji,
      })

  if (error) throw error
}
