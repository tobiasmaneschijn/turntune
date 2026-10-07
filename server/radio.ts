import { randomUUID } from "node:crypto";
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
  if (typeof room.settings.themePrompt === "string" && room.settings.themePrompt.trim().length <= 160 && room.settings.themePrompt.trim()) {
    room.settings.themePrompt = room.settings.themePrompt.trim();
  } else delete room.settings.themePrompt;
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
export function advanceRadio(room: Room, now = Date.now()) {
  archiveCurrentTrack(room);

  const turnsToCheck = room.djQueueUserIds.length;
  for (let index = 0; index < turnsToCheck; index += 1) {
    const userId = room.djQueueUserIds.shift()!;
    room.djQueueUserIds.push(userId);
    const queue = room.djQueues[userId] || [];
    const track = queue.shift();
    if (!track) continue;

    track.playedAt = now;

    room.djUserId = userId;
    room.playback = { track, playing: true, position: 0, updatedAt: now };
    room.vibe = { trackId: track.id, votes: {} };
    return track;
  }

  room.djUserId = null;
  room.playback = { track: null, playing: false, position: 0, updatedAt: now };
  room.vibe = null;
  return null;
}

export function privateQueue(room: Room, userId: string): Track[] {
  if (!Object.hasOwn(room.djQueues, userId) || !Array.isArray(room.djQueues[userId])) {
    Object.defineProperty(room.djQueues, userId, { value: [], writable: true, enumerable: true, configurable: true });
  }
  return room.djQueues[userId];
}

export interface QueueUndoReceipt { token: string; expiresAt: number; title: string }
export interface QueueRollbackResult {
  status: "rolled-back" | "superseded" | "committed";
  changed: boolean;
  undoAvailable: boolean;
}
interface QueueUndoEntry {
  room: Room; userId: string; track: Track; before?: string; after?: string; expiresAt: number;
  phase: "removing" | "removed" | "restoring";
}

function insertAtSurvivingAnchor(queue: Track[], track: Track, entry: Pick<QueueUndoEntry, "before" | "after">) {
  const after = queue.findIndex((item) => item.id === entry.after);
  const before = queue.findIndex((item) => item.id === entry.before);
  const index = after >= 0 ? after : before >= 0 ? before + 1 : queue.length;
  queue.splice(index, 0, track);
  return index + 1;
}

/** Ephemeral receipts stay outside persisted/shared room JSON and are single-use. */
export class QueueUndoRegistry {
  private entries = new Map<string, QueueUndoEntry>();
  constructor(private readonly durationMs = 15_000) {}

  remove(room: Room, userId: string, trackId: string, now = Date.now()): QueueUndoReceipt {
    const transaction = this.beginRemove(room, userId, trackId, now);
    transaction.commit();
    return transaction.receipt;
  }

  beginRemove(room: Room, userId: string, trackId: string, now = Date.now(), draft = room) {
    const queue = privateQueue(draft, userId);
    const index = queue.findIndex((track) => track.id === trackId);
    if (index < 0) throw new Error("That waiting track is no longer in your queue.");
    for (const [token, entry] of this.entries) if (entry.expiresAt <= now || (entry.room === room && entry.userId === userId)) this.entries.delete(token);
    const token = randomUUID();
    const track = queue[index];
    const expiresAt = now + this.durationMs;
    const entry: QueueUndoEntry = { room, userId, track: structuredClone(track), before: queue[index - 1]?.id, after: queue[index + 1]?.id, expiresAt, phase: "removing" };
    this.entries.set(token, entry);
    queue.splice(index, 1);
    let settled: QueueRollbackResult | undefined;
    return {
      receipt: { token, expiresAt, title: track.title },
      commit: () => {
        if (settled) return;
        if (this.entries.get(token) === entry) entry.phase = "removed";
        settled = { status: "committed", changed: false, undoAvailable: this.entries.get(token) === entry };
      },
      rollback: (): QueueRollbackResult => {
        if (settled) return settled;
        if (this.entries.get(token) === entry) this.entries.delete(token);
        const current = privateQueue(draft, userId);
        const same = (item: Track) => item.id === track.id || sameRecording(item, track);
        // A save can yield while another tab re-adds, reorders, or advances.
        // Restore only this removal; never overwrite its current queue/turn.
        if ((draft.playback.track && same(draft.playback.track)) || draft.history.some((item) => item.id === track.id) || current.some(same)) {
          return settled = { status: "superseded", changed: false, undoAvailable: false };
        }
        insertAtSurvivingAnchor(current, track, entry);
        return settled = { status: "rolled-back", changed: true, undoAvailable: false };
      },
    };
  }

