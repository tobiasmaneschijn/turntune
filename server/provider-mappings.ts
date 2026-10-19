import { serverT } from "./i18n.js";
import { providerSignal } from "./provider-http.js";
import type { AppleMusicApi } from "./apple-music.js";
import { bestCertainCatalogMatch, type CatalogTrack, type ProviderTrackMapping } from "./music.js";
import type { SpotifyApi } from "./spotify.js";
import type { Provider, Track } from "./types.js";

export interface TrackInput {
  provider: Provider;
  providerId: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  permalinkUrl?: string;
  durationMs?: number;
}

function mapping(
  track: CatalogTrack,
  matchMethod: NonNullable<ProviderTrackMapping["matchMethod"]>
): ProviderTrackMapping {
  return {
    providerId: track.id,
    permalinkUrl: track.permalinkUrl,
    artworkUrl: track.thumbnail,
    storefront: track.storefront,
    matchMethod
  };
}

function sourceMapping(track: TrackInput): ProviderTrackMapping {
  return {
    providerId: track.providerId,
    permalinkUrl: track.permalinkUrl,
    artworkUrl: track.artworkUrl,
    matchMethod: "source"
  };
}

export async function resolveTrackMappings(
  input: TrackInput,
  spotify: SpotifyApi,
  appleMusic: AppleMusicApi,
  signal?: AbortSignal,
  options: { allowSpotify?: boolean } = {}
): Promise<Pick<Track, "canonicalId" | "isrc" | "mappings"> & Partial<Pick<Track, "title" | "artist" | "artworkUrl" | "permalinkUrl" | "durationMs" | "durationVerified" | "isLive">>> {
  signal = providerSignal(signal);
  signal.throwIfAborted();
  if (input.provider === "spotify" && options.allowSpotify !== true) throw new Error(serverT("spotify_is_disabled_in_this_room"));
  const mappings: NonNullable<Track["mappings"]> = {
    [input.provider]: sourceMapping(input)
  };
  // A Mixcloud show can contain many recordings; song catalog matches are invalid.
  if (input.provider === "mixcloud") return { ...input, canonicalId: `mixcloud:${input.providerId}`, mappings };
  let source = { ...input };
  let isrc: string | undefined;
  let durationVerified = false;

  try {
    if (input.provider === "spotify" && spotify.configured) {
      const resolved = await spotify.getTrack(input.providerId, signal);
      source = {
        ...source,
        title: resolved.title,
        artist: resolved.artist,
        artworkUrl: resolved.thumbnail,
        permalinkUrl: resolved.permalinkUrl,
        durationMs: resolved.durationMs
      };
      isrc = resolved.isrc;
      durationVerified = Boolean(resolved.durationMs);
      mappings.spotify = mapping(resolved, "source");
    } else if (input.provider === "apple" && appleMusic.configured) {
      const resolved = await appleMusic.getTrack(input.providerId, undefined, signal);
      source = {
        ...source,
        title: resolved.title,
        artist: resolved.artist,
        artworkUrl: resolved.thumbnail,
        permalinkUrl: resolved.permalinkUrl,
        durationMs: resolved.durationMs
      };
      isrc = resolved.isrc;
      durationVerified = Boolean(resolved.durationMs);
      mappings.apple = mapping(resolved, "source");
    }
  } catch (error) {
    signal?.throwIfAborted();
    console.warn("Could not resolve source metadata.");
  }

  const query = [source.artist, source.title].filter(Boolean).join(" ");
  const jobs: Promise<void>[] = [];

  if (options.allowSpotify === true && !mappings.spotify && spotify.configured) {
    jobs.push((async () => {
      try {
        const matchedByIsrc = Boolean(isrc);
        const result = matchedByIsrc
          ? await spotify.findByIsrc(isrc!, signal)
          : bestCertainCatalogMatch(await spotify.searchTracks(query, undefined, signal), source);
        if (result) {
          mappings.spotify = mapping(result, matchedByIsrc ? "isrc" : "exact-metadata");
          isrc ||= result.isrc;
        }
      } catch (error) {
        signal?.throwIfAborted();
        console.warn("Spotify counterpart resolution failed.");
      }
    })());
  }

  if (!mappings.apple && appleMusic.configured) {
    jobs.push((async () => {
      try {
        const matchedByIsrc = Boolean(isrc);
        const result = matchedByIsrc
          ? await appleMusic.findByIsrc(isrc!, undefined, signal)
          : bestCertainCatalogMatch(await appleMusic.searchTracks(query, undefined, undefined, signal), source);
        if (result) {
          mappings.apple = mapping(result, matchedByIsrc ? "isrc" : "exact-metadata");
          isrc ||= result.isrc;
        }
      } catch (error) {
        signal?.throwIfAborted();
        console.warn("Apple Music counterpart resolution failed.");
      }
    })());
  }

  await Promise.all(jobs);
  signal?.throwIfAborted();
  return {
    ...source,
    canonicalId: isrc ? `isrc:${isrc}` : `${input.provider}:${input.providerId}`,
    isrc,
    mappings
    ,durationVerified,isLive:false
  };
}
