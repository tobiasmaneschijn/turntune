import { PROVIDER_DEFINITIONS } from "../../shared/provider-definitions.js";
import { audiusTrackUrl } from "../../shared/audius.js";
import { approvedRemoteImageUrl } from "../../shared/remote-images.js";
import { normalizeArtworkSources } from "../../shared/artwork.js";
import { formatDuration, type CatalogTrack } from "../features/music/music.js";
import { providerDuration, providerJson } from "./provider-http.js";

const API_ORIGIN = "https://api.audius.co";
const API_BASE = `${API_ORIGIN}/v1`;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function artworkSources(value: unknown): CatalogTrack["artworkSources"] {
  if (!record(value)) return;
  const result: NonNullable<CatalogTrack["artworkSources"]> = {};
  for (const size of ["150x150", "480x480", "1000x1000"] as const) {
    const url = approvedRemoteImageUrl(value[size]);
    if (url) result[size] = url;
  }
  if (Array.isArray(value.mirrors)) {
    result.mirrors = [...new Set(value.mirrors.slice(0, 8).flatMap(candidate => {
      const safe = approvedRemoteImageUrl(candidate);
      if (!safe) return [];
      const url = new URL(safe);
      return url.pathname === "/" && !url.search && !url.hash && !url.port ? [url.origin] : [];
    }))];
  }
  return Object.keys(result).length ? normalizeArtworkSources(result) : undefined;
}

function noRestrictions(value: unknown): boolean {
  return value === undefined || value === null || Array.isArray(value) && value.length === 0;
}

function mapPublicTrack(value: unknown): CatalogTrack | undefined {
  if (!record(value) || typeof value.id !== "string" || !PROVIDER_DEFINITIONS.audius.locator.validId(value.id) ||
    typeof value.title !== "string" || !value.title.trim() || !record(value.user) ||
    value.is_available !== true || value.is_delete !== false || value.is_unlisted !== false ||
    value.is_stream_gated !== false || value.is_scheduled_release !== false || value.is_streamable === false ||
    !record(value.access) || value.access.stream !== true ||
    !noRestrictions(value.allowed_api_keys) || !noRestrictions(value.access_authorities) ||
    value.stream_conditions !== undefined && value.stream_conditions !== null && (!record(value.stream_conditions) || Object.keys(value.stream_conditions).length > 0)) return;
  const artist = typeof value.user.name === "string" && value.user.name.trim() ? value.user.name.trim()
    : typeof value.user.handle === "string" ? value.user.handle.trim() : "";
  const permalinkUrl = audiusTrackUrl(typeof value.permalink === "string" && value.permalink.startsWith("/") ? `https://audius.co${value.permalink}` : value.permalink);
  const durationMs = providerDuration(typeof value.duration === "number" ? value.duration * 1000 : undefined);
  if (!artist || !permalinkUrl || !durationMs) return;
  const sources = artworkSources(value.artwork);
  return {
    provider: "audius", id: value.id, title: value.title.trim().slice(0, 120), artist: artist.slice(0, 120),
    thumbnail: sources?.["480x480"] ?? sources?.["1000x1000"] ?? sources?.["150x150"],
    artworkSources: sources, duration: formatDuration(durationMs), durationMs, permalinkUrl,
    isrc: typeof value.isrc === "string" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(value.isrc) ? value.isrc.toUpperCase() : undefined
  };
}

/** Public catalog reads deliberately never use the optional server bearer token. */
export class AudiusApi {
  constructor(
    private readonly apiKey = process.env.AUDIUS_API_KEY,
    _bearerToken = process.env.AUDIUS_API_BEARER_TOKEN,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  get configured() { return Boolean(this.apiKey?.trim()); }

  private async get(path: string, params: URLSearchParams | undefined, signal?: AbortSignal, resolveRedirect = false): Promise<unknown> {
    if (!this.configured) throw new Error("Audius is not configured.");
    const { response, payload } = await providerJson<unknown>("audius", this.fetcher, `${API_BASE}${path}${params ? `?${params}` : ""}`, {
      headers: { Accept: "application/json", "x-api-key": this.apiKey!.trim() }, signal
    }, resolveRedirect ? { allowedRedirectOrigins: [API_ORIGIN] } : undefined);
    if (!response.ok) throw new Error("Could not load Audius. Try again.");
    if (!record(payload) || !("data" in payload)) throw new Error("Audius returned an invalid response.");
    return payload.data;
  }

  async searchTracks(query: string, limit = 12, signal?: AbortSignal): Promise<CatalogTrack[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed.length > 100) throw new Error("Enter 2–100 characters to search Audius.");
    const requested = Number.isFinite(limit) ? Math.min(12, Math.max(1, Math.floor(limit))) : 12;
    const data = await this.get("/tracks/search", new URLSearchParams({ query: trimmed, limit: String(requested), includePurchaseable: "false" }), signal);
    if (!Array.isArray(data)) throw new Error("Audius returned an invalid search response.");
    return data.slice(0, requested).flatMap(track => { const mapped = mapPublicTrack(track); return mapped ? [mapped] : []; });
  }

  async resolveTrack(permalinkUrl: string, signal?: AbortSignal): Promise<CatalogTrack> {
    const canonical = audiusTrackUrl(permalinkUrl);
    if (!canonical) throw new Error("Enter a valid Audius track URL.");
    const data = await this.get("/resolve", new URLSearchParams({ url: canonical }), signal, true);
    const track = mapPublicTrack(data);
    if (!track) throw new Error("This Audius recording is not publicly playable.");
    if (track.permalinkUrl !== canonical) throw new Error("This Audius URL resolves to a different recording.");
    return track;
  }

  async getTrack(id: string, signal?: AbortSignal): Promise<CatalogTrack> {
    if (!PROVIDER_DEFINITIONS.audius.locator.validId(id)) throw new Error("Enter a valid Audius track ID.");
    const data = await this.get(`/tracks/${encodeURIComponent(id)}`, undefined, signal);
    const track = mapPublicTrack(data);
    if (!track || track.id !== id) throw new Error("This Audius recording is not publicly playable.");
    return track;
  }

  async playbackUrl(id: string, signal?: AbortSignal): Promise<string> {
    // Recheck current public access, including a creator removing API permission.
    const track = await this.getTrack(id, signal);
    signal?.throwIfAborted();
    return `${API_BASE}/tracks/${encodeURIComponent(track.id)}/stream?${new URLSearchParams({ api_key: this.apiKey!.trim() })}`;
  }
}
