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

  async gifs(query = ""): Promise<GiphyGif[]> {
    if (!this.apiKey) throw new Error("GIPHY is not configured yet.");

    const normalizedQuery = query.trim();
    const endpoint = normalizedQuery ? "search" : "trending";
    const params = new URLSearchParams({
      api_key: this.apiKey,
      limit: "18",
      rating: "pg",
      bundle: "messaging_non_clips"
    });
    if (normalizedQuery) params.set("q", normalizedQuery);

    const response = await this.fetchImpl(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`);
    const payload = await response.json().catch(() => ({})) as GiphyResponse;
    if (!response.ok) {
      throw new Error(payload.meta?.msg || `GIPHY request failed (${response.status}).`);
    }

    return (payload.data || []).flatMap((gif) => {
      const url = gif.images?.fixed_width?.url;
      if (!gif.id || !url) return [];
      return [{
        id: gif.id,
        title: gif.title || "GIPHY GIF",
        url,
        preview: gif.images?.fixed_width_small?.url || url
      }];
    });
  }
}
