import { serverT } from "../lib/i18n.js";
import { approvedRemoteImageUrl } from "../../shared/remote-images.js";
import { providerDuration, providerHttpsUrl, providerJson } from "./provider-http.js";
import crypto from "node:crypto";
import type { CatalogTrack } from "../features/music/music.js";
import { formatDuration } from "../features/music/music.js";

interface AppleSongAttributes {
  name: string;
  artistName: string;
  durationInMillis?: number;
  isrc?: string;
  url?: string;
  artwork?: { url?: string };
}

interface AppleSong {
  id: string;
  attributes?: AppleSongAttributes;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function mapAppleSong(song: AppleSong, storefront: string): CatalogTrack | null {
  const attributes = song.attributes;
  if (typeof song?.id !== "string" || song.id.length > 200 || typeof attributes?.name !== "string" || !attributes.name.trim() || typeof attributes.artistName !== "string" || !attributes.artistName.trim()) return null;
  const artwork = typeof attributes.artwork?.url === "string" ? attributes.artwork.url
    ?.replace("{w}", "600")
    .replace("{h}", "600") : undefined;
  const durationMs = providerDuration(attributes.durationInMillis);
  return {
    provider: "apple",
    id: song.id,
    title: attributes.name.slice(0, 120),
    artist: attributes.artistName.slice(0, 120),
    thumbnail: approvedRemoteImageUrl(artwork),
    duration: formatDuration(durationMs),
    durationMs,
    permalinkUrl: providerHttpsUrl(attributes.url),
    isrc: typeof attributes.isrc === "string" && attributes.isrc.length <= 12 ? attributes.isrc : undefined,
    storefront
  };
}

export class AppleMusicApi {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly teamId = process.env.APPLE_MUSIC_TEAM_ID,
    private readonly keyId = process.env.APPLE_MUSIC_KEY_ID,
    private readonly privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY?.replaceAll("\\n", "\n"),
    readonly storefront = process.env.APPLE_MUSIC_STOREFRONT || "us",
    private readonly fetcher: typeof fetch = fetch
  ) {}

  get configured() {
    return Boolean(this.teamId && this.keyId && this.privateKey);
  }

  getDeveloperToken() {
    if (!this.configured) throw new Error(serverT("apple_music_is_not_configured_yet"));
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + 6 * 60 * 60;
    const header = base64Url(JSON.stringify({ alg: "ES256", kid: this.keyId, typ: "JWT" }));
    const payload = base64Url(JSON.stringify({ iss: this.teamId, iat: issuedAt, exp: expiresAt }));
    const unsigned = `${header}.${payload}`;
    const signature = crypto.sign("sha256", Buffer.from(unsigned), {
      key: this.privateKey!,
      dsaEncoding: "ieee-p1363"
    });
    const value = `${unsigned}.${base64Url(signature)}`;
    this.token = { value, expiresAt: expiresAt * 1000 };
    return value;
  }

  private async request(pathname: string, signal?: AbortSignal) {
    const { response, payload } = await providerJson<{
      data?: AppleSong[];
      results?: { songs?: { data?: AppleSong[] } };
      errors?: Array<{ detail?: string; title?: string }>;
    }>("apple", this.fetcher, `https://api.music.apple.com/v1${pathname}`, {
      headers: { Authorization: `Bearer ${this.getDeveloperToken()}` }, signal
    });
    if (!response.ok) {
      throw new Error(payload.errors?.[0]?.detail || payload.errors?.[0]?.title || serverT("apple_music_request_failed"));
    }
    return payload;
  }

  async searchTracks(query: string, limit = 12, storefront = this.storefront, signal?: AbortSignal) {
    const params = new URLSearchParams({ term: query, types: "songs", limit: String(Math.min(limit, 25)) });
    const payload = await this.request(`/catalog/${encodeURIComponent(storefront)}/search?${params}`, signal);
    return (payload.results?.songs?.data || []).slice(0, Math.min(25, limit))
      .map((song) => mapAppleSong(song, storefront))
      .filter((song): song is CatalogTrack => Boolean(song));
  }

  async getTrack(id: string, storefront = this.storefront, signal?: AbortSignal) {
    const payload = await this.request(`/catalog/${encodeURIComponent(storefront)}/songs/${encodeURIComponent(id)}`, signal);
    const result = payload.data?.[0] && mapAppleSong(payload.data[0], storefront);
    if (!result) throw new Error(serverT("that_apple_music_song_could_not_be_found"));
    return result;
  }

  async findByIsrc(isrc: string, storefront = this.storefront, signal?: AbortSignal) {
    const params = new URLSearchParams({ "filter[isrc]": isrc });
    const payload = await this.request(`/catalog/${encodeURIComponent(storefront)}/songs?${params}`, signal);
    const result = payload.data?.[0] && mapAppleSong(payload.data[0], storefront);
    return result || undefined;
  }
}
