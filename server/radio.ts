import type { Room, SnapshotRoom, Track, User } from "./types.js";

export class GracePeriodRegistry {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly delayMs: number) {}

  /**
   * Starts at most one timer for a room/user pair. Socket.IO may report several
   * disconnects for the same account (multiple tabs), so scheduling must be
   * idempotent or an old timer could evict a DJ after they reconnect.
   */
  schedule(key: string, onExpire: () => void) {
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      onExpire();
    }, this.delayMs);
    this.timers.set(key, timer);
  }

  cancel(key: string) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  has(key: string) {
    return this.timers.has(key);
  }

  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/**
 * Repairs persisted room state at the server boundary.
 *
 * Room JSON can outlive several application versions. Keep compatibility and
 * de-duplication here instead of spreading defensive checks across handlers.
 */
export function normalizeRadioState(room: Room) {
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const ids = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  const tracks = (value: unknown): Track[] => Array.isArray(value) ? value.filter(isUsableTrack) : [];
  if (!object(room.settings)) room.settings = {};
  room.settings.djAccess = room.settings.djAccess === "roles" ? "roles" : "everyone";
  room.moderatorUserIds = ids(room.moderatorUserIds);
  room.djRoleUserIds = ids(room.djRoleUserIds);
  room.djQueueUserIds = ids(room.djQueueUserIds);
  const queues: Record<string, Track[]> = Object.create(null);
  if (object(room.djQueues)) {
    for (const [id, value] of Object.entries(room.djQueues)) {
      queues[id] = tracks(value);
    }
  }
  room.djQueues = queues;
  room.history = tracks(room.history).slice(0, 100);
  const playback: Record<string, unknown> = object(room.playback) ? room.playback : {};
  const playingTrack = isUsableTrack(playback.track) ? playback.track : null;
  room.playback = {
    track: playingTrack,
    playing: Boolean(playingTrack && playback.playing === true),
    position: playingTrack && typeof playback.position === "number" && Number.isFinite(playback.position)
      ? Math.max(0, playback.position) : 0,
    updatedAt: typeof playback.updatedAt === "number" && Number.isFinite(playback.updatedAt)
      ? playback.updatedAt : Date.now()
  };
  room.createdAt = typeof room.createdAt === "number" && Number.isFinite(room.createdAt) ? room.createdAt : Date.now();
  room.isPublic = typeof room.isPublic === "boolean" ? room.isPublic : true;
  room.passwordProtected = room.passwordProtected === true;

  // Move rooms created before the round-robin flow into private per-user queues.
  if (Array.isArray(room.queue)) {
    for (const track of tracks(room.queue)) {
      const userId = track.addedBy.id;
      const queue = privateQueue(room, userId);
      if (!queue.some((queuedTrack) => queuedTrack.id === track.id)) queue.push(track);
      if (!room.djQueueUserIds.includes(userId)) room.djQueueUserIds.push(userId);
    }
  }
  delete room.queue;

  if (room.playback.track) {
    room.djUserId = room.playback.track.addedBy.id;
    if (!room.djQueueUserIds.includes(room.djUserId)) room.djQueueUserIds.push(room.djUserId);
  } else {
    room.djUserId = null;
  }
  if (room.playback.track) {
    const votes = Object.create(null) as Record<string, -1 | 1>;
    if (object(room.vibe) && room.vibe.trackId === room.playback.track.id && object(room.vibe.votes)) {
      for (const [id, value] of Object.entries(room.vibe.votes)) {
        if (id !== room.djUserId && (value === -1 || value === 1)) votes[id] = value;
      }
    }
    room.vibe = { trackId: room.playback.track.id, votes };
  } else {
    room.vibe = null;
  }
}

function isUsableTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const track = value as Partial<Track>;
  const user = track.addedBy as Partial<User> | undefined;
  return typeof track.id === "string" && track.id.length > 0 &&
    typeof track.title === "string" && typeof track.providerId === "string" &&
    ["youtube", "soundcloud", "spotify", "apple"].includes(track.provider || "") &&
    Boolean(user && typeof user.id === "string" && user.id.length > 0);
}

export function canJoinDjQueue(room: Room, userId: string) {
  return room.settings.djAccess !== "roles" ||
    room.ownerUserId === userId ||
    room.moderatorUserIds.includes(userId) ||
    room.djRoleUserIds.includes(userId);
}

export function removeDj(room: Room, userId: string) {
  room.djQueueUserIds = room.djQueueUserIds.filter((id) => id !== userId);
}

export function archiveCurrentTrack(room: Room) {
  if (!room.playback.track) return;
  room.history.unshift(room.playback.track);
  room.history = room.history.slice(0, 100);
}

/**
 * Ends the current track and finds the next DJ with music.
 *
 * The lineup is a rotating ring. Moving a DJ from the front to the back before
 * consuming a track guarantees one song per turn. Empty queues are skipped for
 * this pass without removing their DJ, so adding music later restores their turn.
 */
export function advanceRadio(room: Room) {
  archiveCurrentTrack(room);

  const turnsToCheck = room.djQueueUserIds.length;
  for (let index = 0; index < turnsToCheck; index += 1) {
    const userId = room.djQueueUserIds.shift()!;
    room.djQueueUserIds.push(userId);
    const queue = room.djQueues[userId] || [];
    const track = queue.shift();
    if (!track) continue;

    room.djUserId = userId;
    room.playback = { track, playing: true, position: 0, updatedAt: Date.now() };
    room.vibe = { trackId: track.id, votes: {} };
    return track;
  }

  room.djUserId = null;
  room.playback = { track: null, playing: false, position: 0, updatedAt: Date.now() };
  room.vibe = null;
  return null;
}

export function privateQueue(room: Room, userId: string): Track[] {
  if (!Object.hasOwn(room.djQueues, userId) || !Array.isArray(room.djQueues[userId])) {
    Object.defineProperty(room.djQueues, userId, { value: [], writable: true, enumerable: true, configurable: true });
  }
  return room.djQueues[userId];
}

/**
 * Converts authoritative server state into one listener's safe room payload.
 * This is the queue-privacy boundary: `djQueues` must never cross it. The
 * snapshot's `queue` field is only the requesting listener's own queue.
 */
export function roomForListener(room: Room, userId: string): SnapshotRoom {
  const { djQueues: _privateQueues, queue: _legacyQueue, ...sharedRoom } = room;
  const queue = Object.hasOwn(room.djQueues, userId) ? room.djQueues[userId] : [];
  return { ...sharedRoom, queue: [...queue] };
}
