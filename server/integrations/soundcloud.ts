import { serverT } from "../lib/i18n.js";
import { approvedRemoteImageUrl } from "../../shared/remote-images.js";
import { providerDuration, providerHttpsUrl, providerJson } from "./provider-http.js";
import { formatDuration } from "../features/music/music.js";

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
    typeof track.urn !== "string" || track.urn.length > 200 ||
    typeof track.title !== "string" || !track.title.trim() ||
    !providerHttpsUrl(track.permalink_url) ||
    track.access === "blocked" ||
    track.streamable === false
  ) {
    return null;
  }
  const durationMs = providerDuration(track.duration);
  const artist = typeof track.user?.username === "string" ? track.user.username : typeof track.publisher_metadata?.artist === "string" ? track.publisher_metadata.artist : "SoundCloud creator";
  return {
    provider: "soundcloud",
    id: track.urn,
    title: track.title.slice(0, 120),
    // SoundCloud attribution requires crediting the uploader. Prefer the
    // account username even when publisher metadata names another artist.
    artist: artist.slice(0, 120),
    thumbnail: approvedRemoteImageUrl(track.artwork_url) || approvedRemoteImageUrl(track.user?.avatar_url),
    duration: formatDuration(durationMs),
    durationMs,
    permalinkUrl: track.permalink_url!
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

  private async requestToken(grant: "client_credentials" | "refresh_token", signal?: AbortSignal) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(serverT("soundcloud_search_is_not_configured_yet"));
    }

    const body = new URLSearchParams({ grant_type: grant });
    const headers: Record<string, string> = {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded"
    };

    if (grant === "client_credentials") {
      headers.Authorization = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
    } else {
      if (!this.token?.refreshToken) throw new Error(serverT("no_soundcloud_refresh_token_is_available"));
      body.set("client_id", this.clientId);
      body.set("client_secret", this.clientSecret);
      body.set("refresh_token", this.token.refreshToken);
    }

    const { response, payload } = await providerJson<SoundCloudTokenResponse>("soundcloud", this.fetcher, "https://secure.soundcloud.com/oauth/token", {
      method: "POST",
      headers,
      body,
      signal
    }, { maxBytes: 16_384 });
    if (!response.ok || !payload.access_token) {
      throw new Error(soundCloudError(payload, serverT("soundcloud_authentication_failed")));
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      // Refresh one minute early so an in-flight catalog request does not race expiry.
      expiresAt: Date.now() + Math.max(30, (payload.expires_in || 3600) - 60) * 1000
    } satisfies SoundCloudToken;
  }

  private async obtainToken(signal?: AbortSignal) {
    if (this.token?.refreshToken) {
      try {
        return await this.requestToken("refresh_token", signal);
      } catch {
        signal?.throwIfAborted();
        // Refresh tokens are single-use. Fall back to a fresh app token if it was
        // already consumed or invalidated.
        this.token = null;
      }
    }
    return this.requestToken("client_credentials", signal);
  }

  private async accessToken(forceRefresh = false, signal?: AbortSignal) {
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now()) {
      return this.token.accessToken;
    }
    if (!this.tokenPromise) {
      this.tokenPromise = this.obtainToken(signal)
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

  private async apiGet<T>(url: string, signal?: AbortSignal, retry = true): Promise<{ response: Response; payload: T }> {
    signal?.throwIfAborted();
    const result = await providerJson<T>("soundcloud", this.fetcher, url, {
      headers: {
        Accept: "application/json; charset=utf-8",
        Authorization: `OAuth ${await this.accessToken(false, signal)}`
      }, signal
    }, { allowedRedirectOrigins: ["https://api.soundcloud.com"] });
    if (result.response.status === 401 && retry) {
      this.token = null;
      await this.accessToken(true, signal);
      return this.apiGet<T>(url, signal, false);
    }
    return result;
  }

  async searchTracks(query: string, limit = 12, signal?: AbortSignal): Promise<SoundCloudSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      access: "playable",
      limit: String(Math.min(12, Math.max(1, limit)))
    });
    const { response, payload } = await this.apiGet<SoundCloudTrack[] | { collection?: SoundCloudTrack[] }>(`https://api.soundcloud.com/tracks?${params}`, signal);
    if (!response.ok) {
      throw new Error(soundCloudError(payload, serverT("soundcloud_search_failed")));
    }

    const tracks = Array.isArray(payload) ? payload : payload.collection || [];
    return tracks.slice(0, Math.min(12, limit)).map(mapTrack).filter((track): track is SoundCloudSearchResult => Boolean(track));
  }

  async resolveTrack(permalinkUrl: string, signal?: AbortSignal): Promise<SoundCloudSearchResult> {
    const params = new URLSearchParams({ url: permalinkUrl });
    const { response, payload } = await this.apiGet<SoundCloudTrack>(`https://api.soundcloud.com/resolve?${params}`, signal);
    if (!response.ok) {
      throw new Error(soundCloudError(payload, serverT("could_not_resolve_that_soundcloud_url")));
    }
    const track = mapTrack(payload);
    if (!track) {
      throw new Error(serverT("that_soundcloud_url_is_not_a_playable_public_track"));
    }
    return track;
  }
}
