import { serverT } from "./i18n.js";
import { providerJson, providerSignal } from "./provider-http.js";
import { SignupAttemptLimiter } from "./invite-signup.js";
import express from "express";
import { z } from "zod";
import type { SoundCloudApi, SoundCloudSearchResult } from "./soundcloud.js";
import type { SpotifyApi } from "./spotify.js";
import type { SpotifyAccounts } from "./spotify-accounts.js";
import type { AppleMusicApi } from "./apple-music.js";
import type { GiphyApi } from "./giphy.js";
import { MixcloudApi, type MixcloudSearchResult } from "./mixcloud.js";
import { mixcloudShowKey } from "../shared/mixcloud.js";
import { BoundedCache } from "./bounded-cache.js";
import { runtimeMetrics } from "./runtime-metrics.js";
import { spotifyAccessAllowed, spotifyRoomContext, type SpotifyAccessCheck } from "./spotify-access.js";

export interface MusicRouteOptions {
  authEnabled: boolean;
  getUserId: (request: express.Request) => Promise<string | null>;
  canUseSpotify?: SpotifyAccessCheck;
  youtubeApiKey?: string;
  soundCloudApi: Pick<SoundCloudApi, "configured" | "searchTracks" | "resolveTrack">;
  spotifyApi: Pick<SpotifyApi, "configured" | "searchTracks" | "getTrack" | "request">;
  spotifyAccounts: Pick<SpotifyAccounts, "configured" | "connected" | "disconnect" | "getAccessToken" | "invalidate">;
  appleMusicApi: Pick<AppleMusicApi, "configured" | "storefront" | "searchTracks" | "getTrack" | "getDeveloperToken">;
  giphyApi: Pick<GiphyApi, "configured" | "gifs">;
  mixcloudApi?: Pick<MixcloudApi, "searchTracks" | "resolveTrack">;
  fetchImpl?: typeof fetch;
}
interface YouTubeSearchResult { id: string; title: string; channel: string; thumbnail: string; duration?: string; durationMs?: number }
const youtubeSearchSchema = z.object({
  q: z.string().trim().min(2).max(100)
});
const youtubeLiveSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/)
});

const soundCloudSearchSchema = youtubeSearchSchema;
const mixcloudSearchSchema = youtubeSearchSchema;
const mixcloudResolveSchema = z.object({ url: z.string().trim().url().max(2048) })
  .refine(value => Boolean(mixcloudShowKey(value.url)), serverT("enter_a_valid_mixcloud_show_url"));
const spotifySearchSchema = youtubeSearchSchema;
const appleMusicSearchSchema = youtubeSearchSchema.extend({
  storefront: z.string().regex(/^[a-z]{2}$/i).optional()
});
const giphySearchSchema = z.object({
  q: z.string().trim().max(100).optional().default("")
});

const spotifyResolveSchema = z.object({
  url: z.string().trim().max(2048)
});

const appleMusicResolveSchema = z.object({
  url: z.string().trim().url().max(2048),
  storefront: z.string().regex(/^[a-z]{2}$/i).optional()
});

const spotifyPlaybackSchema = z.object({
  action: z.enum(["transfer", "play", "pause", "resume", "seek", "volume"]),
  deviceId: z.string().min(1).max(200).optional(),
  spotifyUri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/).optional(),
  positionMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  volumePercent: z.number().int().min(0).max(100).optional()
}).superRefine((value, context) => {
  if (value.action === "play" && !value.spotifyUri) {
    context.addIssue({ code: "custom", path: ["spotifyUri"], message: serverT("a_spotify_track_is_required") });
  }
  if (value.action === "transfer" && !value.deviceId) {
    context.addIssue({ code: "custom", path: ["deviceId"], message: serverT("a_spotify_device_is_required") });
  }
  if (value.action === "volume" && value.volumePercent === undefined) {
    context.addIssue({ code: "custom", path: ["volumePercent"], message: serverT("a_volume_level_is_required") });
  }
});

const soundCloudResolveSchema = z.object({
  url: z.string().trim().url().max(2048)
}).superRefine((value, context) => {
  const hostname = new URL(value.url).hostname.toLowerCase();
  if (hostname !== "soundcloud.com" && !hostname.endsWith(".soundcloud.com")) {
    context.addIssue({ code: "custom", path: ["url"], message: serverT("enter_a_valid_soundcloud_track_url") });
  }
});

