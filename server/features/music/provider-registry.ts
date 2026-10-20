import { PROVIDER_DEFINITIONS, type Provider } from "../../../shared/provider-definitions.js";
import type { ProviderTrackMapping, Track } from "../../types.js";
import { serverT } from "../../lib/i18n.js";
import { providerJson } from "../../integrations/provider-http.js";
import type { SpotifyApi } from "../../integrations/spotify/spotify.js";
import type { AppleMusicApi } from "../../integrations/apple-music.js";
import type { SoundCloudApi } from "../../integrations/soundcloud.js";
import { MixcloudApi } from "../../integrations/mixcloud.js";
import type { CatalogTrack } from "./music.js";

export interface TrackInput {
  provider: Provider;
  providerId: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  permalinkUrl?: string;
  durationMs?: number;
}

export type VerifiedDuration = Pick<Track, "durationVerified" | "isLive"> & Partial<Pick<Track, "durationMs">>;
export interface VerifiedProviderSource {
  track: TrackInput;
  isrc?: string;
  mapping?: ProviderTrackMapping;
  duration: VerifiedDuration;
}

export interface ServerMusicProvider {
  resolveSource: (input: TrackInput, signal: AbortSignal) => Promise<VerifiedProviderSource>;
  verifyDuration?: (input: TrackInput, signal: AbortSignal) => Promise<VerifiedDuration>;
  catalog?: {
    configured: () => boolean;
    findByIsrc: (isrc: string, signal: AbortSignal) => Promise<CatalogTrack | undefined>;
    searchTracks: (query: string, signal: AbortSignal) => Promise<CatalogTrack[]>;
  };
}

export type ServerProviderRegistry = Record<Provider, ServerMusicProvider>;
export interface ServerProviderOptions {
  spotify?: Pick<SpotifyApi, "configured" | "getTrack" | "findByIsrc" | "searchTracks">;
  appleMusic?: Pick<AppleMusicApi, "configured" | "getTrack" | "findByIsrc" | "searchTracks">;
  soundCloud?: Pick<SoundCloudApi, "configured" | "resolveTrack">;
  mixcloud?: Pick<MixcloudApi, "resolveTrack">;
  youtubeApiKey?: string;
  fetchImpl?: typeof fetch;
}

function verifiedSource(input: TrackInput, source: Omit<CatalogTrack, "provider">): VerifiedProviderSource {
  return {
    track: { ...input, title: source.title, artist: source.artist, artworkUrl: source.thumbnail, permalinkUrl: source.permalinkUrl, durationMs: source.durationMs },
    isrc: source.isrc,
    mapping: { providerId: source.id, permalinkUrl: source.permalinkUrl, artworkUrl: source.thumbnail, storefront: source.storefront, matchMethod: "source" },
    duration: { durationMs: source.durationMs, durationVerified: Boolean(source.durationMs), isLive: false }
  };
}

export function parseIsoDuration(value: string): number | undefined {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) return;
  const ms = (Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)) * 1000;
  return ms > 0 && ms <= 86_400_000 ? ms : undefined;
}

