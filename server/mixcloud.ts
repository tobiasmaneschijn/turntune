import { serverT } from "./i18n.js";
import { approvedRemoteImageUrl } from "../shared/remote-images.js";
import { providerJson } from "./provider-http.js";
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
    artist: uploader.trim().slice(0, 120) || serverT("mixcloud_creator"),
    thumbnail: approvedRemoteImageUrl(show.pictures?.large) || approvedRemoteImageUrl(show.pictures?.medium),
    duration: formatDuration(durationMs),
    durationMs,
    permalinkUrl: mixcloudShowUrl(show.key)
  };
}

/** Public read API; playback stays in the official Mixcloud widget. */
export class MixcloudApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  get configured() { return true; }

  private async request(path: string, signal?: AbortSignal) {
    const { response, payload } = await providerJson<unknown>("mixcloud", this.fetcher, `https://api.mixcloud.com${path}`, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 403 || response.status === 429
        ? serverT("mixcloud_is_unavailable_or_its_request_limit_was_reached_try_again_later")
        : serverT("could_not_load_this_mixcloud_show"));
    }
    return payload;
  }

  async searchTracks(query: string, limit = 12, signal?: AbortSignal): Promise<MixcloudSearchResult[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.min(12, Math.max(1, Math.floor(limit))) : 12;
    const params = new URLSearchParams({ q: query.slice(0, 100), type: "cloudcast", limit: String(boundedLimit) });
    const payload = await this.request(`/search/?${params}`, signal) as { data?: unknown[] } | null;
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.slice(0, boundedLimit).map(mapShow).filter((show): show is MixcloudSearchResult => Boolean(show));
  }

  async resolveTrack(value: string, signal?: AbortSignal): Promise<MixcloudSearchResult> {
    const key = mixcloudShowKey(value);
    if (!key) throw new Error(serverT("enter_a_valid_mixcloud_show_url"));
    const show = mapShow(await this.request(key, signal));
    if (!show || show.id !== key) throw new Error(serverT("that_mixcloud_url_is_not_an_available_show"));
    return show;
  }
}