function decodeYouTubeText(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function formatYouTubeDuration(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function youtubeDurationMs(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return undefined;
  return (Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)) * 1000;
}

function spotifyTrackId(value: string) {
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
  const uri = value.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
  if (uri) return uri;
  try {
    const url = new URL(value);
    if (url.hostname === "open.spotify.com" || url.hostname.endsWith(".spotify.com")) {
      return url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/i)?.[1] || null;
    }
  } catch {
    // Not a Spotify URL.
  }
  return null;
}

function appleMusicTrack(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== "music.apple.com" && !url.hostname.endsWith(".music.apple.com")) return null;
    const storefront = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    const id = url.searchParams.get("i") || url.pathname.match(/\/(?:song|album)\/[^/]+\/(\d+)$/)?.[1];
    return id && /^\d+$/.test(id) ? { id, storefront } : null;
  } catch {
    return null;
  }
}

export function mountMusicRoutes(app: express.Express, options: MusicRouteOptions) {
  const { authEnabled, youtubeApiKey, soundCloudApi, spotifyApi, spotifyAccounts, appleMusicApi, giphyApi } = options;
  const verifiedUsers = new WeakMap<express.Request, string | null>();
  const signals = new WeakMap<express.Request, AbortSignal>();
  const getApiUserId = async (request: express.Request) => {
    if (verifiedUsers.has(request)) return verifiedUsers.get(request)!;
    const userId = await options.getUserId(request);
    verifiedUsers.set(request, userId);
    return userId;
  };
  const requestSignal = (request: express.Request) => signals.get(request)!;
  const accountBudget = new SignupAttemptLimiter(240, 60_000);
  const ipBudget = new SignupAttemptLimiter(600, 60_000);
  const endpointBudget = new SignupAttemptLimiter(60, 60_000);
  const playbackBudget = new SignupAttemptLimiter(180, 60_000);
  const fetchImpl = options.fetchImpl || fetch;
  const mixcloudApi = options.mixcloudApi || new MixcloudApi(fetchImpl);
  const youtubeSearchCache = new BoundedCache<{ expiresAt: number; results: YouTubeSearchResult[] }>(500);
  const youtubeLiveCache = new BoundedCache<{ expiresAt: number; isLive: boolean }>(500);
  const youtubeLivePending = new BoundedCache<{ expiresAt: number; lookup: Promise<boolean | null> }>(500);
  const soundCloudSearchCache = new BoundedCache<{ expiresAt: number; results: SoundCloudSearchResult[] }>(500);
  const mixcloudSearchCache = new BoundedCache<{ expiresAt: number; results: MixcloudSearchResult[] }>(500);
  const spotifySearchCache = new BoundedCache<{ expiresAt: number; results: Awaited<ReturnType<SpotifyApi["searchTracks"]>> }>(500);
  const appleMusicSearchCache = new BoundedCache<{ expiresAt: number; results: Awaited<ReturnType<AppleMusicApi["searchTracks"]>> }>(500);
  const youtubeSearchLimits = new BoundedCache<{ count: number; resetAt: number }>(10000);
  const youtubeLiveLimits = new BoundedCache<{ count: number; resetAt: number }>(10000);
  const soundCloudSearchLimits = new BoundedCache<{ count: number; resetAt: number }>(10000);
  const providerSearchLimits = new BoundedCache<{ count: number; resetAt: number }>(10000);
  app.use(["/api/youtube", "/api/soundcloud", "/api/mixcloud", "/api/spotify", "/api/apple", "/api/giphy", "/api/music"], async (request, response, next) => {
    response.set("Cache-Control", "no-store");
    // OAuth connect/callback are mounted separately and have their own flow quotas.
    if (request.path === "/connect" || request.path === "/callback") return next();
    const userId = await getApiUserId(request);
    if (authEnabled && !userId) return response.status(401).json({ error: serverT("authentication_required") });
    const removingConnection=request.method==="DELETE"&&request.path.toLowerCase()==="/connection";
    if (request.baseUrl.toLowerCase() === "/api/spotify"&&!removingConnection) {
      let roomSlug: string | undefined;
      try { roomSlug = spotifyRoomContext(request); }
      catch { return response.status(400).json({ error: serverT("invalid_room_context") }); }
      if (!userId || !await spotifyAccessAllowed(options.canUseSpotify, request, userId, roomSlug)) return response.status(403).json({ error: serverT("spotify_is_unavailable_in_this_room") });
    }
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const path = `${request.baseUrl}${request.path}`;
    const endpoint = path === "/api/spotify/playback" ? playbackBudget : endpointBudget;
    if (!ipBudget.consume(ip) || userId && !accountBudget.consume(userId) ||
      (!userId && !endpoint.consume(`ip:${ip}:${path}`)) || userId && !endpoint.consume(`account:${userId}:${path}`)) {
      return response.status(429).json({ error: serverT("too_many_music_requests_try_again_shortly") });
    }
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => { if (!response.writableEnded) controller.abort(); });
    signals.set(request, providerSignal(controller.signal));
    next();
  });
  const trackedProvider = async <T>(operation: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try { const result = await operation(); runtimeMetrics.observe("provider_request", Date.now() - started, result instanceof Response && !result.ok); return result; }
    catch (error) { runtimeMetrics.observe("provider_request", Date.now() - started, true); throw error; }
  };
