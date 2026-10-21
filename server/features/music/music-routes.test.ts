import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountMusicRoutes, type MusicRouteOptions } from "./music-routes.js";
import { mountConfigRoutes } from "../../app/config-routes.js";

async function fixture(run: (base: string, state: { calls: Array<{ kind: string; value?: string; path?: string; body?: unknown }>; unauthorizedOnce: boolean }) => Promise<void>, overrides: Partial<MusicRouteOptions> = {}) {
  const state = { calls: [] as Array<{ kind: string; value?: string; path?: string; body?: unknown }>, unauthorizedOnce: false };
  const options = {
    authEnabled: true, getUserId: async (request: express.Request) => request.get("authorization") === "Bearer alice" ? "alice" : null,
    canUseSpotify: async () => true,
    youtubeApiKey: "fixture", soundCloudApi: { configured: true, searchTracks: async (q: string) => { state.calls.push({ kind: "soundcloud-search", value: q }); return []; }, resolveTrack: async (url: string) => { state.calls.push({ kind: "soundcloud-resolve", value: url }); return {}; } },
    spotifyApi: { configured: true, searchTracks: async (q: string) => { state.calls.push({ kind: "spotify-search", value: q }); return []; }, getTrack: async (id: string) => { state.calls.push({ kind: "spotify-track", value: id }); return {}; },
      request: async (_token: string, path: string, init?: RequestInit) => { state.calls.push({ kind: "spotify-request", path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (state.unauthorizedOnce) { state.unauthorizedOnce = false; throw Object.assign(new Error("Expired provider token"), { status: 401 }); }
        return { devices: [] }; } },
    spotifyAccounts: { configured: true, connected: async (user: string) => { state.calls.push({ kind: "connected", value: user }); return false; },
      getAccessToken: async (user: string) => { state.calls.push({ kind: "token", value: user }); return "fixture-token"; }, invalidate: (user: string) => { state.calls.push({ kind: "invalidate", value: user }); }, disconnect: async (user: string) => { state.calls.push({ kind: "disconnect", value: user }); } },
    appleMusicApi: { configured: true, storefront: "us", searchTracks: async () => [], getTrack: async () => ({}), getDeveloperToken: () => "developer-fixture" },
    giphyApi: { configured: true, gifs: async () => [] },
    mixcloudApi: { searchTracks: async (q: string) => { state.calls.push({ kind: "mixcloud-search", value: q }); return []; }, resolveTrack: async (url: string) => { state.calls.push({ kind: "mixcloud-resolve", value: url }); return {}; } },
    audiusApi: { configured: true, searchTracks: async (q: string) => { state.calls.push({ kind: "audius-search", value: q }); return [{ provider: "audius", id: "a5aXGmz", title: "Public recording", artist: "Creator" }]; },
      resolveTrack: async (url: string) => { state.calls.push({ kind: "audius-resolve", value: url }); return { provider: "audius", id: "a5aXGmz", title: "Public recording", artist: "Creator" }; },
      playbackUrl: async (id: string) => { state.calls.push({ kind: "audius-playback", value: id }); return `https://api.audius.co/v1/tracks/${id}/stream?api_key=public-fixture`; } },
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => { assert.ok(init?.signal); state.calls.push({ kind: "youtube-request", value: String(input) }); return Response.json({ items: [] }); }
  } as unknown as MusicRouteOptions;
  const app = express();
  mountMusicRoutes(app, { ...options, ...overrides });
  mountConfigRoutes(app, { authEnabled: true, getApiUserId: options.getUserId,
    canUseSpotify: overrides.canUseSpotify ? (request, userId) => overrides.canUseSpotify!(request, userId) : async () => false,
    spotifyAccounts: options.spotifyAccounts, appleMusicApi: options.appleMusicApi, giphyApi: options.giphyApi });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, state); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const authenticated = { headers: { Authorization: "Bearer alice" } };
test("excluded providers reject direct API requests and report unavailable connections before provider work", async () => {
  await fixture(async (base, state) => {
    for (const path of ["mixcloud/search?q=long%20set", "mixcloud/resolve?url=https://mixcloud.com/dj/show/", "apple/search?q=song", "apple/resolve?url=https://music.apple.com/us/song/song/123", "apple/token", "APPLE/token"]) {
      const response = await fetch(`${base}/api/${path}`, authenticated);
      assert.equal(response.status, 403, path);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.deepEqual(state.calls, []);
    const response = await fetch(`${base}/api/music/connections`, authenticated);
    const connections = await response.json();
    assert.deepEqual(connections.apple, { configured: false });
    assert.deepEqual(connections.mixcloud, { configured: false });
    const config = await fetch(`${base}/api/config`, authenticated);
    assert.equal((await config.json()).music.appleMusicConfigured, false);
  });
});
test("music routes deny missing authentication before catalogs/accounts and prevent sensitive caching", async () => {
  await fixture(async (base, state) => {
    for (const path of ["youtube/search?q=mix", "youtube/live?id=aaaaaaaaaaa", "soundcloud/search?q=mix", "soundcloud/resolve?url=https://soundcloud.com/artist/song", "audius/search?q=mix", "audius/resolve?url=https://audius.co/creator/song", "audius/playback?id=a5aXGmz", "mixcloud/search?q=mix", "mixcloud/resolve?url=https://www.mixcloud.com/artist/show/", "spotify/search?q=mix", "spotify/resolve?url=abcdefghijk123456789012", "apple/search?q=mix", "apple/resolve?url=https://music.apple.com/us/song/song/123", "giphy", "music/connections", "spotify/token", "spotify/devices", "spotify/playback", "apple/token"]) {
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

test("an authenticated listener finds Audius picks and corrects an invalid source without stale catalog results", async () => {
  await fixture(async (base, state) => {
    assert.equal((await fetch(`${base}/api/audius/search?q=x`, authenticated)).status, 400);
    assert.equal((await fetch(`${base}/api/audius/resolve?url=https://evil.test/creator/song`, authenticated)).status, 400);
    assert.equal(state.calls.length, 0);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${base}/api/audius/search?q=public`, authenticated);
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).results[0].provider, "audius");
    }
    assert.equal(state.calls.filter(call => call.kind === "audius-search").length, 2);
    const resolved = await fetch(`${base}/api/audius/resolve?url=https://audius.co/creator/song`, authenticated);
    assert.equal(resolved.status, 200); assert.equal((await resolved.json()).result.id, "a5aXGmz");
    const connections = await fetch(`${base}/api/music/connections`, authenticated);
    assert.deepEqual((await connections.json()).audius, { configured: true });
  });
  await fixture(async (base, state) => {
    assert.equal((await fetch(`${base}/api/audius/search?q=public`, authenticated)).status, 503);
    assert.equal((await fetch(`${base}/api/audius/resolve?url=https://audius.co/creator/song`, authenticated)).status, 503);
    assert.deepEqual(state.calls, []);
  }, { audiusApi: undefined });
});

test("Audius playback requires the listener's current allowed room and rejects permission revoked during verification", async () => {
  let enabled = false, hold = false;
  let release!: () => void, began!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  const roomAuth = { headers: { ...authenticated.headers, "x-soundspin-room": "lounge" } };
  await fixture(async (base, state) => {
    assert.equal((await fetch(`${base}/api/audius/playback?id=a5aXGmz`, roomAuth)).status, 403);
    assert.equal((await fetch(`${base}/api/audius/playback?id=a5aXGmz&roomSlug=lounge`, authenticated)).status, 403);
    assert.deepEqual(state.calls, []);
    enabled = true;
    assert.equal((await fetch(`${base}/api/audius/playback?id=a5aXGmz&roomSlug=other-room`, roomAuth)).status, 400);
    assert.equal((await fetch(`${base}/api/audius/playback?id=invalid-id`, roomAuth)).status, 400);
    const allowed = await fetch(`${base}/api/audius/playback?id=a5aXGmz`, roomAuth);
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("cache-control"), "no-store");
    assert.deepEqual(await allowed.json(), { url: "https://api.audius.co/v1/tracks/a5aXGmz/stream?api_key=public-fixture" });
    hold = true;
    const pending = fetch(`${base}/api/audius/playback?id=a5aXGmz`, roomAuth);
    await started; enabled = false; release();
    const revoked = await pending;
    assert.equal(revoked.status, 403); assert.equal((await revoked.json()).url, undefined);
  }, {
    canUseProvider: async (_request, actor, provider, roomSlug) => enabled && actor === "alice" && provider === "audius" && roomSlug === "lounge",
    audiusApi: { configured: true, searchTracks: async () => [], resolveTrack: async () => { throw new Error("unused"); },
      playbackUrl: async (_id, signal) => { assert.ok(signal instanceof AbortSignal); if (hold) { began(); await gate; } return "https://api.audius.co/v1/tracks/a5aXGmz/stream?api_key=public-fixture"; } }
  });
  await fixture(async (base, state) => {
    assert.equal((await fetch(`${base}/api/audius/playback?id=a5aXGmz`, roomAuth)).status, 403);
    assert.deepEqual(state.calls, []);
  }, { canUseProvider: undefined });
});
test("Spotify requires current authorized room context before tokens, provider work, or connection metadata", async () => {
  let enabled = false;
  await fixture(async (base, state) => {
    for (const [method, path] of [["GET", "search?q=mix"], ["GET", "resolve?url=abcdefghij123456789012"], ["GET", "token"], ["GET", "devices"], ["GET", "playback"], ["POST", "playback"]]) {
      assert.equal((await fetch(`${base}/api/spotify/${path}`, { ...authenticated, method })).status, 403, path);
    }
    assert.equal((await fetch(`${base}/API/SPOTIFY/token`, authenticated)).status, 403);
    const connections = await fetch(`${base}/api/music/connections?roomSlug=lounge`, authenticated);
    assert.equal(connections.status, 200);
    assert.deepEqual((await connections.json()).spotify, { configured: false, connected: false, profile: null });
    assert.equal(state.calls.length, 0);
    enabled = true;
    assert.equal((await fetch(`${base}/api/spotify/token?roomSlug=another-room&userId=bob`, authenticated)).status, 403);
    assert.equal((await fetch(`${base}/api/spotify/token`, authenticated)).status, 403);
    assert.equal((await fetch(`${base}/api/spotify/token?roomSlug=lounge`, { headers: { ...authenticated.headers, "x-soundspin-room": "another-room" } })).status, 400);
    assert.equal((await fetch(`${base}/api/spotify/search?q=mix&roomSlug=lounge`, authenticated)).status, 200);
    assert.equal((await fetch(`${base}/api/spotify/token`, { headers: { ...authenticated.headers, "x-soundspin-room": "lounge" } })).status, 200);
    assert.deepEqual(state.calls.map(call => call.kind), ["spotify-search", "token"]);
    enabled = false;
    assert.equal((await fetch(`${base}/api/spotify/search?q=mix&roomSlug=lounge`, authenticated)).status, 403);
    assert.equal(state.calls.length, 2);
  }, { canUseSpotify: async (_request, actor, roomSlug) => enabled && actor === "alice" && roomSlug === "lounge" });
  await fixture(async (base, state) => {
    assert.equal((await fetch(`${base}/api/spotify/token?roomSlug=lounge`, authenticated)).status, 403);
    assert.deepEqual(state.calls, []);
    // Turning a room feature off must not prevent revoking one's own connection.
    assert.equal((await fetch(`${base}/api/spotify/connection`,{...authenticated,method:"DELETE"})).status,204);
    assert.deepEqual(state.calls,[{kind:"disconnect",value:"alice"}]);
  }, { canUseSpotify: undefined });
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
test("searching YouTube returns results when duration metadata stalls and later searches recover", { timeout: 5_000 }, async () => {
  let requests = 0;
  let durationCanceled = false;
  await fixture(async base => {
    const search = (query: string) => fetch(`${base}/api/youtube/search?q=${query}`, authenticated);
    const response = await search("mix");
    assert.equal(response.status, 200);
    const { results } = await response.json();
    assert.equal(results[0].id, "abcdefghijk");
    assert.equal(results[0].title, "Artist & Song");
    assert.equal(results[0].durationMs, undefined);
    assert.equal(durationCanceled, true);
    assert.equal(requests, 2);
    assert.deepEqual(await (await search("MIX")).json(), { results });
    assert.equal(requests, 2);

    const recovered = await search("another-mix");
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).results[0].durationMs, 180_000);
    assert.equal(requests, 4);
  }, { fetchImpl: async input => {
    requests++;
    if (new URL(String(input)).pathname.endsWith("/search")) return Response.json({ items: [{
      id: { videoId: "abcdefghijk" }, snippet: { title: "Artist &amp; Song", channelTitle: "Artist", thumbnails: {} }
    }] });
    if (requests === 2) return new Response(new ReadableStream({ cancel() { durationCanceled = true; } }));
    return Response.json({ items: [{ id: "abcdefghijk", contentDetails: { duration: "PT3M" } }] });
  } });
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


test("provider requests throttle one account before provider work while listeners sharing an IP can keep polling", async () => {
  await fixture(async (base, state) => {
    for (let index = 0; index < 60; index++) assert.equal((await fetch(`${base}/api/spotify/resolve?url=abcdefghij123456789012`, authenticated)).status, 200);
    const calls = state.calls.length;
    assert.equal((await fetch(`${base}/api/spotify/resolve?url=abcdefghij123456789012`, authenticated)).status, 429);
    assert.equal(state.calls.length, calls);
    // Another endpoint has its own limit; the same verified account remains authoritative.
    assert.equal((await fetch(`${base}/api/spotify/devices`, authenticated)).status, 200);
  });
  await fixture(async(base,state)=>{
    for(let listener=0;listener<5;listener++) {
      for(let poll=0;poll<40;poll++)assert.equal((await fetch(`${base}/api/spotify/playback`,{headers:{Authorization:`Bearer listener-${listener}`}})).status,200);
    }
    assert.equal(state.calls.filter(call=>call.kind==="spotify-request").length,200);
  },{getUserId:async request=>request.get("authorization")?.match(/^Bearer (listener-\d)$/)?.[1]??null});
});
