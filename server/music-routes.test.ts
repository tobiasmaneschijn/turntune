import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountMusicRoutes, type MusicRouteOptions } from "./music-routes.js";

async function fixture(run: (base: string, state: { calls: Array<{ kind: string; value?: string; path?: string; body?: unknown }>; unauthorizedOnce: boolean }) => Promise<void>, overrides: Partial<MusicRouteOptions> = {}) {
  const state = { calls: [] as Array<{ kind: string; value?: string; path?: string; body?: unknown }>, unauthorizedOnce: false };
  const options = {
    authEnabled: true, getUserId: async (request: express.Request) => request.get("authorization") === "Bearer alice" ? "alice" : null,
    youtubeApiKey: "fixture", soundCloudApi: { configured: true, searchTracks: async (q: string) => { state.calls.push({ kind: "soundcloud-search", value: q }); return []; }, resolveTrack: async (url: string) => { state.calls.push({ kind: "soundcloud-resolve", value: url }); return {}; } },
    spotifyApi: { configured: true, searchTracks: async (q: string) => { state.calls.push({ kind: "spotify-search", value: q }); return []; }, getTrack: async (id: string) => { state.calls.push({ kind: "spotify-track", value: id }); return {}; },
      request: async (_token: string, path: string, init?: RequestInit) => { state.calls.push({ kind: "spotify-request", path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (state.unauthorizedOnce) { state.unauthorizedOnce = false; throw Object.assign(new Error("Expired provider token"), { status: 401 }); }
        return { devices: [] }; } },
    spotifyAccounts: { configured: true, connected: async (user: string) => { state.calls.push({ kind: "connected", value: user }); return false; },
      getAccessToken: async (user: string) => { state.calls.push({ kind: "token", value: user }); return "fixture-token"; }, invalidate: (user: string) => { state.calls.push({ kind: "invalidate", value: user }); }, disconnect: async (user: string) => { state.calls.push({ kind: "disconnect", value: user }); } },
    appleMusicApi: { configured: true, storefront: "us", searchTracks: async () => [], getTrack: async () => ({}), getDeveloperToken: () => "developer-fixture" },
    giphyApi: { configured: true, gifs: async () => [] },
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => { assert.ok(init?.signal); state.calls.push({ kind: "youtube-request", value: String(input) }); return Response.json({ items: [] }); }
  } as unknown as MusicRouteOptions;
  const app = express();
  mountMusicRoutes(app, { ...options, ...overrides });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, state); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const authenticated = { headers: { Authorization: "Bearer alice" } };
test("music routes deny missing authentication before catalogs/accounts and prevent sensitive caching", async () => {
  await fixture(async (base, state) => {
    for (const path of ["youtube/search?q=mix", "youtube/live?id=aaaaaaaaaaa", "soundcloud/search?q=mix", "soundcloud/resolve?url=https://soundcloud.com/artist/song", "spotify/search?q=mix", "spotify/resolve?url=abcdefghijk123456789012", "apple/search?q=mix", "apple/resolve?url=https://music.apple.com/us/song/song/123", "giphy", "music/connections", "spotify/token", "spotify/devices", "spotify/playback", "apple/token"]) {
      const response = await fetch(`${base}/api/${path}`);
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.deepEqual(state.calls, []);
    const token = await fetch(`${base}/api/spotify/token`, authenticated);
    assert.equal(token.status, 200); assert.equal(token.headers.get("cache-control"), "no-store");
    assert.deepEqual(await token.json(), { accessToken: "fixture-token" });
    assert.deepEqual(state.calls, [{ kind: "token", value: "alice" }]);
  });
});
test("catalog searches reuse provider caches, YouTube requests have deadlines, and provider identifiers are validated", async () => {
  await fixture(async (base, state) => {
    for (const provider of ["spotify", "soundcloud", "youtube"]) {
      assert.equal((await fetch(`${base}/api/${provider}/search?q=mix`, authenticated)).status, 200);
      assert.equal((await fetch(`${base}/api/${provider}/search?q=MIX`, authenticated)).status, 200);
    }
    assert.equal(state.calls.filter(call => call.kind === "spotify-search").length, 1);
    assert.equal(state.calls.filter(call => call.kind === "soundcloud-search").length, 1);
    assert.equal(state.calls.filter(call => call.kind === "youtube-request").length, 1);
    const before = state.calls.length;
    assert.equal((await fetch(`${base}/api/spotify/resolve?url=https://evil.test/track/abc`, authenticated)).status, 400);
    assert.equal((await fetch(`${base}/api/soundcloud/resolve?url=https://evil.test/song`, authenticated)).status, 400);
    assert.equal(state.calls.length, before);
    for (let n = 0; n < 38; n++) assert.equal((await fetch(`${base}/api/spotify/search?q=mix`, authenticated)).status, 200);
    assert.equal((await fetch(`${base}/api/spotify/search?q=mix`, authenticated)).status, 429);
  });
});
test("Spotify request retries refresh once, playback commands retain their semantics, and account identity stays verified", async () => {
  await fixture(async (base, state) => {
    state.unauthorizedOnce = true;
    assert.equal((await fetch(`${base}/api/spotify/devices`, authenticated)).status, 200);
    assert.equal(state.calls.filter(call => call.kind === "invalidate").length, 1);
    assert.equal(state.calls.filter(call => call.kind === "spotify-request").length, 2);
    const playback = await fetch(`${base}/api/spotify/playback`, { method: "POST", headers: { ...authenticated.headers, "Content-Type": "application/json" }, body: JSON.stringify({ action: "play", spotifyUri: "spotify:track:abcdefghij123456789012", positionMs: 500, deviceId: "speaker" }) });
    assert.equal(playback.status, 204);
    assert.deepEqual(state.calls.at(-1), { kind: "spotify-request", path: "/me/player/play?device_id=speaker", body: { uris: ["spotify:track:abcdefghij123456789012"], position_ms: 500 } });
    assert.equal((await fetch(`${base}/api/spotify/connection?userId=bob`, { method: "DELETE", ...authenticated })).status, 204);
    assert.deepEqual(state.calls.at(-1), { kind: "disconnect", value: "alice" });
  });
});

test("YouTube live status distinguishes active streams, upcoming streams, and recordings", async () => {
  const videos = [
    { id: "aaaaaaaaaaa", snippet: { liveBroadcastContent: "live" }, liveStreamingDetails: { actualStartTime: "2026-10-08T10:00:00Z" } },
    { id: "bbbbbbbbbbb", snippet: { liveBroadcastContent: "upcoming" }, liveStreamingDetails: { scheduledStartTime: "2026-10-09T10:00:00Z" } },
    { id: "ccccccccccc", snippet: { liveBroadcastContent: "none" }, liveStreamingDetails: { actualStartTime: "2026-10-01T10:00:00Z", actualEndTime: "2026-10-01T12:00:00Z" } },
    { id: "ddddddddddd", snippet: { liveBroadcastContent: "none" } },
    { id: "eeeeeeeeeee", snippet: { liveBroadcastContent: "live" }, liveStreamingDetails: { actualEndTime: "2026-10-08T12:00:00Z" } }
  ];
  let requests = 0;
  await fixture(async base => {
    for (const [index, video] of videos.entries()) {
      const response = await fetch(`${base}/api/youtube/live?id=${video.id}`, authenticated);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { isLive: index === 0 });
    }
    assert.equal(requests, videos.length);
  }, { fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://www.googleapis.com/youtube/v3/videos");
    assert.equal(url.searchParams.get("part"), "snippet,liveStreamingDetails");
    assert.equal(url.searchParams.get("key"), "fixture");
    assert.ok(init?.signal instanceof AbortSignal);
    requests++;
    return Response.json({ items: videos.filter(video => video.id === url.searchParams.get("id")) });
  } });
});

test("YouTube live status validates IDs and requires configuration before contacting YouTube", async () => {
  await fixture(async (base, state) => {
    for (const query of ["", "id=short", "id=abcdefghijkl", "id=aaaaa!aaaaa", "id=aaaaaaaaaaa&id=bbbbbbbbbbb"]) {
      assert.equal((await fetch(`${base}/api/youtube/live?${query}`, authenticated)).status, 400, query);
    }
    assert.deepEqual(state.calls, []);
  });
  await fixture(async (base, state) => {
    const response = await fetch(`${base}/api/youtube/live?id=aaaaaaaaaaa`, authenticated);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(state.calls, []);
  }, { youtubeApiKey: undefined });
});

test("YouTube live status caches valid results for sixty seconds, including non-live videos", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 100_000 });
  let requests = 0;
  let live = false;
  await fixture(async base => {
    const lookup = () => fetch(`${base}/api/youtube/live?id=aaaaaaaaaaa`, authenticated);
    assert.deepEqual(await (await lookup()).json(), { isLive: false });
    live = true;
    t.mock.timers.tick(59_999);
    assert.deepEqual(await (await lookup()).json(), { isLive: false });
    assert.equal(requests, 1);
    t.mock.timers.tick(1);
    assert.deepEqual(await (await lookup()).json(), { isLive: true });
    assert.equal(requests, 2);
  }, { fetchImpl: async () => {
    requests++;
    return Response.json({ items: [{ id: "aaaaaaaaaaa", snippet: { liveBroadcastContent: live ? "live" : "none" } }] });
  } });
});

