import type { Playback, ProviderTrackMapping } from "./types";

export interface SpotifyPlaybackObservation {
  uri: string;
  paused: boolean;
  positionMs: number;
}

export type SpotifySyncAction =
  | { action: "play"; spotifyUri: string; positionMs: number }
  | { action: "seek"; positionMs: number }
  | { action: "pause" | "resume" };

export function spotifyPlaybackSignature(playback: Playback, mapping: ProviderTrackMapping | undefined, deviceId: string) {
  return `${playback.track?.id || "empty"}:${mapping?.providerId || "unmapped"}:${playback.playing}:${playback.position}:${playback.updatedAt}:${deviceId}`;
}

export function spotifyTargetPositionMs(playback: Playback, now = Date.now()) {
  return Math.max(0, Math.floor((playback.position +
    (playback.playing ? Math.max(0, now - playback.updatedAt) / 1000 : 0)) * 1000));
}

/** Reading a healthy player must never interrupt it. Only load a new recording
 * when necessary; seek/resume the existing recording for all other corrections. */
export function spotifySyncActions(playback: Playback, spotifyUri: string, state: SpotifyPlaybackObservation | null,
  force = false, now = Date.now(), toleranceMs = playback.playing ? 2_000 : 250): SpotifySyncAction[] {
  if (!playback.track || !spotifyUri) return state?.paused ? [] : [{ action: "pause" }];
  const positionMs = spotifyTargetPositionMs(playback, now);
  if (!state || state.uri !== spotifyUri) {
    // Spotify has no load-without-playing command. Keep a paused room silent;
    // its recording will be loaded at the checkpoint when the room resumes.
    return playback.playing ? [{ action: "play", spotifyUri, positionMs }] : state?.paused ? [] : [{ action: "pause" }];
  }
  const actions: SpotifySyncAction[] = [];
  const seek = force || !Number.isFinite(state.positionMs) || Math.abs(state.positionMs - positionMs) > toleranceMs;
  if (!playback.playing && !state.paused) actions.push({ action: "pause" });
  if (seek) actions.push({ action: "seek", positionMs });
  if (playback.playing && state.paused) actions.push({ action: "resume" });
  return actions;
}
