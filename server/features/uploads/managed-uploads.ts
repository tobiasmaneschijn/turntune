import { serverT } from "../../lib/i18n.js";
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { NextFunction, Request, Response } from 'express'
import { PublicRequestError, publicRequestFailure, trustedSqlRequestError } from '../../lib/public-request-error.js'
import { defaultResourcePolicy, type ResolvedResourcePolicy } from '../../../shared/resource-policy.js'

export type UploadPurpose = 'avatar' | 'feedback' | 'chat'
export interface UploadLease {
  id: string; actor_id: string; purpose: UploadPurpose; bucket_id: string; storage_path: string;
  size_bytes: number; room_slug: string | null; state: string
}
const FORMATS: Record<string, { extension: string; format: string }> = {
  'image/jpeg': { extension: 'jpg', format: 'jpeg' }, 'image/png': { extension: 'png', format: 'png' },
  'image/webp': { extension: 'webp', format: 'webp' }, 'image/gif': { extension: 'gif', format: 'gif' }
}
export const MAX_IMAGE_PIXELS = 8_000_000
export const MAX_IMAGE_DIMENSION = 4096
export const UPLOAD_PENDING_TTL_MINUTES = 15
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** sharp decodes only APNG's default image and may omit its frame count. Walk
 * actual PNG chunk boundaries, since an acTL string inside image/text data is
 * not an animation control chunk. Full decoding still validates the image. */
function rejectPngAnimation(bytes: Buffer) {
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return
  let offset = PNG_SIGNATURE.length
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) throw new Error(serverT("incomplete_png_chunk"))
    const type = bytes.readUInt32BE(offset + 4)
    if (type === 0x6163544c) throw new Error(serverT("png_animation_is_unsupported")) // acTL
    offset += length + 12
    if (type === 0x49454e44) return // IEND
  }
  throw new Error(serverT("incomplete_png_image"))
}
export function uploadMime(contentType: string, purpose: UploadPurpose) {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (!FORMATS[mime] || (purpose === 'feedback' && mime === 'image/gif')) throw new PublicRequestError(serverT("choose_a_jpeg_png_or_webp_image_avatars_and_chat_also_support_static_gif"))
  return mime
}

/** Decode every pixel with bounded dimensions/pages; header signatures alone are
 * insufficient. Keep original compressed bytes after validation, so reservations
 * always charge the exact stored size. sharp strips no bytes in this validation. */
export async function validateUploadImage(bytes: unknown, contentType: string, purpose: UploadPurpose) {
  const mime = uploadMime(contentType, purpose)
  const max = (purpose === 'chat' ? 6 : 5) * 1024 * 1024
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > max) throw new PublicRequestError(serverT("choose_a_valid_image_of_value1_mb_or_less", { value1: purpose === 'chat' ? 6 : 5 }))
  try {
    if (mime === 'image/png') rejectPngAnimation(bytes)
    const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, animated: true }).timeout({ seconds: 5 })
    const metadata = await decoder.metadata()
    if (metadata.format !== FORMATS[mime].format || !metadata.width || !metadata.height ||
      metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages || 1) !== 1)
      throw new Error(serverT("unsupported_image_dimensions_frames_or_format"))
    await decoder.raw().toBuffer()
  } catch { throw new PublicRequestError(serverT("choose_a_complete_static_image_no_larger_than_4096_pixels_per_side_or_8_million_pixel")) }
  return { bytes, mime }
}

