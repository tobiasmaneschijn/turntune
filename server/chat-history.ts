import express, { type Express, type Request, type Response } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalMessage, chatMessageSchema, chatReactionSchema, immutableMessageKey, type ChatMessageInput, type ChatReply, type RelayMessage } from './chat-validation.js'
import type { User } from './types.js'
import { resolveChatMediaUrl, signChatHistoryMedia } from './chat-media.js'

interface Cursor { createdAt: string; id: string }
interface HistoryRow {
  id: string; created_at: string; reply_to_id: string | null; user_id: string
  content: string; message_type: 'text' | 'image' | 'gif'; media_url?: string | null; storage_path?: string | null
  mentions?: RelayMessage['mentions']; user_name: string; avatar_seed: string
  soundspin_message_reactions?: Array<{ emoji: string; user_id: string }>
}
export interface ChatHistoryRouteOptions {
  client: SupabaseClient | null
  getUserId: (request: Request) => Promise<string | null | undefined>
  canReadRoom: (userId: string, roomSlug: string) => Promise<boolean>
  canWriteRoom?: (userId: string, roomSlug: string) => Promise<boolean>
  getUser?: (userId: string, roomSlug: string) => Promise<User | null>
}
const SELECT = 'id, content, message_type, media_url, storage_path, mentions, user_id, user_name, avatar_seed, created_at, reply_to_id, soundspin_message_reactions(emoji, user_id)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const cursorFor = (row: HistoryRow): Cursor => ({ id: row.id, createdAt: row.created_at })
function cursorFilter(cursor: Cursor, direction: 'older' | 'newer') {
  const operator = direction === 'older' ? 'lt' : 'gt'
  return `created_at.${operator}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${operator}.${cursor.id})`
}
class BadRequest extends Error {}
class Conflict extends Error {}

export interface StoredChatMessage { roomId: string; userId: string; message: ChatMessageInput }
/** Global UUID lookup is used only after relay admission, to reject collisions across rooms/authors. */
export async function loadStoredChatMessage(client: SupabaseClient | null, id: string): Promise<StoredChatMessage | null> {
  if (!client) throw new Error('Chat storage is unavailable. Please try again.')
  if (!UUID.test(id)) throw new BadRequest('Invalid message.')
  const { data, error } = await client.from('soundspin_messages')
    .select('room_slug, user_id, id, content, message_type, media_url, storage_path, mentions, reply_to_id, created_at').eq('id', id).maybeSingle()
  if (error) throw error
  const row = data as (HistoryRow & { room_slug: string }) | null
  if (!row) return null
  return { roomId: row.room_slug, userId: row.user_id, message: chatMessageSchema.parse({ id: row.id, content: row.content,
    type: row.message_type, createdAt: row.created_at, mediaUrl: row.media_url || undefined, storagePath: row.storage_path || undefined,
    mentions: row.mentions || [], replyTo: row.reply_to_id ? { id: row.reply_to_id } : undefined }) }
}

export async function loadChatReply(client: SupabaseClient | null, room: string, id: string): Promise<ChatReply | null> {
  if (!client || !UUID.test(id)) return null
  const { data, error } = await client.from('soundspin_messages').select(SELECT).eq('room_slug', room).eq('id', id).maybeSingle()
  if (error) throw error
  const row = data as HistoryRow | null
  if (!row) return null
  const [signed] = await signChatHistoryMedia(client, [row])
  return { id: row.id, content: row.content, type: row.message_type, mediaUrl: signed.media_url || undefined, mentions: row.mentions || [], user: { id: row.user_id, name: row.user_name } }
}
function readCursor(request: Request): Cursor | undefined {
  const createdAt = request.query.beforeAt
  const id = request.query.beforeId
  if (createdAt === undefined && id === undefined) return undefined
  if (typeof createdAt !== 'string' || !TIMESTAMP.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) || typeof id !== 'string' || !UUID.test(id)) throw new BadRequest('Invalid history position.')
  return { createdAt, id }
}
async function readRows(client: SupabaseClient, roomSlug: string, cursor: Cursor | undefined, direction: 'older' | 'newer', limit: number, search?: string) {
  let query = client.from('soundspin_messages').select(SELECT).eq('room_slug', roomSlug)
  if (cursor) query = query.or(cursorFilter(cursor, direction))
  if (search !== undefined) query = query.ilike('content', `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`)
  const { data, error } = await query.order('created_at', { ascending: direction === 'newer' }).order('id', { ascending: direction === 'newer' }).limit(limit + 1)
  if (error) throw error
  const source = (data || []) as HistoryRow[]
  const rows = source.slice(0, limit)
  const last = rows.at(-1)
  return { rows: direction === 'older' ? rows.reverse() : rows, hasMore: source.length > limit, cursor: last ? cursorFor(last) : undefined }
}
async function enrich(client: SupabaseClient, roomSlug: string, rows: HistoryRow[]) {
  const loaded = new Set(rows.map((row) => row.id))
  const missing = [...new Set(rows.flatMap((row) => row.reply_to_id && !loaded.has(row.reply_to_id) ? [row.reply_to_id] : []))]
  const replies: HistoryRow[] = []
  if (missing.length) {
    const { data, error } = await client.from('soundspin_messages').select(SELECT).eq('room_slug', roomSlug).in('id', missing)
    if (!error) replies.push(...(data || []) as HistoryRow[])
  }
  const ids = [...new Set([...rows, ...replies].flatMap((row) => [row.user_id, ...(row.soundspin_message_reactions || []).map((reaction) => reaction.user_id)]))]
  const profiles: unknown[] = []
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await client.from('soundspin_profiles').select('user_id, display_name, is_app_admin, avatar_key, avatar_url').in('user_id', ids.slice(offset, offset + 100))
    if (!error) profiles.push(...data || [])
  }
  const [signedRows, signedReplies] = await Promise.all([signChatHistoryMedia(client, rows), signChatHistoryMedia(client, replies)])
  return { rows: signedRows, replies: signedReplies, profiles }
}

