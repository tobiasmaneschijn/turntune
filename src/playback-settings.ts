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

export function readUserSettings(): SoundSpinUserSettings {
  let stored: Partial<SoundSpinUserSettings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(USER_SETTINGS_STORAGE_KEY) || "{}") as Partial<SoundSpinUserSettings>;
  } catch {
    // Invalid settings are replaced with safe defaults below.
  }
  const legacyPreference = localStorage.getItem(LEGACY_PLAYBACK_PROVIDER_KEY);
  const playback = stored.playback || {} as Partial<SoundSpinUserSettings["playback"]>;
  const notifications = stored.notifications || {} as Partial<SoundSpinUserSettings["notifications"]>;
  const appearance = stored.appearance || {} as Partial<SoundSpinUserSettings["appearance"]>;
  return {
    playback: {
      ...defaults.playback,
      ...playback,
      preference: playbackPreference(playback.preference ?? legacyPreference),
      defaultVolume: Math.max(0, Math.min(100, Number(playback.defaultVolume ?? defaults.playback.defaultVolume))),
      spotifyDeviceId: typeof playback.spotifyDeviceId === "string"
        ? playback.spotifyDeviceId
        : String(localStorage.getItem(LEGACY_SPOTIFY_DEVICE_KEY) || ""),
      fallback: playback.fallback === "ask" || playback.fallback === "silent" ? playback.fallback : "source"
    },
    notifications: { ...defaults.notifications, ...notifications },
    appearance: {
      ...defaults.appearance,
      ...appearance,
      artworkBlur: Math.max(0, Math.min(60, Number(appearance.artworkBlur ?? defaults.appearance.artworkBlur)))
    }
  };
}

export function saveUserSettings(settings: SoundSpinUserSettings) {
  localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  localStorage.setItem(LEGACY_PLAYBACK_PROVIDER_KEY, settings.playback.preference);
  if (settings.playback.spotifyDeviceId) localStorage.setItem(LEGACY_SPOTIFY_DEVICE_KEY, settings.playback.spotifyDeviceId);
  else localStorage.removeItem(LEGACY_SPOTIFY_DEVICE_KEY);
}
