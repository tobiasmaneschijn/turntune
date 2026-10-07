import { readStoredValue } from "./lib/browser-storage";
import type { Provider, Track } from "./types";

export const SEARCH_PROVIDER_STORAGE_KEY = "soundspin-search-provider";

export interface ProviderSearchResult {
  provider: Provider;
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: string;
  durationMs?: number;
  permalinkUrl?: string;
}

export function providerLabel(provider: Provider) {
  return { youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify", apple: "Apple Music" }[provider];
}

export function readSearchProvider(): Provider {
  const provider = readStoredValue(SEARCH_PROVIDER_STORAGE_KEY);
  // Apple catalog search is still hidden behind the existing Coming Soon option.
  return provider === "soundcloud" || provider === "spotify" ? provider : "youtube";
}

function isHost(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function detectMusicProvider(value: string): Provider | null {
  if (/^spotify:track:[A-Za-z0-9]{22}$/.test(value.trim())) return "spotify";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.hostname === "youtu.be" || isHost(url.hostname, "youtube.com")) return "youtube";
    if (isHost(url.hostname, "spotify.com")) return "spotify";
    if (isHost(url.hostname, "soundcloud.com")) return "soundcloud";
    if (isHost(url.hostname, "music.apple.com")) return "apple";
  } catch {
    // Bare IDs are deliberately interpreted only by the selected provider.
  }
  return null;
}

export function youtubeId(value: string): string | null {
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    let id: string | null = null;
    if (url.hostname === "youtu.be") id = url.pathname.split("/")[1];
    else if (isHost(url.hostname, "youtube.com")) {
      id = /^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split("/")[2] : url.searchParams.get("v");
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type MusicLink = { provider: Provider; url: string; providerId?: string };

export function parseMusicLink(value: string, selectedProvider: Provider): MusicLink | { error: string } {
  const input = value.trim();
  if (!input) return { error: "Paste a track link to find its details." };
  if (input.length > 2048) return { error: "That link is too long. Paste a track link under 2,048 characters." };
  if (/^spotify:track:[A-Za-z0-9]{22}$/.test(input)) return { provider: "spotify", url: input };
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) {
    return selectedProvider === "youtube"
      ? { provider: "youtube", providerId: input, url: `https://www.youtube.com/watch?v=${input}` }
      : { error: "For a bare YouTube video ID, choose YouTube first, or paste the full track link." };
  }
  if (/^[A-Za-z0-9]{22}$/.test(input) && selectedProvider === "spotify") return { provider: "spotify", url: input };
  const provider = detectMusicProvider(input);
  if (!provider) return { error: "Use a YouTube, Spotify, SoundCloud, or Apple Music track link." };
  const url = new URL(input);
  if (provider === "youtube") {
    const id = youtubeId(input);
    if (!id) return { error: "Paste a YouTube video link, not a channel or playlist link." };
    return { provider, url: `https://www.youtube.com/watch?v=${id}`, providerId: id };
  }
  if (provider === "spotify" && !/^\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]{22}(?:\/|$)/i.test(url.pathname)) {
    return { error: "Paste a Spotify track link. Albums and playlists cannot be added here." };
  }
  if (provider === "soundcloud" && /\/sets(?:\/|$)/.test(url.pathname)) {
    return { error: "Paste an individual SoundCloud track link, rather than a set or playlist." };
  }
  if (provider === "apple" && !/^\d+$/.test(url.searchParams.get("i") || "") && !/\/song\/[^/]+\/\d+\/?$/.test(url.pathname)) {
    return { error: "Paste an Apple Music song link. Album links need the selected song’s i= parameter." };
  }
  return { provider, url: input };
}

export function trackArtworkUrl(track: Pick<Track, "provider" | "providerId" | "artworkUrl">) {
  return track.provider === "youtube" ? `https://i.ytimg.com/vi/${track.providerId}/hqdefault.jpg` : track.artworkUrl;
}

export function formatTrackDuration(durationMs?: number) {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatPlayedAt(playedAt?: number) {
  if (typeof playedAt !== "number" || !Number.isFinite(playedAt) || playedAt <= 0 || !Number.isFinite(new Date(playedAt).getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(playedAt);
}

export function trackSourceUrl(track: Pick<Track, "provider" | "providerId" | "permalinkUrl">) {
  if (track.provider === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(track.providerId)) {
    return `https://www.youtube.com/watch?v=${track.providerId}`;
  }
  if (track.provider === "spotify" && /^[A-Za-z0-9]{22}$/.test(track.providerId)) {
    return `https://open.spotify.com/track/${track.providerId}`;
  }
  if (!track.permalinkUrl) return undefined;
  try {
    const url = new URL(track.permalinkUrl);
    return url.protocol === "https:" && detectMusicProvider(url.href) === track.provider ? url.href : undefined;
  } catch {
    return undefined;
  }
}
