export interface SoundCloudSearchResult {
  provider: "soundcloud";
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: string;
  durationMs?: number;
  permalinkUrl: string;
}

interface SoundCloudToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface SoundCloudTrack {
  kind?: string;
  urn?: string;
  title?: string;
  artwork_url?: string | null;
  duration?: number;
  permalink_url?: string;
  access?: "playable" | "preview" | "blocked";
  streamable?: boolean;
  user?: {
    username?: string;
    avatar_url?: string;
  };
  publisher_metadata?: {
    artist?: string;
  } | null;
}

interface SoundCloudTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function formatDuration(milliseconds?: number) {
  if (!milliseconds || milliseconds < 0) return undefined;
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function soundCloudError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as {
    error?: string;
    error_description?: string;
    message?: string;
    errors?: Array<{ error_message?: string }>;
  };
  return value.error_description || value.message || value.errors?.[0]?.error_message || value.error || fallback;
}

function mapTrack(track: SoundCloudTrack): SoundCloudSearchResult | null {
  if (
    track.kind && track.kind !== "track" ||
    !track.urn ||
    !track.title ||
    !track.permalink_url ||
    track.access === "blocked" ||
    track.streamable === false
  ) {
    return null;
  }
  return {
    provider: "soundcloud",
    id: track.urn,
    title: track.title.slice(0, 120),
    // SoundCloud attribution requires crediting the uploader. Prefer the
    // account username even when publisher metadata names another artist.
    artist: (track.user?.username || track.publisher_metadata?.artist || "SoundCloud creator").slice(0, 120),
    thumbnail: track.artwork_url || track.user?.avatar_url || undefined,
    duration: formatDuration(track.duration),
    durationMs: track.duration,
    permalinkUrl: track.permalink_url
  };
}

/** Server-only SoundCloud API adapter for public catalog access. */
export class SoundCloudApi {
  private token: SoundCloudToken | null = null;
  private tokenPromise: Promise<SoundCloudToken> | null = null;

  constructor(
    private readonly clientId?: string,
    private readonly clientSecret?: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async requestToken(grant: "client_credentials" | "refresh_token") {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("SoundCloud search is not configured yet.");
    }

    const body = new URLSearchParams({ grant_type: grant });
    const headers: Record<string, string> = {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded"
    };

    if (grant === "client_credentials") {
      headers.Authorization = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
    } else {
      if (!this.token?.refreshToken) throw new Error("No SoundCloud refresh token is available.");
      body.set("client_id", this.clientId);
      body.set("client_secret", this.clientSecret);
      body.set("refresh_token", this.token.refreshToken);
    }

    const response = await this.fetcher("https://secure.soundcloud.com/oauth/token", {
      method: "POST",
      headers,
      body
    });
    const payload = await response.json() as SoundCloudTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(soundCloudError(payload, "SoundCloud authentication failed."));
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      // Refresh one minute early so an in-flight catalog request does not race expiry.
      expiresAt: Date.now() + Math.max(30, (payload.expires_in || 3600) - 60) * 1000
    } satisfies SoundCloudToken;
  }

  private async obtainToken() {
    if (this.token?.refreshToken) {
      try {
        return await this.requestToken("refresh_token");
      } catch {
        // Refresh tokens are single-use. Fall back to a fresh app token if it was
        // already consumed or invalidated.
        this.token = null;
      }
    }
    return this.requestToken("client_credentials");
  }

  private async accessToken(forceRefresh = false) {
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now()) {
      return this.token.accessToken;
    }
    if (!this.tokenPromise) {
      this.tokenPromise = this.obtainToken()
        .then((token) => {
          this.token = token;
          return token;
        })
        .finally(() => {
          this.tokenPromise = null;
        });
    }
    return (await this.tokenPromise).accessToken;
  }

  private async apiGet(url: string, retry = true): Promise<Response> {
    const response = await this.fetcher(url, {
      headers: {
        Accept: "application/json; charset=utf-8",
        Authorization: `OAuth ${await this.accessToken()}`
      }
    });
    if (response.status === 401 && retry) {
      this.token = null;
      await this.accessToken(true);
      return this.apiGet(url, false);
    }
    return response;
  }

  async searchTracks(query: string, limit = 12): Promise<SoundCloudSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      access: "playable",
      limit: String(limit)
    });
    const response = await this.apiGet(`https://api.soundcloud.com/tracks?${params}`);
    const payload = await response.json() as SoundCloudTrack[] | { collection?: SoundCloudTrack[] };
    if (!response.ok) {
      throw new Error(soundCloudError(payload, "SoundCloud search failed."));
    }

    const tracks = Array.isArray(payload) ? payload : payload.collection || [];
    return tracks.map(mapTrack).filter((track): track is SoundCloudSearchResult => Boolean(track));
  }

  async resolveTrack(permalinkUrl: string): Promise<SoundCloudSearchResult> {
    const params = new URLSearchParams({ url: permalinkUrl });
    const response = await this.apiGet(`https://api.soundcloud.com/resolve?${params}`);
    const payload = await response.json() as SoundCloudTrack;
    if (!response.ok) {
      throw new Error(soundCloudError(payload, "Could not resolve that SoundCloud URL."));
    }
    const track = mapTrack(payload);
    if (!track) {
      throw new Error("That SoundCloud URL is not a playable public track.");
    }
    return track;
  }
}
