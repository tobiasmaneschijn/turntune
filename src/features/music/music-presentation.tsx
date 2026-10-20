import i18n from "../../i18n";
import { readStoredValue } from "../../lib/browser-storage";
import type { Provider, Track } from "../../types";
import { isMixcloudShowKey, mixcloudShowKey, mixcloudShowUrl } from "../../../shared/mixcloud";

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
  return i18n.t(`music:providers.${provider}`);
}

export function readSearchProvider(): Provider {
  const provider = readStoredValue(SEARCH_PROVIDER_STORAGE_KEY);
  // Apple catalog search is still hidden behind the existing Coming Soon option.
  return provider === "soundcloud" || provider === "spotify" || provider === "mixcloud" ? provider : "youtube";
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
    if (url.hostname === "mixcloud.com" || url.hostname === "www.mixcloud.com") return "mixcloud";
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
  if (!input) return { error: i18n.t("music:links.required") };
  if (input.length > 2048) return { error: i18n.t("music:links.tooLong") };
  if (/^spotify:track:[A-Za-z0-9]{22}$/.test(input)) return { provider: "spotify", url: input };
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) {
    return selectedProvider === "youtube"
      ? { provider: "youtube", providerId: input, url: `https://www.youtube.com/watch?v=${input}` }
      : { error: i18n.t("music:links.chooseYoutube") };
  }
  if (/^[A-Za-z0-9]{22}$/.test(input) && selectedProvider === "spotify") return { provider: "spotify", url: input };
  const provider = detectMusicProvider(input);
  if (!provider) return { error: i18n.t("music:links.unsupported") };
  const url = new URL(input);
  if (provider === "youtube") {
    const id = youtubeId(input);
    if (!id) return { error: i18n.t("music:links.youtubeTrack") };
    return { provider, url: `https://www.youtube.com/watch?v=${id}`, providerId: id };
  }
  if (provider === "spotify" && !/^\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]{22}(?:\/|$)/i.test(url.pathname)) {
    return { error: i18n.t("music:links.spotifyTrack") };
  }
  if (provider === "soundcloud" && /\/sets(?:\/|$)/.test(url.pathname)) {
    return { error: i18n.t("music:links.soundcloudTrack") };
  }
  if (provider === "apple" && !/^\d+$/.test(url.searchParams.get("i") || "") && !/\/song\/[^/]+\/\d+\/?$/.test(url.pathname)) {
    return { error: i18n.t("music:links.appleTrack") };
  }
  if (provider === "mixcloud") {
    const providerId = mixcloudShowKey(input);
    if (!providerId) return { error: i18n.t("music:links.mixcloudShow") };
    return { provider, providerId, url: mixcloudShowUrl(providerId) };
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
  return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(playedAt);
}

export function trackSourceUrl(track: Pick<Track, "provider" | "providerId" | "permalinkUrl">) {
  if (track.provider === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(track.providerId)) {
    return `https://www.youtube.com/watch?v=${track.providerId}`;
  }
  if (track.provider === "spotify" && /^[A-Za-z0-9]{22}$/.test(track.providerId)) {
    return `https://open.spotify.com/track/${track.providerId}`;
  }
  if (track.provider === "mixcloud" && isMixcloudShowKey(track.providerId)) {
    return mixcloudShowUrl(track.providerId);
  }
  if (!track.permalinkUrl) return undefined;
  try {
    const url = new URL(track.permalinkUrl);
    return url.protocol === "https:" && detectMusicProvider(url.href) === track.provider ? url.href : undefined;
  } catch {
    return undefined;
  }
}
