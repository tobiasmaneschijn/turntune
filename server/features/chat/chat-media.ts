import { serverT } from "../../lib/i18n.js";
import type { SupabaseClient } from '@supabase/supabase-js'
import { PublicRequestError } from '../../lib/public-request-error.js'
import { cleanupManagedUploads, queueManagedUpload, reserveManagedUpload, uploadReservedImage, type UploadLease } from '../uploads/managed-uploads.js'

export const CHAT_MEDIA_URL_TTL_SECONDS = 5 * 60
export function validChatStoragePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 1024 &&
    /^[a-zA-Z0-9-]{1,100}\/[a-z0-9-]{3,100}\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i.test(path) &&
    !path.includes('..')
  )
}

/** Call only after fresh room authorization. Legacy paths require an existing same-room message. */
export async function resolveChatMediaUrl(
  client: SupabaseClient | null,
  roomId: string,
  path: string,
  ownerId?: string,
  registeredUploadsOnly = false,
  allowPending = false
) {
  if (!client) throw new PublicRequestError(serverT("chat_image_uploads_are_unavailable"), 503)
  if (!validChatStoragePath(path)) throw new PublicRequestError(serverT("this_chat_image_is_unavailable"), 404)
  const [owner, folder] = path.split('/')
  const ownedNewUpload = ownerId === owner && folder === roomId
  let registeredPending = false
  if (registeredUploadsOnly) {
    const { data, error } = await client
      .from('soundspin_chat_uploads')
      .select('room_slug,user_id,message_id,removed_at,expires_at')
      .eq('storage_path', path)
      .maybeSingle()
    if (error) throw error
    if (data) {
      if (data.room_slug !== roomId || data.removed_at) throw new PublicRequestError(serverT("this_chat_image_is_unavailable"))
      registeredPending =
        allowPending &&
        ownedNewUpload &&
        data.user_id === ownerId &&
        !data.message_id &&
        Date.parse(data.expires_at) > Date.now()
      if (!data.message_id && !registeredPending) throw new PublicRequestError(serverT("this_uploaded_image_has_not_been_sent"))
    }
  }
  if ((registeredUploadsOnly && !registeredPending) || !ownedNewUpload) {
    const { data, error } = await client
      .from('soundspin_messages')
      .select('id,removed_at')
      .eq('room_slug', roomId)
      .eq('storage_path', path)
      .limit(1)
    if (error) throw error
    if (!data?.some((row) => !row.removed_at)) throw new PublicRequestError(serverT("this_chat_image_does_not_belong_to_this_room"))
  }
  const { data, error } = await client.storage.from('chat-media').createSignedUrl(path, CHAT_MEDIA_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) throw error || new Error(serverT("this_chat_image_is_unavailable"))
  return { url: data.signedUrl, expiresAt: Date.now() + CHAT_MEDIA_URL_TTL_SECONDS * 1000 }
}

/** Rows were obtained through an authorized room query; never sign an arbitrary client path here. */
export async function signChatHistoryMedia<
  T extends { storage_path?: string | null; media_url?: string | null; removed_at?: string | null }
>(client: SupabaseClient, rows: T[]): Promise<T[]> {
  const paths = [
    ...new Set(
      rows.flatMap((row) => (!row.removed_at && validChatStoragePath(row.storage_path) ? [row.storage_path] : []))
    )
  ]
  if (!paths.length) return rows.map((row) => (row.removed_at ? { ...row, media_url: null, storage_path: null } : row))
  const { data, error } = await client.storage.from('chat-media').createSignedUrls(paths, CHAT_MEDIA_URL_TTL_SECONDS)
  const signed = new Map((error ? [] : data || []).map((item) => [item.path, item.signedUrl]))
  return rows.map((row) =>
    row.removed_at
      ? { ...row, media_url: null, storage_path: null }
      : row.storage_path
        ? { ...row, media_url: signed.get(row.storage_path) || null }
        : row
  )
}

/** Recheck supplied history rows and upload state before granting Storage URLs. */
export async function signDurableChatHistoryMedia<
  T extends { id: string; storage_path?: string | null; media_url?: string | null; removed_at?: string | null }
