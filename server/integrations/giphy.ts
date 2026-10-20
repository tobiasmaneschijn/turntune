import { serverT } from "../lib/i18n.js";
import { approvedRemoteImageUrl } from "../../shared/remote-images.js";
import { providerJson } from "./provider-http.js";
export interface GiphyGif {
  id: string;
  title: string;
  url: string;
  preview: string;
}

interface GiphyResponse {
  data?: Array<{
    id?: string;
    title?: string;
    images?: {
      fixed_width?: { url?: string };
      fixed_width_small?: { url?: string };
    };
  }>;
  meta?: { msg?: string };
}

export class GiphyApi {
  constructor(
    private readonly apiKey = process.env.GIPHY_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  get configured() {
    return Boolean(this.apiKey);
  }

  async gifs(query = "", signal?: AbortSignal): Promise<GiphyGif[]> {
    if (!this.apiKey) throw new Error(serverT("giphy_is_not_configured_yet"));

    const normalizedQuery = query.trim();
    const endpoint = normalizedQuery ? "search" : "trending";
    const params = new URLSearchParams({
      api_key: this.apiKey,
      limit: "18",
      rating: "pg",
      bundle: "messaging_non_clips"
    });
    if (normalizedQuery) params.set("q", normalizedQuery);

    const { response, payload } = await providerJson<GiphyResponse>("giphy", this.fetchImpl, `https://api.giphy.com/v1/gifs/${endpoint}?${params}`, { signal });
    if (!response.ok) {
      throw new Error(payload.meta?.msg || serverT("giphy_request_failed_value1", { value1: response.status }));
    }

    return (payload.data || []).slice(0, 18).flatMap((gif) => {
      const url = approvedRemoteImageUrl(gif.images?.fixed_width?.url);
      if (!gif.id || gif.id.length > 200 || !url || url.length > 2048) return [];
      return [{
        id: gif.id,
        title: (gif.title || serverT("giphy_gif")).slice(0, 120),
        url,
        preview: approvedRemoteImageUrl(gif.images?.fixed_width_small?.url) || url
      }];
    });
  }
}
