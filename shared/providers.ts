import type { Provider, RoomSettings } from "./types.js";
import { MUSIC_PROVIDERS, PROVIDER_DEFINITIONS } from "./provider-definitions.js";
export * from "./provider-definitions.js";

/** Spotify requires an explicit app-admin room grant, including legacy rooms. */
export function allowedRoomProviders(settings: RoomSettings): Provider[] {
  return MUSIC_PROVIDERS.filter(provider =>
    (!PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant || settings.spotifyEnabled === true) &&
    (!Array.isArray(settings.allowedProviders) || settings.allowedProviders.includes(provider)));
}

export function roomAllowsProvider(settings: RoomSettings, provider: Provider): boolean {
  return allowedRoomProviders(settings).includes(provider);
}
