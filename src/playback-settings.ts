export type PlaybackPreference = "source" | "spotify-web" | "spotify-desktop" | "apple";

export const PLAYBACK_PROVIDER_STORAGE_KEY = "soundspin-playback-provider";

export function readPlaybackPreference(): PlaybackPreference {
  const preference = localStorage.getItem(PLAYBACK_PROVIDER_STORAGE_KEY);
  return preference === "spotify-web" || preference === "spotify-desktop" || preference === "apple"
    ? preference
    : "source";
}

export function savePlaybackPreference(preference: PlaybackPreference) {
  localStorage.setItem(PLAYBACK_PROVIDER_STORAGE_KEY, preference);
}