/** Every endpoint authorizes BEFORE privileged reads, including target/reply/context queries. */
export function mountChatHistoryRoutes(app: Express, options: ChatHistoryRouteOptions) {
  const replyWithReadCheck = async (userId: string, room: string, response: Response, payload: unknown) => {
    if (!await options.canReadRoom(userId, room)) { response.status(403).json({ error: 'This room session has ended.' }); return }
    response.json(payload)
  }
  const authorized = (run: (client: SupabaseClient, roomSlug: string, request: Request, response: Response, userId: string) => Promise<void>, write = false) => async (request: Request, response: Response) => {
    response.setHeader('Cache-Control', 'no-store')
    let userId: string | null | undefined
    try { userId = await options.getUserId(request) } catch { response.status(401).json({ error: 'Sign in to read room chat.' }); return }
    if (!userId) { response.status(401).json({ error: 'Sign in to read room chat.' }); return }
    const roomSlug = request.params.roomSlug
    if (typeof roomSlug !== 'string' || !/^[a-z0-9-]{3,48}$/.test(roomSlug)) { response.status(400).json({ error: 'Invalid room.' }); return }
    if (!options.client) { response.status(503).json({ error: 'Chat history is unavailable.' }); return }
    try {
      const allowed = write ? await options.canWriteRoom?.(userId, roomSlug) : await options.canReadRoom(userId, roomSlug)
      if (!allowed) { response.status(403).json({ error: write ? 'Join this room before saving chat messages or reactions.' : 'Join this room before reading its chat history.' }); return }
      await run(options.client, roomSlug, request, response, userId)
    } catch (error) {
      response.status(error instanceof Conflict ? 409 : error instanceof BadRequest ? 400 : 503).json({ error: error instanceof BadRequest || error instanceof Conflict ? error.message : write ? 'Chat could not be saved. Try again.' : 'Chat history could not be loaded. Try again.' })
    }
  }
  app.get('/api/rooms/:roomSlug/chat/history', authorized(async (client, room, request, response, userId) => {
    const direction = request.query.direction === undefined || request.query.direction === 'older' ? 'older' : request.query.direction === 'newer' ? 'newer' : null
    const limit = request.query.pageSize === undefined ? 200 : Number(request.query.pageSize)
    if (!direction || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequest('Invalid history page.')
    const page = await readRows(client, room, readCursor(request), direction, limit)
    await replyWithReadCheck(userId, room, response, { ...await enrich(client, room, page.rows), cursor: page.cursor, hasMore: page.hasMore })
  }))
  app.get('/api/rooms/:roomSlug/chat/search', authorized(async (client, room, request, response, userId) => {
    const query = request.query.q
    if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 100) throw new BadRequest('Enter 2–100 characters to search room messages.')
    const page = await readRows(client, room, readCursor(request), 'older', 40, query.trim())
    await replyWithReadCheck(userId, room, response, { ...await enrich(client, room, page.rows), cursor: page.cursor, hasMore: page.hasMore })
  }))
  const target = async (client: SupabaseClient, room: string, request: Request) => {
    const id = request.params.messageId
    if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequest('Invalid message.')
    const { data, error } = await client.from('soundspin_messages').select(SELECT).eq('room_slug', room).eq('id', id).maybeSingle()
    if (error) throw error
    return data as HistoryRow | null
  }
  app.get('/api/rooms/:roomSlug/chat/messages/:messageId', authorized(async (client, room, request, response, userId) => {
    const row = await target(client, room, request)
    await replyWithReadCheck(userId, room, response, row ? await enrich(client, room, [row]) : null)
  }))
  app.get('/api/rooms/:roomSlug/chat/context/:messageId', authorized(async (client, room, request, response, userId) => {
    const row = await target(client, room, request)
    if (!row) { await replyWithReadCheck(userId, room, response, null); return }
    const cursor = cursorFor(row)
    const [older, newer] = await Promise.all([readRows(client, room, cursor, 'older', 20), readRows(client, room, cursor, 'newer', 20)])
    await replyWithReadCheck(userId, room, response, { ...await enrich(client, room, [...older.rows, row, ...newer.rows]), olderCursor: older.cursor || cursor,
      newerCursor: newer.cursor || cursor, hasOlder: older.hasMore, hasNewer: newer.hasMore })
  }))
  app.post('/api/rooms/:roomSlug/chat/messages', express.json({ limit: '16kb' }), authorized(async (client, room, request, response, userId) => {
    const parsed = chatMessageSchema.safeParse(request.body)
    if (!parsed.success) throw new BadRequest('Invalid room chat message.')
    const user = await options.getUser?.(userId, room) || { id: userId, name: 'Listener', avatarSeed: userId }
    if (user.id !== userId) throw new BadRequest('Invalid chat account.')
    const reply = parsed.data.replyTo ? await loadChatReply(client, room, parsed.data.replyTo.id) : undefined
    if (parsed.data.replyTo && !reply) throw new BadRequest('The message you replied to is unavailable.')
    let message: RelayMessage
    try { message = canonicalMessage(parsed.data, user, reply || undefined) } catch (error) { throw new BadRequest(error instanceof Error ? error.message : 'Invalid chat image.') }
    if (message.storagePath) {
      try { message.mediaUrl = (await resolveChatMediaUrl(client, room, message.storagePath, userId)).url }
      catch (error) { throw new BadRequest(error instanceof Error ? error.message : 'Chat image is unavailable.') }
    }
    const values = { id: message.id, room_slug: room, user_id: userId, user_name: user.name, avatar_seed: user.avatarSeed,
      content: message.content, message_type: message.type, media_url: message.mediaUrl || null, storage_path: message.storagePath || null,
      mentions: message.mentions, reply_to_id: message.replyTo?.id || null, created_at: message.createdAt }
    if (!await options.canWriteRoom?.(userId, room)) { response.status(403).json({ error: 'This room session has ended.' }); return }
    const { error } = await client.from('soundspin_messages').insert(values)
    if (error) {
      if (error.code !== '23505') throw error
      const { data, error: lookupError } = await client.from('soundspin_messages').select(SELECT).eq('room_slug', room).eq('user_id', userId).eq('id', message.id).maybeSingle()
      if (lookupError) throw lookupError
      const existing = data as HistoryRow | null
      const original = existing ? { content: existing.content, type: existing.message_type, mediaUrl: existing.media_url || undefined,
        storagePath: existing.storage_path || undefined, createdAt: existing.created_at, mentions: existing.mentions || [], replyTo: existing.reply_to_id ? { id: existing.reply_to_id } : undefined } : null
      if (!original || immutableMessageKey(original as typeof parsed.data) !== immutableMessageKey(message)) throw new Conflict('This message ID already belongs to different content, account, or room.')
    }
    response.json({ ok: true })
  }, true))
  app.post('/api/rooms/:roomSlug/chat/reactions', express.json({ limit: '16kb' }), authorized(async (client, room, request, response, userId) => {
    const parsed = chatReactionSchema.safeParse(request.body)
    if (!parsed.success) throw new BadRequest('Invalid room chat reaction.')
    if (!await loadChatReply(client, room, parsed.data.messageId)) throw new BadRequest('This room message is unavailable.')
    const values = { message_id: parsed.data.messageId, user_id: userId, emoji: parsed.data.emoji }
    if (!await options.canWriteRoom?.(userId, room)) { response.status(403).json({ error: 'This room session has ended.' }); return }
    const { error } = parsed.data.action === 'add'
      ? await client.from('soundspin_message_reactions').upsert(values, { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: true })
      : await client.from('soundspin_message_reactions').delete().eq('message_id', values.message_id).eq('user_id', userId).eq('emoji', values.emoji)
    if (error) throw error
    response.json({ ok: true })
  }, true))
  app.post('/api/rooms/:roomSlug/chat/media-url', express.json({ limit: '2kb' }), authorized(async (client, room, request, response, userId) => {
    if (typeof request.body?.storagePath !== 'string') throw new BadRequest('Invalid chat image.')
    let result: Awaited<ReturnType<typeof resolveChatMediaUrl>>
    try { result = await resolveChatMediaUrl(client, room, request.body.storagePath, userId) } catch (error) { throw new BadRequest(error instanceof Error ? error.message : 'Chat image is unavailable.') }
    if (!await options.canReadRoom(userId, room)) { response.status(403).json({ error: 'This room session has ended.' }); return }
    response.json(result)
  }))
}
