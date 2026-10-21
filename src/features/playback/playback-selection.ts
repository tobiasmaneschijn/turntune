import { isProviderAvailable, PROVIDER_DEFINITIONS, roomAllowsProvider } from "../../../shared/providers";
import type { Playback, Provider, ProviderTrackMapping, RoomSettings } from "../../types";
import type { PlaybackFallback, PlaybackPreference } from "../settings/user-settings";

/** Preferences name a provider and an execution mode; source follows the room track. */
export const PLAYBACK_PREFERENCES = {
  source: { provider: null, mode: "default", titleKey: "userSettingsDialog.roomSource", icon: "radio" },
  "spotify-web": { provider: "spotify", mode: "web", titleKey: "userSettingsDialog.spotifyInBrowser", icon: "music" },
  "spotify-desktop": { provider: "spotify", mode: "desktop", titleKey: "userSettingsDialog.spotifyConnect", icon: "device" },
  apple: { provider: "apple", mode: "default", titleKey: "userSettingsDialog.appleMusic", icon: "music" }
} as const satisfies Record<string, { provider: Provider | null; mode: string; titleKey: string; icon: string }>;

export function playbackPreferenceAllowed(preference: PlaybackPreference, spotifyEnabled: boolean) {
  const provider = PLAYBACK_PREFERENCES[preference].provider;
  return !provider || isProviderAvailable(provider) && (!PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant || spotifyEnabled);
}

export interface PlaybackTarget {
  provider: Provider;
  mapping: ProviderTrackMapping;
  mode: string;
}

export function resolvePlaybackSelection(input: {
  playback: Playback;
  settings: RoomSettings;
  preference: PlaybackPreference;
  fallback: PlaybackFallback;
  approvedTrackId: string;
}) {
  const { playback, settings } = input;
  const track = playback.track;
  // An explicit provider grant takes precedence over a persisted preference.
  const preference = playbackPreferenceAllowed(input.preference, settings.spotifyEnabled === true) ? input.preference : "source";
  const selected = PLAYBACK_PREFERENCES[preference];
  const preferredProvider = selected.provider || track?.provider || "youtube";
  const preferredAllowed = roomAllowsProvider(settings, preferredProvider);
  const sourceAllowed = Boolean(track && roomAllowsProvider(settings, track.provider));
  const mapped = track?.mappings?.[preferredProvider];
  const methods: readonly string[] | null = PROVIDER_DEFINITIONS[preferredProvider].counterpartMatchMethods;
  const trusted = preferredAllowed && mapped && (track?.provider === preferredProvider || methods === null
    || Boolean(mapped.matchMethod && methods.includes(mapped.matchMethod))) ? mapped : undefined;
  const preferredMapping = trusted || (preferredAllowed && track?.provider === preferredProvider
    ? { providerId: track.providerId, permalinkUrl: track.permalinkUrl } : undefined);
  const provider = preferredMapping ? preferredProvider : sourceAllowed ? track?.provider : undefined;
  const mapping = preferredMapping || (track && sourceAllowed
    ? { providerId: track.providerId, permalinkUrl: track.permalinkUrl, artworkUrl: track.artworkUrl } : undefined);
  const mode = selected.provider === provider && selected.mode !== "default" ? selected.mode
    : provider ? PROVIDER_DEFINITIONS[provider].defaultPlaybackMode : "default";
  const target: PlaybackTarget | undefined = provider && mapping ? { provider, mapping, mode } : undefined;
  const providerFallback = Boolean(track && provider && preferredProvider !== provider);
  const approvalPending = providerFallback && preferredAllowed && input.approvedTrackId !== track?.id;
  return {
    preference, preferredProvider, preferredAllowed, target, providerFallback,
    fallbackNeedsApproval: approvalPending && input.fallback === "ask",
    fallbackSuppressed: approvalPending && input.fallback === "silent"
  };
}
