import type { Room, SnapshotRoom, Track } from "./types.js";

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
}

/**
 * Repairs persisted room state at the server boundary.
 *
 * Room JSON can outlive several application versions. Keep compatibility and
 * de-duplication here instead of spreading defensive checks across handlers.
 */
export function normalizeRadioState(room: Room) {
  room.settings ||= {};
  room.settings.djAccess = room.settings.djAccess === "roles" ? "roles" : "everyone";
  room.djRoleUserIds = [...new Set(room.djRoleUserIds || [])];
  room.djQueueUserIds = [...new Set(room.djQueueUserIds || [])];
  room.djQueues ||= {};

  // Move rooms created before the round-robin flow into private per-user queues.
  if (room.queue?.length) {
    for (const track of room.queue) {
      const userId = track.addedBy.id;
      room.djQueues[userId] ||= [];
      room.djQueues[userId].push(track);
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
  room.djQueues[userId] ||= [];
  return room.djQueues[userId];
}

/**
 * Converts authoritative server state into one listener's safe room payload.
 * This is the queue-privacy boundary: `djQueues` must never cross it. The
 * snapshot's `queue` field is only the requesting listener's own queue.
 */
export function roomForListener(room: Room, userId: string): SnapshotRoom {
  const { djQueues: _privateQueues, queue: _legacyQueue, ...sharedRoom } = room;
  return { ...sharedRoom, queue: [...privateQueue(room, userId)] };
}
