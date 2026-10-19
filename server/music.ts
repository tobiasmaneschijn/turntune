import type { Provider } from "./types.js";

export interface ProviderTrackMapping {
  providerId: string;
  permalinkUrl?: string;
  artworkUrl?: string;
  storefront?: string;
  matchMethod?: "source" | "isrc" | "exact-metadata" | "fuzzy";
}

export interface CatalogTrack {
  provider: Extract<Provider, "spotify" | "apple">;
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: string;
  durationMs?: number;
  permalinkUrl?: string;
  isrc?: string;
  storefront?: string;
}

export function formatDuration(durationMs?: number) {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function normalizeTrackText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/\([^)]*(official|video|audio|lyrics?|visuali[sz]er)[^)]*\)/g, " ")
    .replace(/\[[^\]]*(official|video|audio|lyrics?|visuali[sz]er)[^\]]*\]/g, " ")
    .replace(/\b(official|music|video|audio|lyrics?|visuali[sz]er|hd|hq)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeTrackArtist(value: string) {
  return normalizeTrackText(value)
    // YouTube commonly exposes an official artist channel as "ArtistVEVO" or
    // "Artist - Topic". These suffixes describe the channel, not the artist.
    .replace(/(?:vevo|official|topic)$/g, "")
    .trim();
}

function comparableTrackTitle(title: string, artist?: string) {
  const normalizedTitle = normalizeTrackText(title);
  const normalizedArtist = normalizeTrackArtist(artist || "");
  return normalizedArtist && normalizedTitle.startsWith(`${normalizedArtist} `)
    ? normalizedTitle.slice(normalizedArtist.length + 1).trim()
    : normalizedTitle;
}

export function catalogMatchScore(
  candidate: CatalogTrack,
  source: { title: string; artist?: string; durationMs?: number }
) {
  const sourceTitle = normalizeTrackText(source.title);
  const candidateTitle = normalizeTrackText(candidate.title);
  const sourceArtist = normalizeTrackText(source.artist || "");
  const candidateArtist = normalizeTrackText(candidate.artist);
  if (!sourceTitle || !candidateTitle) return 0;
  let score = 0;

  if (sourceTitle === candidateTitle) score += 0.7;
  else if (sourceTitle.includes(candidateTitle) || candidateTitle.includes(sourceTitle)) score += 0.48;
  else {
    const sourceWords = new Set(sourceTitle.split(" ").filter(Boolean));
    const candidateWords = candidateTitle.split(" ").filter(Boolean);
    const overlap = candidateWords.filter((word) => sourceWords.has(word)).length;
    score += candidateWords.length ? 0.4 * (overlap / candidateWords.length) : 0;
  }

  if (sourceArtist && candidateArtist) {
    if (sourceArtist === candidateArtist) score += 0.23;
    else if (sourceArtist.includes(candidateArtist) || candidateArtist.includes(sourceArtist)) score += 0.15;
  }

  if (source.durationMs && candidate.durationMs) {
    const difference = Math.abs(source.durationMs - candidate.durationMs);
    if (difference <= 2_000) score += 0.07;
    else if (difference <= 8_000) score += 0.04;
  }

  return Math.min(score, 1);
}

export function bestCatalogMatch(
  candidates: CatalogTrack[],
  source: { title: string; artist?: string; durationMs?: number },
  minimumScore = 0.52
) {
  return candidates
    .map((candidate) => ({ candidate, score: catalogMatchScore(candidate, source) }))
    .filter(({ score }) => score >= minimumScore)
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

/**
 * Cross-provider playback must not silently replace a remix, edit, live take,
 * or cover with a similarly named Spotify recording. Without an ISRC, only an
 * exact normalized title + artist and a near-identical duration is strong
 * enough evidence to treat two catalog entries as the same recording.
 */
export function isCertainCatalogMatch(
  candidate: CatalogTrack,
  source: { title: string; artist?: string; durationMs?: number }
) {
  const sourceTitle = comparableTrackTitle(source.title, source.artist);
  const candidateTitle = comparableTrackTitle(candidate.title, candidate.artist);
  const sourceArtist = normalizeTrackArtist(source.artist || "");
  const candidateArtist = normalizeTrackArtist(candidate.artist);

  if (!sourceTitle || sourceTitle !== candidateTitle) return false;
  if (!sourceArtist || sourceArtist !== candidateArtist) return false;
  if (!source.durationMs || !candidate.durationMs) return false;
  return Math.abs(source.durationMs - candidate.durationMs) <= 2_000;
}

export function bestCertainCatalogMatch(
  candidates: CatalogTrack[],
  source: { title: string; artist?: string; durationMs?: number }
) {
  return candidates
    .filter((candidate) => isCertainCatalogMatch(candidate, source))
    .sort((left, right) =>
      Math.abs((left.durationMs || 0) - (source.durationMs || 0)) -
      Math.abs((right.durationMs || 0) - (source.durationMs || 0))
    )[0];
}