export async function reserveManagedUpload(client: SupabaseClient | null, actor: string, purpose: UploadPurpose, bytes: number, contentType: string, room: string | null = null) {
  if (!client) throw new PublicRequestError(serverT("image_uploads_are_unavailable"), 503)
  const mime = uploadMime(contentType, purpose)
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > (purpose === 'chat' ? 6 : 5) * 1024 * 1024) throw new PublicRequestError(serverT("invalid_image_size"))
  const id = randomUUID(), bucket = purpose === 'chat' ? 'chat-media' : purpose === 'avatar' ? 'profile-avatars' : 'feedback-screenshots'
  const path = `${actor}/${purpose === 'chat' ? `${room}/` : ''}${id}.${FORMATS[mime].extension}`
  const { data, error } = await client.rpc('soundspin_reserve_upload', {
    p_id: id, p_actor: actor, p_purpose: purpose, p_bucket: bucket, p_path: path, p_bytes: bytes, p_room: room
  })
  if (error) throw trustedSqlRequestError(error, {
    'Too many stored images. Remove images before uploading more.': 429,
    'Too many uploads. Try again in an hour.': 429,
    'Too many unfinished uploads. Finish or remove them first.': 429,
    'Too many uploads in progress. Try again shortly.': 429,
    'Too many stored images in this room.': 429,
    'Invalid upload reservation.': 403,
    'Invalid upload room.': 403
  }, 'Image uploads are unavailable. Try again later.')
  if (!data || data.storage_path !== path || data.state !== 'reserved') throw new Error(serverT("upload_reservation_could_not_be_created"))
  return data as UploadLease
}
export async function queueManagedUpload(client: SupabaseClient, lease: Pick<UploadLease, 'bucket_id' | 'storage_path' | 'actor_id' | 'room_slug'>, delay = 0) {
  const { error } = await client.rpc('soundspin_queue_upload', { p_bucket: lease.bucket_id, p_path: lease.storage_path, p_actor: lease.actor_id, p_room: lease.room_slug, p_delay: delay })
  if (error) throw error
}
export async function uploadReservedImage(client: SupabaseClient, lease: UploadLease, bytes: unknown, contentType: string, check: () => Promise<unknown>) {
  try {
    const image = await validateUploadImage(bytes, contentType, lease.purpose)
    if (image.bytes.length !== Number(lease.size_bytes)) throw new PublicRequestError(serverT("image_size_does_not_match_its_upload_reservation"))
    await check()
    const { error } = await client.storage.from(lease.bucket_id).upload(lease.storage_path, image.bytes, { contentType: image.mime, upsert: false })
    if (error) throw error
    await check()
    const { error: updateError } = await client.rpc('soundspin_finish_upload', { p_id: lease.id, p_actor: lease.actor_id })
    if (updateError) throw trustedSqlRequestError(updateError, { 'This upload reservation has ended.': 409 }, 'Image uploads are unavailable. Try again later.')
    return lease.storage_path
  } catch (error) {
    await queueManagedUpload(client, lease).catch(() => undefined)
    throw error
  }
}

/** Admission, process work limits, and durable budget checks precede raw parsing.
 * Requiring Content-Length makes the reservation authoritative for body bytes.
 * The proxy must also cap chunked/slow bodies; no anonymous body reaches sharp. */
let activeUploads = 0
const activeActors = new Map<string, number>()
export function managedUploadAdmission(options: {
  client: SupabaseClient | null; getUserId: (request: Request) => Promise<string | null>;
  purpose: UploadPurpose; room?: (request: Request) => string;
  check?: (actor: string, room: string | null) => Promise<unknown>
  getResourcePolicy?: (actor:string)=>Promise<ResolvedResourcePolicy>
}) {
  return async (request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store')
    let lease: UploadLease | undefined, actor: string | null = null, counted = false
    try {
      actor = await options.getUserId(request)
      if (!actor) { response.status(401).json({ error: serverT("sign_in_to_upload_an_image") }); return }
      if (!options.client) { response.status(503).json({ error: serverT("image_uploads_are_unavailable") }); return }
      const room = options.room?.(request) || null
      await options.check?.(actor, room)
      const policy=await options.getResourcePolicy?.(actor)??defaultResourcePolicy()
      const length = request.get('content-length')
      if (!length || !/^\d{1,8}$/.test(length)) { response.status(411).json({ error: serverT("send_the_image_with_its_file_size") }); return }
      const size = Number(length)
      if (size < 1 || size > policy.limits.uploads[options.purpose].fileBytes) { response.status(413).json({ error: serverT("this_image_is_too_large_or_empty") }); return }
      if (activeUploads >= policy.global.uploadsInFlight || (activeActors.get(actor) || 0) >= policy.limits.uploadsInFlight) { response.status(429).json({ error: serverT("too_many_uploads_in_progress_try_again_shortly") }); return }
      activeUploads++; activeActors.set(actor, (activeActors.get(actor) || 0) + 1); counted = true
      lease = await reserveManagedUpload(options.client, actor, options.purpose, size, request.get('content-type') || '', room)
      response.locals.uploadLease = lease
      response.locals.uploadActor = actor
      let finished = false
      const release = () => {
        if (finished) return
        finished = true
        activeUploads--; const remaining = (activeActors.get(actor!) || 1) - 1
        if (remaining) activeActors.set(actor!, remaining); else activeActors.delete(actor!)
        if (!response.locals.uploadComplete) void queueManagedUpload(options.client!, lease!).catch(() => undefined)
      }
      response.once('finish', release); response.once('close', release)
      next()
    } catch (error) {
      if (counted) { activeUploads--; const remaining = (activeActors.get(actor!) || 1) - 1; if (remaining) activeActors.set(actor!, remaining); else activeActors.delete(actor!) }
      const failure = publicRequestFailure(error, 'Image uploads are unavailable. Try again later.', { operation: 'upload.admit' })
      response.status(failure.status).json({ error: failure.message })
    }
  }
}

