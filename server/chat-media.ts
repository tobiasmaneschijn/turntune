import type { SupabaseClient } from '@supabase/supabase-js'

export const CHAT_MEDIA_URL_TTL_SECONDS = 5 * 60
export function validChatStoragePath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 1024 && /^[a-zA-Z0-9-]{1,100}\/[a-z0-9-]{3,100}\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i.test(path) && !path.includes('..')
}

/** Call only after fresh room authorization. Legacy paths require an existing same-room message. */
export async function resolveChatMediaUrl(client: SupabaseClient | null, roomId: string, path: string, ownerId?: string) {
  if (!client || !validChatStoragePath(path)) throw new Error('This chat image is unavailable.')
  const [owner, folder] = path.split('/')
  const ownedNewUpload = ownerId === owner && folder === roomId
  if (!ownedNewUpload) {
    const { data, error } = await client.from('soundspin_messages').select('id').eq('room_slug', roomId).eq('storage_path', path).limit(1)
    if (error) throw error
    if (!data?.length) throw new Error('This chat image does not belong to this room.')
  }
  const { data, error } = await client.storage.from('chat-media').createSignedUrl(path, CHAT_MEDIA_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) throw error || new Error('This chat image is unavailable.')
  return { url: data.signedUrl, expiresAt: Date.now() + CHAT_MEDIA_URL_TTL_SECONDS * 1000 }
}

/** Rows were obtained through an authorized room query; never sign an arbitrary client path here. */
export async function signChatHistoryMedia<T extends { storage_path?: string | null; media_url?: string | null }>(client: SupabaseClient, rows: T[]): Promise<T[]> {
  const paths = [...new Set(rows.flatMap((row) => validChatStoragePath(row.storage_path) ? [row.storage_path] : []))]
  if (!paths.length) return rows
  const { data, error } = await client.storage.from('chat-media').createSignedUrls(paths, CHAT_MEDIA_URL_TTL_SECONDS)
  const signed = new Map((error ? [] : data || []).map((item) => [item.path, item.signedUrl]))
  return rows.map((row) => row.storage_path ? { ...row, media_url: signed.get(row.storage_path) || null } : row)
}
