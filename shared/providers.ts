import type { Provider, RoomSettings } from "./types.js";

export const MUSIC_PROVIDERS = ["youtube", "soundcloud", "spotify", "apple", "mixcloud"] as const;

export const PROVIDER_LABELS: Record<Provider, string> = {
  youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify", apple: "Apple Music", mixcloud: "Mixcloud"
};

/** Rooms saved before service controls allow every provider. */
export function allowedRoomProviders(settings: RoomSettings): Provider[] {
  if (!Array.isArray(settings.allowedProviders)) return [...MUSIC_PROVIDERS];
  return MUSIC_PROVIDERS.filter(provider => settings.allowedProviders!.includes(provider));
}

export function roomAllowsProvider(settings: RoomSettings, provider: Provider): boolean {
  return allowedRoomProviders(settings).includes(provider);
}