>(client: SupabaseClient | null, roomId: string, rows: T[]): Promise<T[]> {
  const candidates = new Map(rows.filter(row => !row.removed_at && validChatStoragePath(row.storage_path)).map(row => [row.id, row]))
  const paths = [...new Set([...candidates.values()].map(row => row.storage_path!))], ids = [...candidates.keys()]
  const checked = new Set<string>(), referenced = new Set<string>(), signed = new Map<string, string>()
  const registrations = new Map<string, { room_slug: string; message_id: string | null; removed_at: string | null }>()
  if (client) {
    for (let offset = 0; offset < Math.max(paths.length, ids.length); offset += 100) {
      const pathBatch = paths.slice(offset, offset + 100), idBatch = ids.slice(offset, offset + 100)
      try {
        const [uploads, messages] = await Promise.all([
          pathBatch.length ? client.from('soundspin_chat_uploads').select('storage_path,room_slug,message_id,removed_at').in('storage_path', pathBatch) : Promise.resolve({ data: [], error: null }),
          idBatch.length ? client.from('soundspin_messages').select('id,room_slug,storage_path,removed_at').eq('room_slug', roomId).in('id', idBatch).is('removed_at', null) : Promise.resolve({ data: [], error: null })
        ])
        if (!uploads.error) {
          for (const path of pathBatch) checked.add(path)
          for (const upload of uploads.data || []) if (pathBatch.includes(upload.storage_path)) registrations.set(upload.storage_path, upload)
        }
        if (!messages.error) for (const message of messages.data || []) {
          if (idBatch.includes(message.id) && message.room_slug === roomId && !message.removed_at &&
            message.storage_path && candidates.get(message.id)?.storage_path === message.storage_path) referenced.add(message.storage_path)
        }
      } catch { /* Failed verification leaves those images without a capability. */ }
    }
    const eligible = paths.filter(path => {
      const upload = registrations.get(path)
      return checked.has(path) && referenced.has(path) && (!upload || (upload.room_slug === roomId && !upload.removed_at && Boolean(upload.message_id)))
    })
    for (let offset = 0; offset < eligible.length; offset += 100) {
      const batch = eligible.slice(offset, offset + 100)
      try {
        const { data, error } = await client.storage.from('chat-media').createSignedUrls(batch, CHAT_MEDIA_URL_TTL_SECONDS)
        if (!error) for (const item of data || []) if (!item.error && item.path && batch.includes(item.path) && item.signedUrl) signed.set(item.path, item.signedUrl)
      } catch { /* Keep text and other available images readable. */ }
    }
  }
  return rows.map(row => row.removed_at ? { ...row, media_url: null, storage_path: null }
    : row.storage_path ? { ...row, media_url: signed.get(row.storage_path) || null } : row)
}

/** Uploads are admitted by the server, registered privately, then claimed by one message. */
export async function uploadChatMedia(
  client: SupabaseClient | null,
  roomId: string,
  userId: string,
  bytes: unknown,
  contentType: string,
  check: () => Promise<unknown>,
  reserved?: UploadLease
) {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (!client) throw new PublicRequestError(serverT("chat_image_uploads_are_unavailable"), 503)
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 6 * 1024 * 1024) throw new PublicRequestError(serverT("choose_a_valid_image_of_6_mb_or_less"))
  await check()
  const lease = reserved || await reserveManagedUpload(client, userId, 'chat', bytes.length, mime, roomId)
  if (lease.actor_id !== userId || lease.room_slug !== roomId || lease.purpose !== 'chat') throw new PublicRequestError(serverT("chat_image_uploads_are_unavailable"), 503)
  const storagePath = lease.storage_path
  try {
    await uploadReservedImage(client, lease, bytes, mime, check)
    const { error: registrationError } = await client
      .from('soundspin_chat_uploads')
      .insert({
        storage_path: storagePath,
        room_slug: roomId,
        user_id: userId,
        mime_type: mime,
        size_bytes: bytes.length
      })
    if (registrationError) throw registrationError
    const signed = await resolveChatMediaUrl(client, roomId, storagePath, userId, true, true)
    await check()
    return { storagePath, ...signed }
  } catch (error) {
    // Persist the key even if Storage is unavailable or the process stops.
    await queueManagedUpload(client, lease).catch(() => undefined)
    await client.from('soundspin_chat_uploads').update({ removed_at: new Date().toISOString() }).eq('storage_path', storagePath).is('message_id', null)
    throw error
  }
}

/** The pending-row update wins against a simultaneous message claim. */
export async function cleanupChatUpload(
  client: SupabaseClient | null,
  roomId: string,
  userId: string,
  storagePath: unknown
) {
  if (!client || !validChatStoragePath(storagePath) || !storagePath.startsWith(`${userId}/${roomId}/`))
    throw new PublicRequestError(serverT("this_uploaded_image_is_unavailable"))
  const { data, error } = await client
    .from('soundspin_chat_uploads')
    .update({ removed_at: new Date().toISOString() })
    .eq('storage_path', storagePath)
    .eq('room_slug', roomId)
    .eq('user_id', userId)
    .is('message_id', null)
    .select('storage_path')
  if (error) throw error
  if (!data?.length) return { ok: true }
  await queueManagedUpload(client, { bucket_id: 'chat-media', storage_path: storagePath, actor_id: userId, room_slug: roomId }, CHAT_MEDIA_URL_TTL_SECONDS)
  return { ok: true }
}

/** Retires abandoned uploads and removed attachments after bearer URLs expire. */
export async function cleanupExpiredChatMedia(client: SupabaseClient | null, now = Date.now()) {
  return (await cleanupManagedUploads(client)).removed
}
