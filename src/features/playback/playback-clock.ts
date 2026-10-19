import type { RoomSnapshot } from "../../types";

interface PlaybackCheckpoint {
  roomId: string;
  trackId: string | null;
  playing: boolean;
  position: number;
  serverUpdatedAt: number;
  localUpdatedAt: number;
}

/** Translate server playback timestamps once per checkpoint, without re-seeking on room refreshes. */
export class RoomPlaybackClock {
  private checkpoint: PlaybackCheckpoint | null = null;

  normalize(snapshot: RoomSnapshot, receivedAt = Date.now()): RoomSnapshot {
    const playback = snapshot.room.playback;
    const previous = this.checkpoint;
    const unchanged = previous &&
      previous.roomId === snapshot.room.id &&
      previous.trackId === (playback.track?.id || null) &&
      previous.playing === playback.playing &&
      previous.position === playback.position &&
      previous.serverUpdatedAt === playback.updatedAt;

    // Both timestamps in this difference belong to the server. Using their
    // elapsed time avoids treating a listener's clock offset as playback drift.
    // Keep the first translation when only queue, votes, or presence changed:
    // delivery jitter must not create a new playback command in every adapter.
    const localUpdatedAt = unchanged
      ? previous.localUpdatedAt
      : receivedAt - Math.max(0, snapshot.serverTime - playback.updatedAt);
    this.checkpoint = {
      roomId: snapshot.room.id,
      trackId: playback.track?.id || null,
      playing: playback.playing,
      position: playback.position,
      serverUpdatedAt: playback.updatedAt,
      localUpdatedAt
    };

    return {
      ...snapshot,
      room: { ...snapshot.room, playback: { ...playback, updatedAt: localUpdatedAt } }
    };
  }
}
