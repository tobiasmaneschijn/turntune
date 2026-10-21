import { normalizeChatSong, type ChatSongAttachment } from '../../../shared/chat-attachments'
import type { Track } from '@/types'
import { trackSourceUrl } from './music-presentation'

export const SONG_DRAG_TYPE = 'application/x-turntune-song'
const MAX_DRAG_LENGTH = 16_384

/** Only the public player and History write this format; private queue drags do not. */
export function songFromTrack(track: Track, positionSeconds?: number): ChatSongAttachment | undefined {
  return normalizeChatSong({ id: track.id, provider: track.provider, providerId: track.providerId,
    title: track.title, artist: track.artist, artworkUrl: track.artworkUrl, artworkSources: track.artworkSources,
    permalinkUrl: track.permalinkUrl, durationMs: track.durationMs, positionSeconds })
}

export function writeSongDrag(data: DataTransfer, roomId: string, song: ChatSongAttachment | undefined): boolean {
  const normalized = normalizeChatSong(song)
  if (!normalized || !roomId) return false
  const payload = JSON.stringify({ roomId, song: normalized })
  if (payload.length > MAX_DRAG_LENGTH) return false
  data.effectAllowed = 'copy'
  data.setData(SONG_DRAG_TYPE, payload)
  const url = trackSourceUrl(normalized)
  if (url) { data.setData('text/uri-list', url); data.setData('text/plain', url) }
  return true
}

/** Dragover can inspect formats, but browsers withhold payloads until drop. */
export function hasSongDrag(data: DataTransfer): boolean {
  return Array.from(data.types).includes(SONG_DRAG_TYPE)
}

export function readSongDrag(data: DataTransfer, roomId: string): ChatSongAttachment | undefined {
  const raw = data.getData(SONG_DRAG_TYPE)
  if (!raw || raw.length > MAX_DRAG_LENGTH) return
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('roomId' in value) || value.roomId !== roomId || !('song' in value)) return
    return normalizeChatSong(value.song)
  } catch { return }
}
