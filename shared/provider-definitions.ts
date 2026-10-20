import { isMixcloudShowKey, mixcloudShowKey } from "./mixcloud.js";

export const MUSIC_PROVIDERS = ["youtube", "soundcloud", "spotify", "apple", "mixcloud"] as const;
export type Provider = (typeof MUSIC_PROVIDERS)[number];

export interface ProviderTrackLocator {
  providerId: string;
  permalinkUrl?: string;
}

export interface ProviderLocatorIssue {
  path: "providerId" | "permalinkUrl";
  messageKey: string;
}

type LocatorContext = "queue" | "library";

export interface ProviderDefinition {
  label: string;
  supportsLocalVolume: boolean;
  supportsLive: boolean;
  catalogMatching: boolean;
  personalSession: boolean;
  requiresSpotifyGrant: boolean;
  counterpartMatchMethods: readonly ("source" | "isrc" | "exact-metadata" | "fuzzy")[] | null;
  defaultPlaybackMode: string;
  locator: {
    validId: (providerId: string) => boolean;
    invalidIdMessage: string;
    permalinkIssues?: (track: ProviderTrackLocator, context: LocatorContext) => ProviderLocatorIssue[];
  };
}

function soundcloudPermalinkIssues(track: ProviderTrackLocator, context: LocatorContext): ProviderLocatorIssue[] {
  // Saved library metadata historically permits an absent or external permalink.
  if (context === "library") return [];
  if (!track.permalinkUrl) return [{ path: "permalinkUrl", messageKey: "a_soundcloud_permalink_is_required" }];
  try {
    const hostname = new URL(track.permalinkUrl).hostname.toLowerCase();
    if (hostname === "soundcloud.com" || hostname.endsWith(".soundcloud.com")) return [];
  } catch { /* The caller also validates URL syntax. */ }
  return [{ path: "permalinkUrl", messageKey: "invalid_soundcloud_permalink" }];
}

function mixcloudPermalinkIssues(track: ProviderTrackLocator): ProviderLocatorIssue[] {
  return track.permalinkUrl && mixcloudShowKey(track.permalinkUrl) === track.providerId
    ? [] : [{ path: "permalinkUrl", messageKey: "a_matching_mixcloud_show_url_is_required" }];
}

export const PROVIDER_DEFINITIONS = {
  youtube: {
    label: "YouTube", supportsLocalVolume: true, supportsLive: true, defaultPlaybackMode: "default",
    catalogMatching: true, personalSession: false, requiresSpotifyGrant: false, counterpartMatchMethods: null,
    locator: { validId: (value: string) => /^[\w-]{11}$/.test(value), invalidIdMessage: "invalid_youtube_video_id" }
  },
  soundcloud: {
    label: "SoundCloud", supportsLocalVolume: true, supportsLive: false, defaultPlaybackMode: "default",
    catalogMatching: true, personalSession: false, requiresSpotifyGrant: false, counterpartMatchMethods: null,
    locator: {
      validId: (value: string) => /^soundcloud:tracks:\d+$/.test(value), invalidIdMessage: "invalid_soundcloud_track_urn",
      permalinkIssues: soundcloudPermalinkIssues
    }
  },
  spotify: {
    label: "Spotify", supportsLocalVolume: true, supportsLive: false, defaultPlaybackMode: "web",
    catalogMatching: true, personalSession: true, requiresSpotifyGrant: true, counterpartMatchMethods: ["isrc", "exact-metadata"],
    locator: { validId: (value: string) => /^[A-Za-z0-9]{22}$/.test(value), invalidIdMessage: "invalid_spotify_track_id" }
  },
  apple: {
    label: "Apple Music", supportsLocalVolume: true, supportsLive: false, defaultPlaybackMode: "default",
    catalogMatching: true, personalSession: true, requiresSpotifyGrant: false, counterpartMatchMethods: null,
    locator: { validId: (value: string) => /^\d+$/.test(value), invalidIdMessage: "invalid_apple_music_song_id" }
  },
  mixcloud: {
    label: "Mixcloud", supportsLocalVolume: false, supportsLive: false, defaultPlaybackMode: "default",
    catalogMatching: false, personalSession: false, requiresSpotifyGrant: false, counterpartMatchMethods: null,
    locator: { validId: isMixcloudShowKey, invalidIdMessage: "invalid_mixcloud_show_key", permalinkIssues: mixcloudPermalinkIssues }
  }
} as const satisfies Record<Provider, ProviderDefinition>;

export const PROVIDER_LABELS = Object.fromEntries(
  MUSIC_PROVIDERS.map(provider => [provider, PROVIDER_DEFINITIONS[provider].label])
) as Record<Provider, string>;

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(PROVIDER_DEFINITIONS, value);
}

export function validateProviderTrackLocator(provider: Provider, track: ProviderTrackLocator, context: LocatorContext): ProviderLocatorIssue[] {
  const { locator }: ProviderDefinition = PROVIDER_DEFINITIONS[provider];
  const issues: ProviderLocatorIssue[] = locator.validId(track.providerId)
    ? [] : [{ path: "providerId", messageKey: locator.invalidIdMessage }];
  return issues.concat(locator.permalinkIssues?.(track, context) ?? []);
}
