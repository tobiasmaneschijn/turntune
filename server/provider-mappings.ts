import type { AppleMusicApi } from "./apple-music.js";
import { bestCatalogMatch, type CatalogTrack, type ProviderTrackMapping } from "./music.js";
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

function mapping(track: CatalogTrack): ProviderTrackMapping {
  return {
    providerId: track.id,
    permalinkUrl: track.permalinkUrl,
    artworkUrl: track.thumbnail,
    storefront: track.storefront
  };
}

function sourceMapping(track: TrackInput): ProviderTrackMapping {
  return {
    providerId: track.providerId,
    permalinkUrl: track.permalinkUrl,
    artworkUrl: track.artworkUrl
  };
}

export async function resolveTrackMappings(
  input: TrackInput,
  spotify: SpotifyApi,
  appleMusic: AppleMusicApi
): Promise<Pick<Track, "canonicalId" | "isrc" | "mappings"> & Partial<Pick<Track, "title" | "artist" | "artworkUrl" | "permalinkUrl" | "durationMs">>> {
  const mappings: NonNullable<Track["mappings"]> = {
    [input.provider]: sourceMapping(input)
  };
  let source = { ...input };
  let isrc: string | undefined;

  try {
    if (input.provider === "spotify" && spotify.configured) {
      const resolved = await spotify.getTrack(input.providerId);
      source = {
        ...source,
        title: resolved.title,
        artist: resolved.artist,
        artworkUrl: resolved.thumbnail,
        permalinkUrl: resolved.permalinkUrl,
        durationMs: resolved.durationMs
      };
      isrc = resolved.isrc;
      mappings.spotify = mapping(resolved);
    } else if (input.provider === "apple" && appleMusic.configured) {
      const resolved = await appleMusic.getTrack(input.providerId);
      source = {
        ...source,
        title: resolved.title,
        artist: resolved.artist,
        artworkUrl: resolved.thumbnail,
        permalinkUrl: resolved.permalinkUrl,
        durationMs: resolved.durationMs
      };
      isrc = resolved.isrc;
      mappings.apple = mapping(resolved);
    }
  } catch (error) {
    console.warn(`Could not resolve source metadata for ${input.provider}:${input.providerId}`, error);
  }

  const query = [source.artist, source.title].filter(Boolean).join(" ");
  const jobs: Promise<void>[] = [];

  if (!mappings.spotify && spotify.configured) {
    jobs.push((async () => {
      try {
        const result = isrc
          ? await spotify.findByIsrc(isrc)
          : bestCatalogMatch(await spotify.searchTracks(query), source, 0.48);
        if (result) {
          mappings.spotify = mapping(result);
          isrc ||= result.isrc;
        }
      } catch (error) {
        console.warn("Spotify counterpart resolution failed", error);
      }
    })());
  }

  if (!mappings.apple && appleMusic.configured) {
    jobs.push((async () => {
      try {
        const result = isrc
          ? await appleMusic.findByIsrc(isrc)
          : bestCatalogMatch(await appleMusic.searchTracks(query), source, 0.48);
        if (result) {
          mappings.apple = mapping(result);
          isrc ||= result.isrc;
        }
      } catch (error) {
        console.warn("Apple Music counterpart resolution failed", error);
      }
    })());
  }

  await Promise.all(jobs);
  return {
    ...source,
    canonicalId: isrc ? `isrc:${isrc}` : `${input.provider}:${input.providerId}`,
    isrc,
    mappings
  };
}
