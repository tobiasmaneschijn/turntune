import { AVAILABLE_MUSIC_PROVIDERS, PROVIDER_DEFINITIONS } from "../../../shared/provider-definitions.js";
import { providerSignal } from "../../integrations/provider-http.js";
import { telemetry } from "../../observability/index.js";
import type { AppleMusicApi } from "../../integrations/apple-music.js";
import { bestCertainCatalogMatch, type CatalogTrack, type ProviderTrackMapping } from "./music.js";
import type { SpotifyApi } from "../../integrations/spotify/spotify.js";
import type { Track } from "../../types.js";
import { assertProviderAccess, createServerProviderRegistry, type ServerProviderRegistry, type TrackInput, type VerifiedProviderSource } from "./provider-registry.js";

export type { TrackInput } from "./provider-registry.js";
interface MappingOptions { allowSpotify?: boolean; verifiedSource?: VerifiedProviderSource }
type MappingResult = Pick<Track, "canonicalId" | "isrc" | "mappings"> & Partial<Pick<Track, "title" | "artist" | "artworkUrl" | "artworkSources" | "permalinkUrl" | "durationMs" | "durationVerified" | "isLive">>;

function mapping(track: CatalogTrack, matchMethod: NonNullable<ProviderTrackMapping["matchMethod"]>): ProviderTrackMapping {
  return { providerId: track.id, permalinkUrl: track.permalinkUrl, artworkUrl: track.thumbnail, ...(track.artworkSources ? { artworkSources: track.artworkSources } : {}), storefront: track.storefront, matchMethod };
}

function sourceMapping(track: TrackInput): ProviderTrackMapping {
  return { providerId: track.providerId, permalinkUrl: track.permalinkUrl, artworkUrl: track.artworkUrl, ...(track.artworkSources ? { artworkSources: track.artworkSources } : {}), matchMethod: "source" };
}

export async function resolveProviderMappings(input: TrackInput, providers: ServerProviderRegistry, signal?: AbortSignal, options: MappingOptions = {}): Promise<MappingResult> {
  signal = providerSignal(signal);
  signal.throwIfAborted();
  assertProviderAccess(input.provider, options.allowSpotify);
  let source = options.verifiedSource;
  const sourceProvider = providers[input.provider];
  if (!sourceProvider) throw new Error("This playback provider is unavailable.");
  if (!source && sourceProvider.requiresVerifiedSource) source = await sourceProvider.resolveSource(input, signal);
  const mappings: NonNullable<Track["mappings"]> = { [input.provider]: source?.mapping ?? sourceMapping(source?.track ?? input) };
  // Shows do not identify a single recording and cannot acquire song counterparts.
  if (!PROVIDER_DEFINITIONS[input.provider].catalogMatching) {
    return { ...(source?.track ?? input), canonicalId: `${input.provider}:${input.providerId}`, mappings, ...source?.duration };
  }
  try {
    if (!source && sourceProvider.catalog?.configured()) source = await sourceProvider.resolveSource(input, signal);
  } catch (error) {
    signal.throwIfAborted();
    telemetry.captureError(error, { operation: "music.source.resolve", provider: input.provider });
  }
  const track = source?.track ?? input;
  mappings[input.provider] = source?.mapping ?? sourceMapping(track);
  const sourceIsrc = source?.isrc;
  const query = [track.artist, track.title].filter(Boolean).join(" ");
  const counterparts = await Promise.all(AVAILABLE_MUSIC_PROVIDERS.map(async provider => {
    const catalog = providers[provider]?.catalog;
    if (provider === input.provider || !catalog || PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant && !options.allowSpotify || !catalog.configured()) return undefined;
    try {
      const result = sourceIsrc
        ? await catalog.findByIsrc(sourceIsrc, signal)
        : bestCertainCatalogMatch(await catalog.searchTracks(query, signal), track);
      if (!result || sourceIsrc && result.isrc && result.isrc !== sourceIsrc) return undefined;
      return { provider, result };
    } catch (error) {
      signal.throwIfAborted();
      telemetry.captureError(error, { operation: "music.counterpart.resolve", provider });
      return undefined;
    }
  }));
  signal.throwIfAborted();
  const matches = counterparts.filter(match => match !== undefined);
  const candidateIsrcs = new Set(matches.flatMap(match => match.result.isrc ? [match.result.isrc] : []));
  // Conflicting catalog identities are ambiguous. Keep source playback rather
  // than letting whichever response arrived first choose the recording.
  const unambiguous = Boolean(sourceIsrc) || candidateIsrcs.size <= 1;
  const isrc = sourceIsrc ?? (unambiguous ? candidateIsrcs.values().next().value : undefined);
  if (unambiguous) {
    for (const { provider, result } of matches) mappings[provider] = mapping(result, sourceIsrc ? "isrc" : "exact-metadata");
  }
  return { ...track, canonicalId: isrc ? `isrc:${isrc}` : `${input.provider}:${input.providerId}`, isrc, mappings, ...(source?.duration ?? { durationVerified: false, isLive: false }) };
}

/** Compatibility entry point for callers that supply the two existing catalogs. */
export function resolveTrackMappings(input: TrackInput, spotify: SpotifyApi, appleMusic: AppleMusicApi, signal?: AbortSignal, options: MappingOptions = {}): Promise<MappingResult> {
  return resolveProviderMappings(input, createServerProviderRegistry({ spotify, appleMusic }), signal, options);
}
