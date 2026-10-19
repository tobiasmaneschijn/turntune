import i18n from "./i18n";
import type { Provider, Track } from "./types";
import { requestJson } from "./lib/authenticated-http";

export interface LibraryTrack {
  provider: Provider; providerId: string; title: string; artist?: string;
  artworkUrl?: string; permalinkUrl?: string; durationMs?: number;
}
export interface SavedPick { id: string; track: LibraryTrack; savedAt: number }
export interface SavedSet { id: string; name: string; tracks: LibraryTrack[]; savedAt: number }
export interface LibraryResourceLimits { libraryPicks: number; librarySets: number; librarySetTracks: number }
export interface PrivateLibrary { picks: SavedPick[]; sets: SavedSet[]; limits?: LibraryResourceLimits }
export function libraryLimits(library: PrivateLibrary | null): LibraryResourceLimits {
  return library?.limits ?? { libraryPicks: 500, librarySets: 30, librarySetTracks: 50 };
}
export type LibraryMutation = { type: "save-pick"; track: LibraryTrack } | { type: "delete-pick"; id: string }
  | { type: "save-set"; id: string; name: string; tracks: LibraryTrack[] } | { type: "rename-set"; id: string; name: string }
  | { type: "delete-set"; id: string } | { type: "clear-library" };
export function libraryTrack(track: LibraryTrack | Track): LibraryTrack {
  return { provider: track.provider, providerId: track.providerId, title: track.title, artist: track.artist,
    artworkUrl: track.artworkUrl, permalinkUrl: track.permalinkUrl, durationMs: track.durationMs };
}
export async function requestPrivateLibrary(accessToken: string, mutation?: LibraryMutation, signal?: AbortSignal): Promise<PrivateLibrary> {
  const body = await requestJson<{ library: PrivateLibrary; limits?: LibraryResourceLimits }>("/api/library", { method: mutation ? "POST" : "GET", accessToken,
    body: mutation ? JSON.stringify(mutation) : undefined, signal, errorMessage: i18n.t('music:library.loadError'),
    validate: (value): value is { library: PrivateLibrary } => Boolean(value && typeof value === "object" && "library" in value && value.library &&
      typeof value.library === "object" && "picks" in value.library && Array.isArray(value.library.picks) && "sets" in value.library && Array.isArray(value.library.sets)) });
  const limits = body.limits;
  return limits && [limits.libraryPicks, limits.librarySets, limits.librarySetTracks].every(value => Number.isSafeInteger(value) && value > 0)
    ? { ...body.library, limits } : body.library;
}