function consumeProviderSearchLimit(request: express.Request) {
  const now = Date.now();
  const rateKey = verifiedUsers.get(request) || request.ip || request.socket.remoteAddress || "unknown";
  const current = providerSearchLimits.get(rateKey);
  const limit = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 10 * 60 * 1000 }
    : current;
  if (limit.count >= 40) return false;
  limit.count += 1;
  providerSearchLimits.set(rateKey, limit);
  return true;
}

async function spotifyForUser<T>(userId: string, operation: (accessToken: string) => Promise<T>) {
  try {
    return await trackedProvider(async () => operation(await spotifyAccounts.getAccessToken(userId)));
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 401) throw error;
    spotifyAccounts.invalidate(userId);
    return trackedProvider(async () => operation(await spotifyAccounts.getAccessToken(userId)));
  }
}

app.get("/api/youtube/live", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!youtubeApiKey) {
    return response.status(503).json({ error: serverT("youtube_live_status_is_not_configured_yet") });
  }
  const parsed = youtubeLiveSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: serverT("enter_a_valid_youtube_video_id") });
  }

  const { id } = parsed.data;
  const now = Date.now();
  const cached = youtubeLiveCache.get(id);
  if (cached && cached.expiresAt > now) return response.json({ isLive: cached.isLive });

  let pending = youtubeLivePending.get(id);
  if (!pending) {
    const rateKey = verifiedUsers.get(request) || request.ip || request.socket.remoteAddress || "unknown";
    const currentLimit = youtubeLiveLimits.get(rateKey);
    const limit = !currentLimit || currentLimit.resetAt <= now
      ? { count: 0, resetAt: now + 10 * 60 * 1000 }
      : currentLimit;
    if (limit.count >= 30) {
      return response.status(429).json({ error: serverT("too_many_live_status_requests_please_try_again_in_a_few_minutes") });
    }
    limit.count += 1;
    youtubeLiveLimits.set(rateKey, limit);

    const lookup = (async () => {
      const params = new URLSearchParams({ key: youtubeApiKey, part: "snippet,liveStreamingDetails", id });
      const { response: videoResponse, payload } = await trackedProvider(() => providerJson<{
        error?: { message?: string };
        items?: Array<{ id: string; snippet?: { liveBroadcastContent?: string }; liveStreamingDetails?: { actualEndTime?: string } }>;
      }>("youtube", fetchImpl, `https://www.googleapis.com/youtube/v3/videos?${params}`, { signal: requestSignal(request) }));
      if (!videoResponse.ok) throw new Error(payload.error?.message || serverT("could_not_check_youtube_live_status"));
      if (!Array.isArray(payload.items)) throw new Error(serverT("youtube_returned_an_invalid_live_status_response"));
      const video = payload.items?.find((item) => item.id === id);
      if (!video) return null;
      if (!video.snippet || !["live", "upcoming", "none"].includes(video.snippet.liveBroadcastContent || "")) {
        throw new Error(serverT("youtube_returned_an_invalid_live_status_response"));
      }
      const isLive = video.snippet?.liveBroadcastContent === "live" && !video.liveStreamingDetails?.actualEndTime;
      youtubeLiveCache.set(id, { expiresAt: Date.now() + 60_000, isLive });
      return isLive;
    })();
    pending = { expiresAt: now + 10_000, lookup };
    youtubeLivePending.set(id, pending);
  }

  try {
    const isLive = await pending.lookup;
    if (isLive === null) return response.status(404).json({ error: serverT("youtube_video_is_unavailable") });
    return response.json({ isLive });
  } catch (error) {
    console.error("YouTube live status lookup failed");
    return response.status(502).json({ error: serverT("could_not_check_youtube_live_status") });
  } finally {
    if (youtubeLivePending.get(id) === pending) youtubeLivePending.delete(id);
  }
});