  restore(room: Room, userId: string, token: string, now = Date.now()) {
    const transaction = this.beginRestore(room, userId, token, now);
    transaction.commit();
    return transaction.result;
  }

  beginRestore(room: Room, userId: string, token: string, now = Date.now(), draft = room) {
    const entry = this.entries.get(token);
    if (!entry || entry.expiresAt <= now) {
      if (entry?.expiresAt && entry.expiresAt <= now) this.entries.delete(token);
      throw new Error("Undo expired. You can add the track again from your saved picks or search.");
    }
    if (entry.room !== room || entry.userId !== userId) throw new Error("This Undo belongs to a different room or account.");
    if (entry.phase !== "removed") throw new Error("This queue change is still being saved. Wait before trying Undo again.");
    if (!canJoinDjQueue(draft, userId) || !draft.djQueueUserIds.includes(userId)) throw new Error("Join the DJ lineup with permission before restoring this track.");
    const queue = privateQueue(draft, userId);
    const same = (track: Track) => track.id === entry.track.id || sameRecording(track, entry.track);
    if ((draft.playback.track && same(draft.playback.track)) || queue.some(same)) throw new Error("That recording is already playing or waiting in your queue.");
    if (draft.history.some((track) => track.id === entry.track.id)) throw new Error("That queue item has already played and cannot be restored.");
    // Stable surviving neighbors preserve current edits; no old numeric index.
    entry.phase = "restoring";
    const position = insertAtSurvivingAnchor(queue, entry.track, entry);
    // Quiet-room Undo restores a waiting item without selecting a DJ or starting audio.
    let settled: QueueRollbackResult | undefined;
    return {
      result: { track: entry.track, position },
      commit: () => {
        if (settled) return;
        if (this.entries.get(token) === entry) this.entries.delete(token);
        settled = { status: "committed", changed: false, undoAvailable: false };
      },
      rollback: (rollbackNow = Date.now()): QueueRollbackResult => {
        if (settled) return settled;
        const current = privateQueue(draft, userId);
        const index = current.indexOf(entry.track);
        if (index < 0 || draft.playback.track?.id === entry.track.id || draft.history.some((track) => track.id === entry.track.id)) {
          if (this.entries.get(token) === entry) this.entries.delete(token);
          return settled = { status: "superseded", changed: false, undoAvailable: false };
        }
        // Object identity ensures a newer replacement/removal is never undone.
        current.splice(index, 1);
        const undoAvailable = this.entries.get(token) === entry && entry.expiresAt > rollbackNow;
        if (undoAvailable) entry.phase = "removed";
        else if (this.entries.get(token) === entry) this.entries.delete(token);
        return settled = { status: "rolled-back", changed: true, undoAvailable };
      },
    };
  }

  revoke(token: string) { this.entries.delete(token); }
  releaseRoom(roomId: string) { for (const [token, entry] of this.entries) if (entry.room.id === roomId) this.entries.delete(token); }
}

export function sameRecording(first: Pick<Track, "provider" | "providerId" | "canonicalId">, second: Pick<Track, "provider" | "providerId" | "canonicalId">) {
  return (first.provider === second.provider && first.providerId === second.providerId) || Boolean(first.canonicalId && first.canonicalId === second.canonicalId);
}

/** Role/settings changes update lineup and playback in the same durable command. */
export function pruneUnauthorizedDjs(room: Room) {
  if (room.settings.djAccess !== "roles") return;
  const previousDj = room.djUserId;
  room.djQueueUserIds = room.djQueueUserIds.filter(id => canJoinDjQueue(room, id));
  if (previousDj && !room.djQueueUserIds.includes(previousDj)) advanceRadio(room);
}

/** Append a pre-resolved set in order and report every skipped item. */
export function appendQueueSet(room: Room, user: User, inputs: Array<Omit<Track, "id" | "addedBy" | "addedAt" | "playedAt">>, now = Date.now()) {
  if (!canJoinDjQueue(room, user.id) || !room.djQueueUserIds.includes(user.id)) throw new Error("Join the DJ lineup with permission before adding a set.");
  if (inputs.length === 0 || inputs.length > 50) throw new Error("A set must contain between 1 and 50 tracks.");
  const queue = privateQueue(room, user.id);
  const skipped: Array<{ title: string; reason: string }> = [];
  let added = 0;
  for (const input of inputs) {
    if ((room.playback.track && sameRecording(room.playback.track, input)) || queue.some((track) => sameRecording(track, input))) {
      skipped.push({ title: input.title, reason: "Already playing or in your queue" });
      continue;
    }
    queue.push({ ...input, id: randomUUID(), addedBy: user, addedAt: now });
    added++;
  }
  const started = added > 0 && !room.playback.track;
  if (started) advanceRadio(room, now);
  return { added, skipped, started };
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
