import { readStoredValue } from "./lib/browser-storage";

export type PlaybackPreference = "source" | "spotify-web" | "spotify-desktop" | "apple";
export type PlaybackFallback = "source" | "ask" | "silent";

export interface SoundSpinUserSettings {
  playback: {
    preference: PlaybackPreference;
    defaultVolume: number;
    spotifyDeviceId: string;
    fallback: PlaybackFallback;
    resumeAfterReconnect: boolean;
    compactPlayer: boolean;
  };
  notifications: {
    djTurn: boolean;
    unavailableTrack: boolean;
    chatMentions: boolean;
    playbackErrors: boolean;
  };
  appearance: {
    reducedMotion: boolean;
    artworkBlur: number;
  };
}

export const USER_SETTINGS_STORAGE_KEY = "soundspin-user-settings";
const LEGACY_PLAYBACK_PROVIDER_KEY = "soundspin-playback-provider";
const LEGACY_SPOTIFY_DEVICE_KEY = "soundspin-spotify-device-id";

const defaults: SoundSpinUserSettings = {
  playback: {
    preference: "source",
    defaultVolume: 80,
    spotifyDeviceId: "",
    fallback: "source",
    resumeAfterReconnect: true,
    compactPlayer: false
  },
  notifications: {
    djTurn: true,
    unavailableTrack: true,
    chatMentions: true,
    playbackErrors: true
  },
  appearance: {
    reducedMotion: false,
    artworkBlur: 30
  }
};

function playbackPreference(value: unknown): PlaybackPreference {
  return value === "spotify-web" || value === "spotify-desktop" || value === "apple" || value === "source"
    ? value
    : "source";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedNumber(value: unknown, fallback: number, maximum: number) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(0, Math.min(maximum, number)) : fallback;
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function readUserSettings(): SoundSpinUserSettings {
  let stored: Record<string, unknown> = {};
  try {
    stored = record(JSON.parse(readStoredValue(USER_SETTINGS_STORAGE_KEY) || "{}"));
  } catch {
    // Invalid settings are replaced with safe defaults below.
  }
  const legacyPreference = readStoredValue(LEGACY_PLAYBACK_PROVIDER_KEY);
  const playback = record(stored.playback);
  const notifications = record(stored.notifications);
  const appearance = record(stored.appearance);
  return {
    playback: {
      preference: playbackPreference(playback.preference ?? legacyPreference),
      defaultVolume: boundedNumber(playback.defaultVolume, defaults.playback.defaultVolume, 100),
      spotifyDeviceId: typeof playback.spotifyDeviceId === "string"
        ? playback.spotifyDeviceId
        : readStoredValue(LEGACY_SPOTIFY_DEVICE_KEY) || "",
      fallback: playback.fallback === "ask" || playback.fallback === "silent" ? playback.fallback : "source",
      resumeAfterReconnect: boolean(playback.resumeAfterReconnect, defaults.playback.resumeAfterReconnect),
      compactPlayer: boolean(playback.compactPlayer, defaults.playback.compactPlayer)
    },
    notifications: {
      djTurn: boolean(notifications.djTurn, defaults.notifications.djTurn),
      unavailableTrack: boolean(notifications.unavailableTrack, defaults.notifications.unavailableTrack),
      chatMentions: boolean(notifications.chatMentions, defaults.notifications.chatMentions),
      playbackErrors: boolean(notifications.playbackErrors, defaults.notifications.playbackErrors)
    },
    appearance: {
      reducedMotion: boolean(appearance.reducedMotion, defaults.appearance.reducedMotion),
      artworkBlur: boundedNumber(appearance.artworkBlur, defaults.appearance.artworkBlur, 60)
    }
  };
}

export function saveUserSettings(settings: SoundSpinUserSettings) {
  try {
    localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(LEGACY_PLAYBACK_PROVIDER_KEY, settings.playback.preference);
    if (settings.playback.spotifyDeviceId) localStorage.setItem(LEGACY_SPOTIFY_DEVICE_KEY, settings.playback.spotifyDeviceId);
    else localStorage.removeItem(LEGACY_SPOTIFY_DEVICE_KEY);
  } catch {
    // Settings still apply to the current session when persistent storage is unavailable.
  }
}