export async function enqueueAccountUploadDeletion(client: SupabaseClient, userId: string) {
  const { data, error } = await client.rpc('soundspin_enqueue_upload_deletion', { p_actor: userId, p_room: null })
  if (error) throw error
  return Number(data || 0)
}
export async function enqueueRoomUploadDeletion(client: SupabaseClient, roomId: string) {
  const { data, error } = await client.rpc('soundspin_enqueue_upload_deletion', { p_actor: null, p_room: roomId })
  if (error) throw error
  return Number(data || 0)
}

/** Bounded backlog drain; keys are removed only after Storage confirms deletion.
 * Failed batches retain durable keys and exponential retry state. */
export async function cleanupManagedUploads(client: SupabaseClient | null, options: { maxBatches?: number; batchSize?: number; maxMs?: number } = {}) {
  if (!client) return { removed: 0, remaining: 0, oldestAt: null as string | null, failed: 0 }
  const deadline = Date.now() + (options.maxMs ?? 20_000), batchSize = Math.min(100, options.batchSize ?? 100)
  let removed = 0, failed = 0
  for (let batch = 0; batch < (options.maxBatches ?? 20) && Date.now() < deadline; batch++) {
    const { error: collectError } = await client.rpc('soundspin_collect_expired_uploads', { p_limit: 500 })
    if (collectError) throw collectError
    const { data, error } = await client.from('soundspin_storage_deletion_outbox').select('*').lte('available_at', new Date().toISOString()).order('queued_at').limit(batchSize)
    if (error) throw error
    if (!data?.length) break
    const buckets = [...new Set(data.map(row => String(row.bucket_id)))]
    for (const bucket of buckets) {
      const rows = data.filter(row => row.bucket_id === bucket), paths = rows.map(row => String(row.storage_path))
      try {
        const { error: storageError } = await client.storage.from(bucket).remove(paths)
        if (storageError) throw storageError
        // A late completed write may enqueue compensation while Storage.remove
        // is in flight. A bounded transaction acknowledges observed generations
        // and releases registry/ledger capacity together, at one RPC per batch.
        const { data: acknowledged, error: ackError } = await client.rpc('soundspin_complete_upload_deletions', {
          p_bucket: bucket, p_items: rows.map(row => ({ path: row.storage_path, generation: row.generation }))
        })
        if (ackError) throw ackError
        removed += Number(acknowledged || 0)
      } catch (error) {
        failed += paths.length
        const { error: retryError } = await client.rpc('soundspin_retry_upload_deletions', {
          p_bucket: bucket, p_items: rows.map(row => ({ path: row.storage_path, generation: row.generation }))
        })
        if (retryError) throw retryError
      }
    }
  }
  const { data: oldest, count, error: ageError } = await client.from('soundspin_storage_deletion_outbox').select('queued_at', { count: 'exact' }).order('queued_at').limit(1)
  if (ageError) throw ageError
  // A one-hour audit window remains after deletion for quota accounting; prune
  // completed ledger rows after 7 days so abandoned attempts cannot grow forever.
  const { error: pruneError } = await client.from('soundspin_managed_uploads').delete().eq('state', 'deleted').lt('created_at', new Date(Date.now() - 7 * 86400_000).toISOString())
  if (pruneError) throw pruneError
  return { removed, remaining: count || 0, oldestAt: oldest?.[0]?.queued_at || null, failed }
}
