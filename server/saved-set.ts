import { serverT } from "./i18n.js";
import { providerJson } from "./provider-http.js";
import { libraryTrackSchema, type LibraryTrack } from "./private-library.js";
import type { Room, Track } from "./types.js";
import type { SpotifyApi } from "./spotify.js";
import type { AppleMusicApi } from "./apple-music.js";
import type { SoundCloudApi } from "./soundcloud.js";
import { MixcloudApi } from "./mixcloud.js";
import { resolveTrackMappings } from "./provider-mappings.js";
import { verifyTrackDuration } from "./track-metadata.js";

export type ResolvedSetTrack = Omit<Track, "id" | "addedBy" | "addedAt" | "playedAt">;
export interface SetImportOutcome { added: number; skipped: Array<{ title: string; reason: string }>; started: boolean }

export function createSavedSetResolver({ spotify, appleMusic, soundCloud, mixcloud, fetchImpl = fetch, youtubeApiKey, allowSpotify = false }: { spotify: SpotifyApi; appleMusic: AppleMusicApi; soundCloud: SoundCloudApi; mixcloud?: Pick<MixcloudApi, "resolveTrack">; fetchImpl?: typeof fetch; youtubeApiKey?:string; allowSpotify?: boolean }) {
  const mixcloudApi = mixcloud || new MixcloudApi(fetchImpl);
  return async (track: LibraryTrack, signal: AbortSignal): Promise<ResolvedSetTrack> => {
    signal.throwIfAborted();
    if (track.provider === "spotify" && !allowSpotify) throw new Error(serverT("spotify_is_disabled_in_this_room"));
    let verified = { ...track };
    if (track.provider === "youtube") {
      const url = `https://www.youtube.com/watch?v=${encodeURIComponent(track.providerId)}`;
      const { response, payload: source } = await providerJson<{ title?: unknown; author_name?: unknown } | null>("youtube",fetchImpl,`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal });
      if (!response.ok) throw new Error(serverT("this_youtube_recording_is_unavailable_or_could_not_be_verified"));
      const safe = libraryTrackSchema.safeParse({ ...verified, title: source?.title, artist: source?.author_name === undefined ? track.artist : source.author_name, permalinkUrl: url });
      if (!safe.success) throw new Error(serverT("this_youtube_recording_returned_invalid_or_oversized_metadata"));
      verified = safe.data;
    } else if (track.provider === "spotify") {
      if (!spotify.configured) throw new Error(serverT("spotify_catalog_verification_is_unavailable_try_this_recording_later"));
      const source = await spotify.getTrack(track.providerId,signal);
      verified = { ...verified, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs };
    } else if (track.provider === "apple") {
      if (!appleMusic.configured) throw new Error(serverT("apple_music_catalog_verification_is_unavailable_try_this_recording_later"));
      const source = await appleMusic.getTrack(track.providerId,undefined,signal);
      verified = { ...verified, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs };
    } else if (track.provider === "mixcloud") {
      const source = await mixcloudApi.resolveTrack(track.permalinkUrl || track.providerId, signal);
      if (source.id !== track.providerId) throw new Error(serverT("this_mixcloud_link_now_resolves_to_a_different_show"));
      verified = { ...verified, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs };
    } else {
      if (!soundCloud.configured || !track.permalinkUrl) throw new Error(serverT("soundcloud_verification_needs_a_configured_catalog_and_a_saved_source_link"));
      const url = new URL(track.permalinkUrl);
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "soundcloud.com" || url.hostname.endsWith(".soundcloud.com"))) throw new Error(serverT("this_saved_soundcloud_source_link_is_invalid"));
      const source = await soundCloud.resolveTrack(url.href,signal);
      if (source.id !== track.providerId) throw new Error(serverT("this_soundcloud_link_now_resolves_to_a_different_recording"));
      verified = { ...verified, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs };
    }
    signal.throwIfAborted();
    const safeSource = libraryTrackSchema.safeParse(verified);
    if (!safeSource.success) throw new Error(serverT("this_recording_returned_invalid_or_oversized_source_metadata"));
    const mappings = await resolveTrackMappings(safeSource.data, spotify, appleMusic,signal,{ allowSpotify });
    signal.throwIfAborted();
    const safeMapped = libraryTrackSchema.safeParse({ ...safeSource.data, ...mappings });
    if (!safeMapped.success) throw new Error(serverT("this_recording_returned_invalid_or_oversized_catalog_metadata"));
    const duration = track.provider === "youtube" ? await verifyTrackDuration(safeMapped.data,{youtubeApiKey,soundCloud,fetcher:fetchImpl,signal}) : {durationMs:verified.durationMs,durationVerified:Boolean(verified.durationMs),isLive:false};
    return { ...mappings, ...safeMapped.data,...duration };
  };
}

/** The supplied resolver must verify source availability before mapping counterparts.
 * Four workers retain original order; every failure/time-budget item is explained.
 * This budget leaves time for the normal 15-second socket acknowledgement. */
export async function resolveSavedSet(tracks: LibraryTrack[], resolve: (track: LibraryTrack, signal: AbortSignal) => Promise<ResolvedSetTrack>, budgetMs = 10_000, maxTracks = 50) {
  if (!Number.isInteger(maxTracks) || maxTracks < 1 || maxTracks > 100) throw new Error(serverT("invalid_set_import_limit"));
  if (!tracks.length || tracks.length > maxTracks) throw new Error(serverT("a_saved_set_must_contain_1_maxtracks_tracks", { maxTracks: maxTracks }));
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
        const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(serverT("this_recording_could_not_be_verified_in_time_try_appending_again"))); }, Math.min(4_000, remaining)); });
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
      if (existing.setId !== setId) throw new Error(serverT("this_import_request_already_belongs_to_a_different_saved_set"));
      return existing.result;
    }
    if (this.entries.size >= 2000) throw new Error(serverT("too_many_set_imports_are_pending_wait_before_trying_again"));
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
