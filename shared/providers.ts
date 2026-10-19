import type { Provider, RoomSettings } from "./types.js";

export const MUSIC_PROVIDERS = ["youtube", "soundcloud", "spotify", "apple", "mixcloud"] as const;

export const PROVIDER_LABELS: Record<Provider, string> = {
  youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify", apple: "Apple Music", mixcloud: "Mixcloud"
};

/** Spotify requires an explicit app-admin room grant, including legacy rooms. */
export function allowedRoomProviders(settings: RoomSettings): Provider[] {
  return MUSIC_PROVIDERS.filter(provider =>
    (provider !== "spotify" || settings.spotifyEnabled === true) &&
    (!Array.isArray(settings.allowedProviders) || settings.allowedProviders.includes(provider)));
}

export function roomAllowsProvider(settings: RoomSettings, provider: Provider): boolean {
  return allowedRoomProviders(settings).includes(provider);
}
