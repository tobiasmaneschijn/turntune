import { formatDuration } from "./music.js";
import { isMixcloudShowKey, mixcloudShowKey, mixcloudShowUrl } from "../shared/mixcloud.js";

export interface MixcloudSearchResult {
  provider: "mixcloud";
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: string;
  durationMs: number;
  permalinkUrl: string;
}

type MixcloudShow = {
  key?: unknown;
  name?: unknown;
  audio_length?: unknown;
  pictures?: { large?: unknown; medium?: unknown };
  user?: { name?: unknown; username?: unknown };
};

function httpsImage(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function mapShow(value: unknown): MixcloudSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const show = value as MixcloudShow;
  if (typeof show.key !== "string" || !isMixcloudShowKey(show.key) ||
    typeof show.name !== "string" || !show.name.trim() ||
    typeof show.audio_length !== "number" || !Number.isFinite(show.audio_length) ||
    show.audio_length <= 0 || show.audio_length > 86_400) return null;
  const uploader = typeof show.user?.name === "string" && show.user.name.trim() ? show.user.name
    : typeof show.user?.username === "string" ? show.user.username : "Mixcloud creator";
  const durationMs = Math.round(show.audio_length * 1000);
  if (durationMs <= 0) return null;
  return {
    provider: "mixcloud",
    id: show.key,
    title: show.name.trim().slice(0, 120),
    artist: uploader.trim().slice(0, 120) || "Mixcloud creator",
    thumbnail: httpsImage(show.pictures?.large) || httpsImage(show.pictures?.medium),
    duration: formatDuration(durationMs),
    durationMs,
    permalinkUrl: mixcloudShowUrl(show.key)
  };
}

async function readPayload(response: Response): Promise<unknown> {
  const maxBytes = 1_048_576;
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Mixcloud returned an oversized response.");
  if (!response.body) throw new Error("Mixcloud returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("Mixcloud returned an oversized response."); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(combined)); }
  catch { throw new Error("Mixcloud returned an invalid response."); }
}

/** Public read API; playback stays in the official Mixcloud widget. */
export class MixcloudApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  get configured() { return true; }

  private async request(path: string, signal?: AbortSignal) {
    const response = await this.fetcher(`https://api.mixcloud.com${path}`, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 403 || response.status === 429
        ? "Mixcloud is unavailable or its request limit was reached. Try again later."
        : "Could not load this Mixcloud show.");
    }
    return readPayload(response);
  }

  async searchTracks(query: string, limit = 12): Promise<MixcloudSearchResult[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.min(12, Math.max(1, Math.floor(limit))) : 12;
    const params = new URLSearchParams({ q: query.slice(0, 100), type: "cloudcast", limit: String(boundedLimit) });
    const payload = await this.request(`/search/?${params}`) as { data?: unknown[] } | null;
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.slice(0, boundedLimit).map(mapShow).filter((show): show is MixcloudSearchResult => Boolean(show));
  }

  async resolveTrack(value: string, signal?: AbortSignal): Promise<MixcloudSearchResult> {
    const key = mixcloudShowKey(value);
    if (!key) throw new Error("Enter a valid Mixcloud show URL.");
    const show = mapShow(await this.request(key, signal));
    if (!show || show.id !== key) throw new Error("That Mixcloud URL is not an available show.");
    return show;
  }
}
