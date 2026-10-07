import { libraryTrackSchema, type LibraryTrack } from "./private-library.js";
import type { Room, Track } from "./types.js";
import type { SpotifyApi } from "./spotify.js";
import type { AppleMusicApi } from "./apple-music.js";
import type { SoundCloudApi } from "./soundcloud.js";
import { resolveTrackMappings } from "./provider-mappings.js";

export type ResolvedSetTrack = Omit<Track, "id" | "addedBy" | "addedAt" | "playedAt">;
export interface SetImportOutcome { added: number; skipped: Array<{ title: string; reason: string }>; started: boolean }

export function createSavedSetResolver({ spotify, appleMusic, soundCloud, fetchImpl = fetch }: { spotify: SpotifyApi; appleMusic: AppleMusicApi; soundCloud: SoundCloudApi; fetchImpl?: typeof fetch }) {
  return async (track: LibraryTrack, signal: AbortSignal): Promise<ResolvedSetTrack> => {
    signal.throwIfAborted();
    let verified = { ...track };
    if (track.provider === "youtube") {
      const url = `https://www.youtube.com/watch?v=${encodeURIComponent(track.providerId)}`;
      const response = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal });
      if (!response.ok) throw new Error("This YouTube recording is unavailable or could not be verified.");
      const source = await response.json() as { title?: unknown; author_name?: unknown } | null;
      const safe = libraryTrackSchema.safeParse({ ...verified, title: source?.title, artist: source?.author_name === undefined ? track.artist : source.author_name, permalinkUrl: url });
      if (!safe.success) throw new Error("This YouTube recording returned invalid or oversized metadata and was skipped.");
      verified = safe.data;
    } else if (track.provider === "spotify") {
      if (!spotify.configured) throw new Error("Spotify catalog verification is unavailable. Try this recording later.");
      const source = await spotify.getTrack(track.providerId);
      verified = { ...verified, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs };
    } else if (track.provider === "apple") {
      if (!appleMusic.configured) throw new Error("Apple Music catalog verification is unavailable. Try this recording later.");
      const source = await appleMusic.getTrack(track.providerId);
      verified = { ...verified, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs };
    } else {
      if (!soundCloud.configured || !track.permalinkUrl) throw new Error("SoundCloud verification needs a configured catalog and a saved source link.");
      const url = new URL(track.permalinkUrl);
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "soundcloud.com" || url.hostname.endsWith(".soundcloud.com"))) throw new Error("This saved SoundCloud source link is invalid.");
      const source = await soundCloud.resolveTrack(url.href);
      if (source.id !== track.providerId) throw new Error("This SoundCloud link now resolves to a different recording.");
      verified = { ...verified, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs };
    }
    signal.throwIfAborted();
    const safeSource = libraryTrackSchema.safeParse(verified);
    if (!safeSource.success) throw new Error("This recording returned invalid or oversized source metadata and was skipped.");
    const mappings = await resolveTrackMappings(safeSource.data, spotify, appleMusic);
    signal.throwIfAborted();
    const safeMapped = libraryTrackSchema.safeParse({ ...safeSource.data, ...mappings });
    if (!safeMapped.success) throw new Error("This recording returned invalid or oversized catalog metadata and was skipped.");
    return { ...mappings, ...safeMapped.data };
  };
}

/** The supplied resolver must verify source availability before mapping counterparts.
 * Four workers retain original order; every failure/time-budget item is explained.
 * This budget leaves time for the normal 15-second socket acknowledgement. */
export async function resolveSavedSet(tracks: LibraryTrack[], resolve: (track: LibraryTrack, signal: AbortSignal) => Promise<ResolvedSetTrack>, budgetMs = 10_000) {
  if (!tracks.length || tracks.length > 50) throw new Error("A saved set must contain 1–50 tracks.");
  const deadline = Date.now() + budgetMs;
  const results: Array<{ track: ResolvedSetTrack } | { title: string; reason: string }> = [];
  let next = 0;
  const worker = async () => {
    while (next < tracks.length) {
      const index = next++; const input = tracks[index];
      const remaining = deadline - Date.now();
      if (remaining <= 0) { results[index] = { title: input.title, reason: "Verification took too long. Append the set again to retry missing tracks." }; continue; }
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("This recording could not be verified in time. Try appending again.")); }, Math.min(4_000, remaining)); });
        results[index] = { track: await Promise.race([resolve(input, controller.signal), timeout]) };
      } catch (error) { results[index] = { title: input.title, reason: error instanceof Error ? error.message : "This recording is unavailable on its source provider." }; }
      finally { if (timer) clearTimeout(timer); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tracks.length) }, worker));
  return { tracks: results.flatMap((result) => "track" in result ? [result.track] : []), skipped: results.flatMap((result) => "track" in result ? [] : [result]) };
}

/** Coalesces concurrent/retried import UUIDs; neither another room nor owner shares results. */
export class SetImportRegistry {
  private entries = new Map<string, { room: Room; userId: string; setId: string; expiresAt: number; result: Promise<SetImportOutcome> }>();
  constructor(private readonly ttlMs = 10 * 60_000) {}
  releaseRoom(roomId: string) { for (const [key, entry] of this.entries) if (entry.room.id === roomId) this.entries.delete(key); }
  run(room: Room, userId: string, requestId: string, setId: string, operation: (markCommitted: (outcome: SetImportOutcome) => void) => Promise<SetImportOutcome>, now = Date.now()) {
    for (const [key, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(key);
    const key = `${room.id}:${userId}:${requestId}`;
    const existing = this.entries.get(key);
    if (existing?.room === room && existing.userId === userId) {
      if (existing.setId !== setId) throw new Error("This import request already belongs to a different saved set.");
      return existing.result;
    }
    if (this.entries.size >= 2000) throw new Error("Too many set imports are pending. Wait before trying again.");
    let committed: SetImportOutcome | undefined;
    const result = Promise.resolve().then(() => operation((outcome) => {
      committed = structuredClone(outcome);
      const entry = this.entries.get(key);
      if (entry) { entry.result = Promise.resolve(committed); entry.expiresAt = Date.now() + this.ttlMs; }
    }));
    this.entries.set(key, { room, userId, setId, expiresAt: Infinity, result });
    // A failure before append may be retried. Successful authoritative outcomes
    // remain memoized even if a disconnected browser never received its ACK.
    void result.then((outcome) => {
      const entry = this.entries.get(key);
      if (entry) { entry.result = Promise.resolve(structuredClone(outcome)); entry.expiresAt = Date.now() + this.ttlMs; }
    }, () => { if (!committed && this.entries.get(key)?.result === result) this.entries.delete(key); });
    return result;
  }
}