/** SDK credentials and provider-specific source rules stay behind this registry. */
export function createServerProviderRegistry(options: ServerProviderOptions = {}): ServerProviderRegistry {
  const { spotify, appleMusic, soundCloud, youtubeApiKey } = options;
  const fetcher = options.fetchImpl ?? fetch;
  const mixcloud = options.mixcloud ?? new MixcloudApi(fetcher);
  const youtubeDuration = async (input: TrackInput, signal: AbortSignal): Promise<VerifiedDuration> => {
    if (!youtubeApiKey || !/^[A-Za-z0-9_-]{11}$/.test(input.providerId)) return { durationVerified: false };
    const params = new URLSearchParams({ part: "contentDetails,liveStreamingDetails", id: input.providerId, key: youtubeApiKey });
    const { response, payload } = await providerJson<{ items?: Array<{ id: string; contentDetails?: { duration?: string }; liveStreamingDetails?: { actualEndTime?: string } }> }>(
      "youtube", fetcher, `https://www.googleapis.com/youtube/v3/videos?${params}`, { signal }, { timeoutMs: 4_000 });
    if (!response.ok) return { durationVerified: false };
    const video = payload.items?.find(item => item.id === input.providerId);
    if (!video) return { durationVerified: false };
    const isLive = Boolean(video.liveStreamingDetails && !video.liveStreamingDetails.actualEndTime);
    const durationMs = parseIsoDuration(video.contentDetails?.duration ?? "");
    return { durationMs, durationVerified: Boolean(durationMs && !isLive), isLive };
  };
  const resolveSoundCloud = async (input: TrackInput, signal: AbortSignal) => {
    if (!soundCloud?.configured || !input.permalinkUrl) throw new Error(serverT("soundcloud_verification_needs_a_configured_catalog_and_a_saved_source_link"));
    const url = new URL(input.permalinkUrl);
    if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "soundcloud.com" || url.hostname.endsWith(".soundcloud.com"))) {
      throw new Error(serverT("this_saved_soundcloud_source_link_is_invalid"));
    }
    const source = await soundCloud.resolveTrack(url.href, signal);
    if (source.id !== input.providerId) throw new Error(serverT("this_soundcloud_link_now_resolves_to_a_different_recording"));
    return verifiedSource(input, source);
  };
  const resolveMixcloud = async (input: TrackInput, signal: AbortSignal) => {
    const source = await mixcloud.resolveTrack(input.permalinkUrl || input.providerId, signal);
    if (source.id !== input.providerId) throw new Error(serverT("this_mixcloud_link_now_resolves_to_a_different_show"));
    return verifiedSource(input, source);
  };
  return {
    youtube: {
      resolveSource: async (input, signal) => {
        const url = `https://www.youtube.com/watch?v=${encodeURIComponent(input.providerId)}`;
        const { response, payload } = await providerJson<{ title?: unknown; author_name?: unknown } | null>(
          "youtube", fetcher, `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal });
        if (!response.ok) throw new Error(serverT("this_youtube_recording_is_unavailable_or_could_not_be_verified"));
        if (typeof payload?.title !== "string" || !payload.title.trim() || payload.title.trim().length > 120 ||
          payload.author_name !== undefined && (typeof payload.author_name !== "string" || !payload.author_name.trim() || payload.author_name.trim().length > 120)) {
          throw new Error(serverT("this_youtube_recording_returned_invalid_or_oversized_metadata"));
        }
        return { track: { ...input, title: payload.title, artist: payload.author_name === undefined ? input.artist : payload.author_name as string, permalinkUrl: url }, duration: { durationVerified: false } };
      },
      verifyDuration: youtubeDuration
    },
    soundcloud: { resolveSource: resolveSoundCloud, verifyDuration: async (input, signal) => (await resolveSoundCloud(input, signal)).duration },
    mixcloud: { resolveSource: resolveMixcloud, verifyDuration: async (input, signal) => (await resolveMixcloud(input, signal)).duration },
    spotify: {
      resolveSource: async (input, signal) => {
        if (!spotify?.configured) throw new Error(serverT("spotify_catalog_verification_is_unavailable_try_this_recording_later"));
        return verifiedSource(input, await spotify.getTrack(input.providerId, signal));
      },
      catalog: {
        configured: () => Boolean(spotify?.configured),
        findByIsrc: (isrc, signal) => spotify!.findByIsrc(isrc, signal),
        searchTracks: (query, signal) => spotify!.searchTracks(query, undefined, signal)
      }
    },
    apple: {
      resolveSource: async (input, signal) => {
        if (!appleMusic?.configured) throw new Error(serverT("apple_music_catalog_verification_is_unavailable_try_this_recording_later"));
        return verifiedSource(input, await appleMusic.getTrack(input.providerId, undefined, signal));
      },
      catalog: {
        configured: () => Boolean(appleMusic?.configured),
        findByIsrc: (isrc, signal) => appleMusic!.findByIsrc(isrc, undefined, signal),
        searchTracks: (query, signal) => appleMusic!.searchTracks(query, undefined, undefined, signal)
      }
    }
  };
}

export function assertProviderAccess(provider: Provider, allowSpotify = false) {
  if (PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant && !allowSpotify) throw new Error(serverT("spotify_is_disabled_in_this_room"));
}
