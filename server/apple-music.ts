import crypto from "node:crypto";
import type { CatalogTrack } from "./music.js";
import { formatDuration } from "./music.js";

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
  if (!attributes?.name || !attributes.artistName) return null;
  const artwork = attributes.artwork?.url
    ?.replace("{w}", "600")
    .replace("{h}", "600");
  return {
    provider: "apple",
    id: song.id,
    title: attributes.name,
    artist: attributes.artistName,
    thumbnail: artwork,
    duration: formatDuration(attributes.durationInMillis),
    durationMs: attributes.durationInMillis,
    permalinkUrl: attributes.url,
    isrc: attributes.isrc,
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
    if (!this.configured) throw new Error("Apple Music is not configured yet.");
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

  private async request(pathname: string) {
    const response = await this.fetcher(`https://api.music.apple.com/v1${pathname}`, {
      headers: { Authorization: `Bearer ${this.getDeveloperToken()}` },
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json() as {
      data?: AppleSong[];
      results?: { songs?: { data?: AppleSong[] } };
      errors?: Array<{ detail?: string; title?: string }>;
    };
    if (!response.ok) {
      throw new Error(payload.errors?.[0]?.detail || payload.errors?.[0]?.title || "Apple Music request failed.");
    }
    return payload;
  }

  async searchTracks(query: string, limit = 12, storefront = this.storefront) {
    const params = new URLSearchParams({ term: query, types: "songs", limit: String(Math.min(limit, 25)) });
    const payload = await this.request(`/catalog/${encodeURIComponent(storefront)}/search?${params}`);
    return (payload.results?.songs?.data || [])
      .map((song) => mapAppleSong(song, storefront))
      .filter((song): song is CatalogTrack => Boolean(song));
  }

  async getTrack(id: string, storefront = this.storefront) {
    const payload = await this.request(`/catalog/${encodeURIComponent(storefront)}/songs/${encodeURIComponent(id)}`);
    const result = payload.data?.[0] && mapAppleSong(payload.data[0], storefront);
    if (!result) throw new Error("That Apple Music song could not be found.");
    return result;
  }

  async findByIsrc(isrc: string, storefront = this.storefront) {
    const params = new URLSearchParams({ "filter[isrc]": isrc });
    const payload = await this.request(`/catalog/${encodeURIComponent(storefront)}/songs?${params}`);
    const result = payload.data?.[0] && mapAppleSong(payload.data[0], storefront);
    return result || undefined;
  }
}
