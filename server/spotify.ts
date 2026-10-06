import type { CatalogTrack } from "./music.js";
import { formatDuration } from "./music.js";

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  is_playable?: boolean;
  external_urls?: { spotify?: string };
  external_ids?: { isrc?: string };
  artists: Array<{ name: string }>;
  album?: { images?: Array<{ url: string; width?: number; height?: number }> };
}

function mapSpotifyTrack(track: SpotifyTrack): CatalogTrack {
  return {
    provider: "spotify",
    id: track.id,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(", ") || "Spotify",
    thumbnail: track.album?.images?.[0]?.url,
    duration: formatDuration(track.duration_ms),
    durationMs: track.duration_ms,
    permalinkUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    isrc: track.external_ids?.isrc
  };
}

export class SpotifyApi {
  private appToken: { value: string; expiresAt: number } | null = null;
  private appTokenPromise: Promise<string> | null = null;

  constructor(
    private readonly clientId = process.env.SPOTIFY_CLIENT_ID,
    private readonly clientSecret = process.env.SPOTIFY_CLIENT_SECRET,
    private readonly market = process.env.SPOTIFY_MARKET || "US",
    private readonly fetcher: typeof fetch = fetch
  ) {}

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  private basicAuthorization() {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
  }

  private async tokenRequest(body: URLSearchParams) {
    if (!this.configured) throw new Error("Spotify is not configured yet.");
    const response = await this.fetcher("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: this.basicAuthorization(),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json() as SpotifyTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description || payload.error || "Spotify authorization failed.");
    }
    return payload;
  }

  async getAppToken() {
    if (this.appToken && this.appToken.expiresAt > Date.now() + 30_000) return this.appToken.value;
    if (!this.appTokenPromise) {
      this.appTokenPromise = this.tokenRequest(new URLSearchParams({ grant_type: "client_credentials" }))
        .then((payload) => {
          this.appToken = {
            value: payload.access_token,
            expiresAt: Date.now() + payload.expires_in * 1000
          };
          return payload.access_token;
        }).finally(() => { this.appTokenPromise = null; });
    }
    return this.appTokenPromise;
  }

  exchangeAuthorizationCode(code: string, redirectUri: string) {
    return this.tokenRequest(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    }));
  }

  refreshUserToken(refreshToken: string) {
    return this.tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }));
  }

  authorizationUrl(redirectUri: string, state: string) {
    if (!this.clientId) throw new Error("Spotify is not configured yet.");
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      scope: "streaming user-read-playback-state user-modify-playback-state user-read-private"
    });
    return `https://accounts.spotify.com/authorize?${params}`;
  }

  async request<T>(accessToken: string, pathname: string, init?: RequestInit) {
    const response = await this.fetcher(`https://api.spotify.com/v1${pathname}`, {
      ...init,
      signal: init?.signal || AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers
      }
    });
    if (response.status === 204) return null as T;
    const payload = await response.json().catch(() => ({})) as T & {
      error?: { message?: string } | string;
    };
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      const error = new Error(message || `Spotify request failed (${response.status}).`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    return payload;
  }

  async searchTracks(query: string, limit = 10) {
    const token = await this.getAppToken();
    const params = new URLSearchParams({ q: query, type: "track", limit: String(Math.min(limit, 10)), market: this.market });
    const payload = await this.request<{ tracks?: { items?: SpotifyTrack[] } }>(token, `/search?${params}`);
    return (payload.tracks?.items || [])
      .filter((track) => track.is_playable !== false)
      .map(mapSpotifyTrack);
  }

  async getTrack(id: string) {
    const token = await this.getAppToken();
    return mapSpotifyTrack(await this.request<SpotifyTrack>(token, `/tracks/${encodeURIComponent(id)}?market=${encodeURIComponent(this.market)}`));
  }

  async findByIsrc(isrc: string) {
    return (await this.searchTracks(`isrc:${isrc}`, 10))[0];
  }
}
