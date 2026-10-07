import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountMusicRoutes, type MusicRouteOptions } from "./music-routes.js";

async function fixture(run: (base: string, state: { calls: Array<{ kind: string; value?: string; path?: string; body?: unknown }>; unauthorizedOnce: boolean }) => Promise<void>) {
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
  mountMusicRoutes(app, options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, state); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const authenticated = { headers: { Authorization: "Bearer alice" } };
test("music routes deny missing authentication before catalogs/accounts and prevent sensitive caching", async () => {
  await fixture(async (base, state) => {
    for (const path of ["youtube/search?q=mix", "soundcloud/search?q=mix", "soundcloud/resolve?url=https://soundcloud.com/artist/song", "spotify/search?q=mix", "spotify/resolve?url=abcdefghijk123456789012", "apple/search?q=mix", "apple/resolve?url=https://music.apple.com/us/song/song/123", "giphy", "music/connections", "spotify/token", "spotify/devices", "spotify/playback", "apple/token"]) {
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
