import type { SupabaseClient } from '@supabase/supabase-js'

import {
  applyChatUserProfiles,
  type ChatMessage,
  type ChatMessageType,
  type ChatUserProfile,
} from '@/chat/model'
import type { User } from '@/types'
import { normalizeChatMentions } from '@/chat/mentions'

export const CHAT_HISTORY_LIMIT = 200

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
  'soundspin_message_reactions(emoji, user_id)',
].join(', ')

interface ChatHistoryRow {
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
  reply_to_id: string | null
  soundspin_message_reactions: Array<{ emoji: string; user_id: string }> | null
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
    .limit(CHAT_HISTORY_LIMIT)

  if (error) throw error

  const history = ([...(data || [])] as unknown as ChatHistoryRow[]).reverse()
  const rowsById = new Map(history.map((row) => [row.id, row]))
  const userIds = [...new Set(history.flatMap((row) => [
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

    if (profileError) throw profileError
    for (const profile of profiles || []) {
      profileNames.set(profile.user_id, profile.display_name)
      currentProfiles.push({
        id: profile.user_id,
        avatarSeed: profile.user_id,
        avatarKey: profile.avatar_key,
        avatarUrl: profile.avatar_url || undefined,
        isAppAdmin: profile.is_app_admin,
      })
    }
  }

  const messages = history.map((row) => {
    const reply = row.reply_to_id ? rowsById.get(row.reply_to_id) : undefined
    return {
      id: row.id,
      content: row.content,
      type: row.message_type,
      mediaUrl: row.media_url || undefined,
      storagePath: row.storage_path || undefined,
      mentions: normalizeChatMentions(row.mentions),
      user: {
        id: row.user_id,
        name: row.user_name,
        avatarSeed: row.avatar_seed,
      },
      replyTo: reply ? {
        id: reply.id,
        content: reply.content,
        type: reply.message_type,
        mediaUrl: reply.media_url || undefined,
        mentions: normalizeChatMentions(reply.mentions),
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
      createdAt: row.created_at,
    }
  })

  return applyChatUserProfiles(messages, currentProfiles)
}

export async function saveChatMessage(
  client: SupabaseClient,
  roomSlug: string,
  currentUser: User,
  message: ChatMessage
): Promise<void> {
  const { error } = await client.from('soundspin_messages').insert({
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
    created_at: message.createdAt,
  })
  if (error) throw error
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