app.get("/api/youtube/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!youtubeApiKey) {
    return response.status(503).json({ error: serverT("youtube_search_is_not_configured_yet") });
  }

  const parsed = youtubeSearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: serverT("enter_at_least_2_characters_to_search") });
  }

  const now = Date.now();
  const rateKey = verifiedUsers.get(request) || request.ip || request.socket.remoteAddress || "unknown";
  const currentLimit = youtubeSearchLimits.get(rateKey);
  const limit = !currentLimit || currentLimit.resetAt <= now
    ? { count: 0, resetAt: now + 10 * 60 * 1000 }
    : currentLimit;
  if (limit.count >= 30) {
    return response.status(429).json({ error: serverT("too_many_searches_please_try_again_in_a_few_minutes") });
  }
  limit.count += 1;
  youtubeSearchLimits.set(rateKey, limit);

  const cacheKey = parsed.data.q.toLocaleLowerCase();
  const cached = youtubeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return response.json({ results: cached.results });
  }

  try {
    const searchParams = new URLSearchParams({
      key: youtubeApiKey,
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      safeSearch: "moderate",
      maxResults: "12",
      q: parsed.data.q
    });
    const { response: searchResponse, payload: searchPayload } = await trackedProvider(() => providerJson<{
      error?: { message?: string };
      items?: Array<{
        id: { videoId?: string };
        snippet: {
          title: string;
          channelTitle: string;
          thumbnails: { medium?: { url: string }; default?: { url: string } };
        };
      }>;
    }>("youtube", fetchImpl, `https://www.googleapis.com/youtube/v3/search?${searchParams}`, { signal: requestSignal(request) }));
    if (!searchResponse.ok) {
      throw new Error(searchPayload.error?.message || serverT("youtube_search_failed"));
    }

    const items = (searchPayload.items || []).slice(0, 12).filter((item) => item.id.videoId);
    const ids = items.map((item) => item.id.videoId!).join(",");
    const durations = new Map<string, { label: string; milliseconds?: number }>();
    if (ids) {
      const videoParams = new URLSearchParams({
        key: youtubeApiKey,
        part: "contentDetails",
        id: ids
      });
      const { response: videoResponse, payload: videoPayload } = await trackedProvider(() => providerJson<{
        items?: Array<{ id: string; contentDetails?: { duration?: string } }>;
      }>("youtube", fetchImpl, `https://www.googleapis.com/youtube/v3/videos?${videoParams}`, { signal: requestSignal(request) }));
      if (videoResponse.ok) {
        for (const video of videoPayload.items || []) {
          const duration = formatYouTubeDuration(video.contentDetails?.duration);
          if (duration) durations.set(video.id, { label: duration, milliseconds: youtubeDurationMs(video.contentDetails?.duration) });
        }
      }
    }

    const results: YouTubeSearchResult[] = items.map((item) => ({
      id: item.id.videoId!,
      title: decodeYouTubeText(item.snippet.title).slice(0, 120),
      channel: decodeYouTubeText(item.snippet.channelTitle).slice(0, 120),
      thumbnail:
        item.snippet.thumbnails.medium?.url ||
        item.snippet.thumbnails.default?.url ||
        `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
      duration: durations.get(item.id.videoId!)?.label,
      durationMs: durations.get(item.id.videoId!)?.milliseconds
    }));
    youtubeSearchCache.set(cacheKey, {
      expiresAt: now + 5 * 60 * 1000,
      results
    });
    response.json({ results });
  } catch (error) {
    console.error("YouTube search failed");
    response.status(502).json({
      error: serverT("youtube_search_failed")
    });
  }
});

app.get("/api/soundcloud/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!soundCloudApi.configured) {
    return response.status(503).json({ error: serverT("soundcloud_search_is_not_configured_yet") });
  }

  const parsed = soundCloudSearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: serverT("enter_at_least_2_characters_to_search") });
  }

  const now = Date.now();
  const rateKey = verifiedUsers.get(request) || request.ip || request.socket.remoteAddress || "unknown";
  const currentLimit = soundCloudSearchLimits.get(rateKey);
  const limit = !currentLimit || currentLimit.resetAt <= now
    ? { count: 0, resetAt: now + 10 * 60 * 1000 }
    : currentLimit;
  if (limit.count >= 30) {
    return response.status(429).json({ error: serverT("too_many_searches_please_try_again_in_a_few_minutes") });
  }
  limit.count += 1;
  soundCloudSearchLimits.set(rateKey, limit);

  const cacheKey = parsed.data.q.toLocaleLowerCase();
  const cached = soundCloudSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return response.json({ results: cached.results });
  }

  try {
    const results = await trackedProvider(() => soundCloudApi.searchTracks(parsed.data.q, undefined, requestSignal(request)));
    soundCloudSearchCache.set(cacheKey, {
      expiresAt: now + 5 * 60 * 1000,
      results
    });
    response.json({ results });
  } catch (error) {
    console.error("SoundCloud search failed");
    response.status(502).json({
      error: serverT("soundcloud_search_failed")
    });
  }
});

app.get("/api/soundcloud/resolve", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!soundCloudApi.configured) {
    return response.status(503).json({ error: serverT("soundcloud_is_not_configured_yet") });
  }

  const parsed = soundCloudResolveSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: serverT("enter_a_valid_soundcloud_track_url") });
  }

  try {
    response.json({ result: await trackedProvider(() => soundCloudApi.resolveTrack(parsed.data.url, requestSignal(request))) });
  } catch (error) {
    console.error("SoundCloud URL resolution failed");
    response.status(400).json({
      error: serverT("could_not_resolve_that_soundcloud_url")
    });
  }
});

app.get("/api/mixcloud/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) return response.status(401).json({ error: serverT("authentication_required") });
  const parsed = mixcloudSearchSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ error: serverT("enter_at_least_2_characters_to_search") });
  if (!consumeProviderSearchLimit(request)) return response.status(429).json({ error: serverT("too_many_searches_please_try_again_shortly") });
  const key = parsed.data.q.toLocaleLowerCase();
  const cached = mixcloudSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return response.json({ results: cached.results });
  try {
    const results = await trackedProvider(() => mixcloudApi.searchTracks(parsed.data.q, undefined, requestSignal(request)));
    mixcloudSearchCache.set(key, { results, expiresAt: Date.now() + 5 * 60 * 1000 });
    response.json({ results });
  } catch (error) {
    console.error("Mixcloud search failed");
    response.status(502).json({ error: serverT("mixcloud_search_failed") });
  }
});

app.get("/api/mixcloud/resolve", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) return response.status(401).json({ error: serverT("authentication_required") });
  const parsed = mixcloudResolveSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ error: serverT("enter_a_valid_mixcloud_show_url") });
  if (!consumeProviderSearchLimit(request)) return response.status(429).json({ error: serverT("too_many_requests_please_try_again_shortly") });
  try { response.json({ result: await trackedProvider(() => mixcloudApi.resolveTrack(parsed.data.url, requestSignal(request))) }); }
  catch (error) {
    response.status(400).json({ error: serverT("could_not_resolve_that_mixcloud_url") });
  }
});

app.get("/api/spotify/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!spotifyApi.configured) return response.status(503).json({ error: serverT("spotify_is_not_configured_yet") });
  const parsed = spotifySearchSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ error: serverT("enter_at_least_2_characters_to_search") });
  if (!consumeProviderSearchLimit(request)) return response.status(429).json({ error: serverT("too_many_searches_please_try_again_shortly") });
  const key = parsed.data.q.toLocaleLowerCase();
  const cached = spotifySearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return response.json({ results: cached.results });
  try {
    const results = await trackedProvider(() => spotifyApi.searchTracks(parsed.data.q, undefined, requestSignal(request)));
    spotifySearchCache.set(key, { results, expiresAt: Date.now() + 5 * 60 * 1000 });
    response.json({ results });
  } catch (error) {
    console.error("Spotify search failed");
    response.status(502).json({ error: serverT("spotify_search_failed") });
  }
});

app.get("/api/spotify/resolve", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!spotifyApi.configured) return response.status(503).json({ error: serverT("spotify_is_not_configured_yet") });
  const parsed = spotifyResolveSchema.safeParse(request.query);
  const id = parsed.success ? spotifyTrackId(parsed.data.url) : null;
  if (!id) return response.status(400).json({ error: serverT("enter_a_valid_spotify_track_url_or_uri") });
  try {
    response.json({ result: await trackedProvider(() => spotifyApi.getTrack(id, requestSignal(request))) });
  } catch (error) {
    response.status(400).json({ error: serverT("could_not_resolve_that_spotify_url") });
  }
});

app.get("/api/apple/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!appleMusicApi.configured) return response.status(503).json({ error: serverT("apple_music_is_not_configured_yet") });
  const parsed = appleMusicSearchSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ error: serverT("enter_at_least_2_characters_to_search") });
  if (!consumeProviderSearchLimit(request)) return response.status(429).json({ error: serverT("too_many_searches_please_try_again_shortly") });
  const storefront = parsed.data.storefront?.toLowerCase() || appleMusicApi.storefront;
  const key = `${storefront}:${parsed.data.q.toLocaleLowerCase()}`;
  const cached = appleMusicSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return response.json({ results: cached.results });
  try {
    const results = await trackedProvider(() => appleMusicApi.searchTracks(parsed.data.q, 12, storefront, requestSignal(request)));
    appleMusicSearchCache.set(key, { results, expiresAt: Date.now() + 5 * 60 * 1000 });
    response.json({ results });
  } catch (error) {
    console.error("Apple Music search failed");
    response.status(502).json({ error: serverT("apple_music_search_failed") });
  }
});

app.get("/api/apple/resolve", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!appleMusicApi.configured) return response.status(503).json({ error: serverT("apple_music_is_not_configured_yet") });
  const parsed = appleMusicResolveSchema.safeParse(request.query);
  const resolved = parsed.success ? appleMusicTrack(parsed.data.url) : null;
  if (!resolved) return response.status(400).json({ error: serverT("enter_a_valid_apple_music_song_url") });
  try {
    response.json({
      result: await trackedProvider(() => appleMusicApi.getTrack(
        resolved.id,
        parsed.success ? parsed.data.storefront?.toLowerCase() || resolved.storefront || appleMusicApi.storefront : appleMusicApi.storefront,
        requestSignal(request)
      ))
    });
  } catch (error) {
    response.status(400).json({ error: serverT("could_not_resolve_that_apple_music_url") });
  }
});

app.get("/api/giphy", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!giphyApi.configured) {
    return response.status(503).json({ error: serverT("giphy_is_not_configured_yet") });
  }
  const parsed = giphySearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: serverT("gif_searches_must_be_100_characters_or_fewer") });
  }
  if (!consumeProviderSearchLimit(request)) {
    return response.status(429).json({ error: serverT("too_many_searches_please_try_again_shortly") });
  }

  try {
    response.json({ results: await trackedProvider(() => giphyApi.gifs(parsed.data.q, requestSignal(request))) });
  } catch (error) {
    console.error("GIPHY request failed");
    response.status(502).json({
      error: serverT("could_not_load_gifs")
    });
  }
});

app.get("/api/music/connections", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  try {
    let roomSlug: string | undefined;
    try { roomSlug = spotifyRoomContext(request); }
    catch { return response.status(400).json({ error: serverT("invalid_room_context") }); }
    const spotifyAllowed = await spotifyAccessAllowed(options.canUseSpotify, request, userId, roomSlug);
    const spotifyConnected = spotifyAllowed && spotifyAccounts.configured ? await spotifyAccounts.connected(userId) : false;
    let spotifyProfile: { displayName: string; product?: string } | null = null;
    if (spotifyConnected) {
      try {
        const profile = await spotifyForUser(userId, (token) => spotifyApi.request<{
          display_name?: string;
          product?: string;
        }>(token, "/me", { signal: requestSignal(request) }));
        spotifyProfile = { displayName: profile.display_name || "Spotify account", product: profile.product };
      } catch {
        // The saved connection remains useful even when profile metadata is temporarily unavailable.
      }
    }
    response.json({
      spotify: {
        configured: spotifyAllowed && spotifyAccounts.configured,
        connected: spotifyConnected,
        profile: spotifyProfile
      },
      apple: { configured: appleMusicApi.configured }
    });
  } catch (error) {
    response.status(500).json({ error: serverT("could_not_load_music_connections") });
  }
});

app.delete("/api/spotify/connection", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  try {
    await spotifyAccounts.disconnect(userId);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: serverT("could_not_disconnect_spotify") });
  }
});

app.get("/api/spotify/token", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  try {
    response.json({ accessToken: await spotifyAccounts.getAccessToken(userId) });
  } catch (error) {
    response.status(401).json({ error: serverT("connect_spotify_first") });
  }
});

app.get("/api/spotify/devices", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  try {
    response.json(await spotifyForUser(userId, (token) => spotifyApi.request(token, "/me/player/devices", { signal: requestSignal(request) })));
  } catch (error) {
    response.status(502).json({ error: serverT("could_not_load_spotify_devices") });
  }
});

app.get("/api/spotify/playback", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  try {
    const state = await spotifyForUser(userId, (token) => spotifyApi.request(token, "/me/player", { signal: requestSignal(request) }));
    response.json({ state });
  } catch (error) {
    response.status(502).json({ error: serverT("could_not_read_spotify_playback") });
  }
});

app.post("/api/spotify/playback", express.json({ limit: "4kb" }), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  const parsed = spotifyPlaybackSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message || serverT("invalid_playback_command") });
  const { action, deviceId, spotifyUri, positionMs, volumePercent } = parsed.data;
  const device = deviceId ? `?${new URLSearchParams({ device_id: deviceId })}` : "";
  try {
    await spotifyForUser(userId, async (token) => {
      if (action === "transfer") {
        return spotifyApi.request(token, "/me/player", {
          method: "PUT", signal: requestSignal(request),
          body: JSON.stringify({ device_ids: [deviceId], play: false })
        });
      }
      if (action === "play") {
        return spotifyApi.request(token, `/me/player/play${device}`, {
          method: "PUT", signal: requestSignal(request),
          body: JSON.stringify({ uris: [spotifyUri], position_ms: positionMs || 0 })
        });
      }
      if (action === "pause") return spotifyApi.request(token, `/me/player/pause${device}`, { method: "PUT", signal: requestSignal(request) });
      if (action === "resume") return spotifyApi.request(token, `/me/player/play${device}`, { method: "PUT", signal: requestSignal(request) });
      if (action === "volume") {
        const params = new URLSearchParams({ volume_percent: String(volumePercent) });
        if (deviceId) params.set("device_id", deviceId);
        return spotifyApi.request(token, `/me/player/volume?${params}`, { method: "PUT", signal: requestSignal(request) });
      }
      const params = new URLSearchParams({ position_ms: String(positionMs || 0) });
      if (deviceId) params.set("device_id", deviceId);
      return spotifyApi.request(token, `/me/player/seek?${params}`, { method: "PUT", signal: requestSignal(request) });
    });
    response.status(204).end();
  } catch (error) {
    response.status(502).json({ error: serverT("spotify_playback_failed") });
  }
});

app.get("/api/apple/token", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  if (!appleMusicApi.configured) return response.status(503).json({ error: serverT("apple_music_is_not_configured_yet") });
  try {
    response.json({ developerToken: appleMusicApi.getDeveloperToken(), storefront: appleMusicApi.storefront });
  } catch (error) {
    response.status(500).json({ error: serverT("could_not_create_an_apple_music_token") });
  }
});

}
