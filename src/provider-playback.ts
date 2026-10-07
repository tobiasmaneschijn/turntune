import type { Playback } from "./types";

/** Measured local state. Sending a play command does not confirm playback. */
export interface PlayerStatus {
  ready: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  playing?: boolean;
  trackId?: string;
}

/** Shared room intent and callbacks for every provider adapter. */
export interface ProviderPlaybackProps {
  playback: Playback;
  isDj: boolean;
  volume: number;
  onEnded: () => void;
  onStatus: (status: PlayerStatus) => void;
  /** An empty message clears a previously reported provider error. */
  onError?: (message: string) => void;
}

export interface CheckpointProviderPlaybackProps extends ProviderPlaybackProps {
  syncRevision: number;
}

export type PlaybackSyncIntent = "checkpoint" | "manual" | "health";

export function playbackTargetPosition(playback: Playback, now = Date.now()) {
  return Math.max(0, playback.position +
    (playback.playing ? Math.max(0, now - playback.updatedAt) / 1000 : 0));
}

/** Explicit room seeks and manual Sync take precedence over drift tolerance. */
export function playbackNeedsSeek(observed: number, target: number, intent: PlaybackSyncIntent, tolerance = 2.5) {
  return !Number.isFinite(observed) || Math.abs(observed - target) > (intent === "health" ? tolerance : 0);
}

export interface PlaybackCommandLease {
  current(): boolean;
  enqueue(command: () => Promise<void>): Promise<void>;
  release(stop: () => Promise<void>): Promise<void>;
}

/** Serializes uninterruptible SDK/device operations across adapter mounts. */
export class PlaybackCommandLifecycle {
  private owner: object | null = null;
  private commands: Promise<void> = Promise.resolve();

  get owned() { return this.owner !== null; }

  claim(): PlaybackCommandLease {
    const owner = {};
    this.owner = owner;
    const current = () => this.owner === owner;
    const append = (command: () => Promise<void>) => {
      const result = this.commands.then(command);
      // A failed operation must not block later room commands or cleanup.
      this.commands = result.catch(() => undefined);
      return result;
    };
    return {
      current,
      enqueue: (command) => append(async () => { if (current()) await command(); }),
      release: (stop) => {
        if (!current()) return this.commands;
        this.owner = null;
        return append(async () => {
          // A new adapter can take over the same device while cleanup waits.
          if (!this.owner) await stop();
        });
      }
    };
  }
}
