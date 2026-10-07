import type { Provider, Track } from "./types";

export interface LibraryTrack {
  provider: Provider; providerId: string; title: string; artist?: string;
  artworkUrl?: string; permalinkUrl?: string; durationMs?: number;
}
export interface SavedPick { id: string; track: LibraryTrack; savedAt: number }
export interface SavedSet { id: string; name: string; tracks: LibraryTrack[]; savedAt: number }
export interface PrivateLibrary { picks: SavedPick[]; sets: SavedSet[] }
export type LibraryMutation = { type: "save-pick"; track: LibraryTrack } | { type: "delete-pick"; id: string }
  | { type: "save-set"; id: string; name: string; tracks: LibraryTrack[] } | { type: "rename-set"; id: string; name: string }
  | { type: "delete-set"; id: string } | { type: "clear-library" };
export function libraryTrack(track: LibraryTrack | Track): LibraryTrack {
  return { provider: track.provider, providerId: track.providerId, title: track.title, artist: track.artist,
    artworkUrl: track.artworkUrl, permalinkUrl: track.permalinkUrl, durationMs: track.durationMs };
}
export async function requestPrivateLibrary(accessToken: string, mutation?: LibraryMutation, signal?: AbortSignal): Promise<PrivateLibrary> {
  const response = await fetch("/api/library", { method: mutation ? "POST" : "GET",
    headers: { Authorization: `Bearer ${accessToken}`, ...(mutation ? { "Content-Type": "application/json" } : {}) },
    body: mutation ? JSON.stringify(mutation) : undefined, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  const body = await response.json() as { library?: PrivateLibrary; error?: string };
  if (!response.ok || !body.library) throw new Error(body.error || "Could not load your private picks and sets.");
  return body.library;
}
