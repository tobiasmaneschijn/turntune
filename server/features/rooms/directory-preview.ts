import type { Room, RoomDirectoryEntry } from "../../types.js";

/** Public previews describe current room playback and never serialize private queues. */
export function withPublicRoomPreview(entry: RoomDirectoryEntry, room: Room | undefined, now = Date.now()): RoomDirectoryEntry {
  const base = { ...entry };
  delete base.preview;
  if (!entry.isPublic || entry.passwordProtected || !room?.isPublic || room.passwordProtected || entry.listenerCount < 1 || !room.playback.track) return base;
  const track = room.playback.track;
  let artworkUrl: string | undefined;
  try { if (track.artworkUrl && track.artworkUrl.length <= 2048 && new URL(track.artworkUrl).protocol === "https:") artworkUrl = track.artworkUrl; } catch { /* Invalid artwork stays absent. */ }
  return { ...base, preview: {
    title: track.title.slice(0, 120), artist: track.artist?.slice(0, 120), artworkUrl,
    provider: track.provider, playing: room.playback.playing, observedAt: now
  } };
}
