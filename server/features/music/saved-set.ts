import { serverT } from "../../lib/i18n.js";
import { libraryTrackSchema, type LibraryTrack } from "./private-library.js";
import type { Room, Track } from "../../types.js";
import { resolveProviderMappings } from "./provider-mappings.js";
import { assertProviderAccess, createServerProviderRegistry, type ServerProviderOptions, type ServerProviderRegistry } from "./provider-registry.js";
import { verifyTrackDuration } from "./track-metadata.js";

export type ResolvedSetTrack = Omit<Track, "id" | "addedBy" | "addedAt" | "playedAt">;
export interface SetImportOutcome { added: number; skipped: Array<{ title: string; reason: string }>; started: boolean }

export function createSavedSetResolver(options: ServerProviderOptions & { allowSpotify?: boolean; providers?: ServerProviderRegistry }) {
  const providers = options.providers ?? createServerProviderRegistry(options);
  return async (track: LibraryTrack, signal: AbortSignal): Promise<ResolvedSetTrack> => {
    signal.throwIfAborted();
    assertProviderAccess(track.provider, options.allowSpotify);
    const provider = providers[track.provider];
    if (!provider) throw new Error("This playback provider is unavailable.");
    const source = await provider.resolveSource(track, signal);
    signal.throwIfAborted();
    const safeSource = libraryTrackSchema.safeParse(source.track);
    if (!safeSource.success) throw new Error(serverT("this_recording_returned_invalid_or_oversized_source_metadata"));
    const mappings = await resolveProviderMappings(safeSource.data, providers, signal, { allowSpotify: options.allowSpotify, verifiedSource: { ...source, track: safeSource.data } });
    signal.throwIfAborted();
    const safeMapped = libraryTrackSchema.safeParse({ ...safeSource.data, ...mappings });
    if (!safeMapped.success) throw new Error(serverT("this_recording_returned_invalid_or_oversized_catalog_metadata"));
    const duration = source.duration.durationVerified ? source.duration : await verifyTrackDuration(safeMapped.data, { providers, signal });
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
