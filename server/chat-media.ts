import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

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
  if (!client || !validChatStoragePath(path)) throw new Error('This chat image is unavailable.')
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
      if (data.room_slug !== roomId || data.removed_at) throw new Error('This chat image is unavailable.')
      registeredPending =
        allowPending &&
        ownedNewUpload &&
        data.user_id === ownerId &&
        !data.message_id &&
        Date.parse(data.expires_at) > Date.now()
      if (!data.message_id && !registeredPending) throw new Error('This uploaded image has not been sent.')
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
    if (!data?.some((row) => !row.removed_at)) throw new Error('This chat image does not belong to this room.')
  }
  const { data, error } = await client.storage.from('chat-media').createSignedUrl(path, CHAT_MEDIA_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) throw error || new Error('This chat image is unavailable.')
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

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}
function imageBytesMatch(bytes: Buffer, mime: string) {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/png')
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
  return (
    mime === 'image/webp' &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}
/** Uploads are admitted by the server, registered privately, then claimed by one message. */
export async function uploadChatMedia(
  client: SupabaseClient | null,
  roomId: string,
  userId: string,
  bytes: unknown,
  contentType: string,
  check: () => Promise<unknown>
) {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (!client) throw new Error('Chat image uploads are unavailable.')
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > 6 * 1024 * 1024 ||
    !TYPES[mime] ||
    !imageBytesMatch(bytes, mime)
  )
    throw new Error('Choose a JPEG, PNG, WebP, or GIF image of 6 MB or less.')
  const storagePath = `${userId}/${roomId}/${randomUUID()}.${TYPES[mime]}`
  await check()
  try {
    const { error } = await client.storage
      .from('chat-media')
      .upload(storagePath, bytes, { contentType: mime, upsert: false })
    if (error) throw error
    await check()
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
    await client.storage
      .from('chat-media')
      .remove([storagePath])
      .catch(() => undefined)
    await client.from('soundspin_chat_uploads').delete().eq('storage_path', storagePath)
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
    throw new Error('This uploaded image is unavailable.')
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
  const { error: storageError } = await client.storage.from('chat-media').remove([storagePath])
  if (storageError) throw storageError
  const { error: deleteError } = await client
    .from('soundspin_chat_uploads')
    .delete()
    .eq('storage_path', storagePath)
    .is('message_id', null)
  if (deleteError) throw deleteError
  return { ok: true }
}

/** Retires abandoned uploads and removed attachments after bearer URLs expire. */
export async function cleanupExpiredChatMedia(client: SupabaseClient | null, now = Date.now()) {
  if (!client) return 0
  const { error: markError } = await client
    .from('soundspin_chat_uploads')
    .update({ removed_at: new Date(now).toISOString() })
    .is('message_id', null)
    .is('removed_at', null)
    .lt('expires_at', new Date(now).toISOString())
  if (markError) throw markError
  const { data, error } = await client
    .from('soundspin_chat_uploads')
    .select('storage_path')
    .not('removed_at', 'is', null)
    .lt('removed_at', new Date(now - CHAT_MEDIA_URL_TTL_SECONDS * 1000).toISOString())
    .limit(100)
  if (error) throw error
  const paths = (data || []).map((row) => row.storage_path).filter(validChatStoragePath)
  if (!paths.length) return 0
  const { error: storageError } = await client.storage.from('chat-media').remove(paths)
  if (storageError) throw storageError
  const { error: deleteError } = await client
    .from('soundspin_chat_uploads')
    .delete()
    .in('storage_path', paths)
    .not('removed_at', 'is', null)
  if (deleteError) throw deleteError
  return paths.length
}