test("YouTube live status shares pending lookups and serves cached results after the miss limit", async () => {
  let requests = 0;
  let authenticatedRequests = 0;
  let release!: () => void;
  let started!: () => void;
  let secondAuthenticated!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const secondRequest = new Promise<void>(resolve => { secondAuthenticated = resolve; });
  await fixture(async base => {
    const first = fetch(`${base}/api/youtube/live?id=aaaaaaaaaaa`, authenticated);
    await firstStarted;
    const second = fetch(`${base}/api/youtube/live?id=aaaaaaaaaaa`, authenticated);
    await secondRequest;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(requests, 1);
    release();
    const responses = await Promise.all([first, second]);
    for (const response of responses) assert.deepEqual(await response.json(), { isLive: true });
    assert.equal(requests, 1);
    for (let index = 1; index < 30; index++) {
      const id = String(index).padStart(11, "0");
      assert.equal((await fetch(`${base}/api/youtube/live?id=${id}`, authenticated)).status, 200);
    }
    assert.equal((await fetch(`${base}/api/youtube/live?id=zzzzzzzzzzz`, authenticated)).status, 429);
    assert.deepEqual(await (await fetch(`${base}/api/youtube/live?id=aaaaaaaaaaa`, authenticated)).json(), { isLive: true });
    assert.equal(requests, 30);
  }, { getUserId: async request => {
    if (++authenticatedRequests === 2) secondAuthenticated();
    return request.get("authorization") === "Bearer alice" ? "alice" : null;
  }, fetchImpl: async input => {
    requests++;
    const id = new URL(String(input)).searchParams.get("id")!;
    if (requests === 1) { started(); await pending; }
    return Response.json({ items: [{ id, snippet: { liveBroadcastContent: "live" } }] });
  } });
});

test("YouTube live status does not cache unavailable videos, upstream failures, or malformed responses", async t => {
  t.mock.method(console, "error", () => {});
  const outcomes = [
    () => Response.json({ items: [] }),
    () => Response.json({ error: { message: "Quota exceeded" } }, { status: 403 }),
    () => { throw new Error("YouTube timed out"); },
    () => Response.json({ items: [{ id: "aaaaaaaaaaa" }] }),
    () => Response.json({ items: [{ id: "aaaaaaaaaaa", snippet: { liveBroadcastContent: "live" } }] })
  ];
  let requests = 0;
  await fixture(async base => {
    for (const expectedStatus of [404, 502, 502, 502, 200]) {
      const response = await fetch(`${base}/api/youtube/live?id=aaaaaaaaaaa`, authenticated);
      assert.equal(response.status, expectedStatus);
      if (expectedStatus === 200) assert.deepEqual(await response.json(), { isLive: true });
    }
    assert.equal(requests, outcomes.length);
  }, { fetchImpl: async () => outcomes[requests++]() });
});
