import assert from "node:assert/strict";
import test from "node:test";
import { createSavedSetResolver, resolveSavedSet, SetImportRegistry } from "./saved-set.js";
import type { SpotifyApi } from "../../integrations/spotify/spotify.js";
import type { AppleMusicApi } from "../../integrations/apple-music.js";
import type { SoundCloudApi } from "../../integrations/soundcloud.js";
import type { Room } from "../../types.js";
import { createServerProviderRegistry } from "./provider-registry.js";
const track = { provider: "youtube" as const, providerId: "dQw4w9WgXcQ", title: "Saved title" };
const room = () => ({ id: "test-room" }) as Room;
test("saved Mixcloud shows are verified and keep their source metadata and mapping", async () => {
  let requested = "";
  const resolve = createSavedSetResolver({ spotify: { configured: false } as SpotifyApi, appleMusic: { configured: false } as AppleMusicApi,
    soundCloud: { configured: false } as SoundCloudApi, fetchImpl: (async (input, init) => {
      requested = String(input); assert.ok(init?.signal);
      return Response.json({ key: "/dj/show/", name: "Current show", audio_length: 3600, user: { name: "Uploader" } });
    }) as typeof fetch });
  const input = { provider: "mixcloud" as const, providerId: "/dj/show/", title: "Old title", permalinkUrl: "https://www.mixcloud.com/dj/show/" };
  const result = await resolve(input, new AbortController().signal);
  assert.equal(requested, "https://api.mixcloud.com/dj/show/");
  assert.equal(result.title, "Current show"); assert.equal(result.artist, "Uploader");
  assert.equal(result.durationMs, 3_600_000);
  assert.deepEqual(Object.keys(result.mappings || {}), ["mixcloud"]);
  await assert.rejects(resolve({ ...input, providerId: "/dj/different/" }, new AbortController().signal), /different show/);
});

test("saved source verification uses its registered provider and reuses verified metadata", async () => {
  let sourceCalls = 0;
  const providers = createServerProviderRegistry({ soundCloud: { configured: true, resolveTrack: async () => { throw new Error("Another provider must not handle this source"); } } });
  providers.spotify = {
    resolveSource: async (input, signal) => {
      signal.throwIfAborted();
      sourceCalls++;
      return { track: { ...input, title: "Verified recording", durationMs: 180_000 }, isrc: "USABC1234567", mapping: { providerId: "a".repeat(22), matchMethod: "source" }, duration: { durationMs: 180_000, durationVerified: true, isLive: false } };
    },
    catalog: { configured: () => true, findByIsrc: async () => undefined, searchTracks: async () => [] }
  };
  const resolve = createSavedSetResolver({ providers, allowSpotify: true });
  const result = await resolve({ provider: "spotify", providerId: "5bJ1DrEM4hNCafcDd1oxHx", title: "Saved title" }, new AbortController().signal);
  assert.equal(sourceCalls, 1);
  assert.equal(result.title, "Verified recording");
  assert.equal(result.canonicalId, "isrc:USABC1234567");
  assert.equal(result.mappings?.spotify?.providerId, "a".repeat(22));
  assert.equal(result.durationVerified, true);
  assert.equal(result.durationMs, 180_000);
});
test("set verification preserves intended order and explains every unavailable source", async () => {
  const inputs = [track, { ...track, title: "Unavailable" }, { ...track, title: "Third" }];
  const result = await resolveSavedSet(inputs, async (input) => {
    if (input.title === "Unavailable") throw new Error("No longer available");
    if (input.title === "Saved title") await new Promise((resolve) => setTimeout(resolve, 10));
    return input;
  });
  assert.deepEqual(result.tracks.map((item) => item.title), ["Saved title", "Third"]);
  assert.deepEqual(result.skipped, [{ title: "Unavailable", reason: "No longer available" }]);
});
test("outer set budget ignores late source results rather than appending them later", async () => {
  let finished = false;
  const result = await resolveSavedSet([track], async () => { await new Promise((resolve) => setTimeout(resolve, 30)); finished = true; return track; }, 5);
  assert.equal(result.tracks.length, 0); assert.equal(result.skipped.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(finished, true); assert.equal(result.tracks.length, 0);
});
test("source verifier uses canonical URLs and rejects unavailable or mismatched SoundCloud links", async () => {
  let requested = ""; let calls = 0;
  const spotify = { configured: false } as SpotifyApi;
  const appleMusic = { configured: false } as AppleMusicApi;
  const soundCloud = { configured: true, resolveTrack: async () => { calls++; return { id: "soundcloud:tracks:999", title: "Wrong recording" }; } } as unknown as SoundCloudApi;
  const resolve = createSavedSetResolver({ spotify, appleMusic, soundCloud, allowSpotify: true, fetchImpl: (async (url) => { requested = String(url); return new Response(JSON.stringify({ title: "Current source title", author_name: "Current artist" }), { status: 200 }); }) as typeof fetch });
  const result = await resolve(track, new AbortController().signal);
  assert.equal(result.title, "Current source title"); assert.equal(result.artist, "Current artist");
  assert.equal(new URL(requested).searchParams.get("url"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await assert.rejects(resolve({ provider: "spotify", providerId: "5bJ1DrEM4hNCafcDd1oxHx", title: "Spotify" }, new AbortController().signal), /verification is unavailable/);
  await assert.rejects(resolve({ provider: "soundcloud", providerId: "soundcloud:tracks:1", title: "SoundCloud", permalinkUrl: "https://soundcloud.com.evil.test/path" }, new AbortController().signal), /source link is invalid/);
  assert.equal(calls, 0);
  await assert.rejects(resolve({ provider: "soundcloud", providerId: "soundcloud:tracks:1", title: "SoundCloud", permalinkUrl: "https://soundcloud.com/artist/track" }, new AbortController().signal), /different recording/);
  const unavailable = createSavedSetResolver({ spotify, appleMusic, soundCloud, fetchImpl: (async () => new Response("", { status: 404 })) as typeof fetch });
  await assert.rejects(unavailable(track, new AbortController().signal), /unavailable/);
});
test("import UUID coalesces concurrency, binds set identity, and retains committed state after persistence failure", async () => {
  const registry = new SetImportRegistry(); const state = room(); let appends = 0;
  const summary = { added: 2, skipped: [], started: false };
  const operation = async (commit: (value: typeof summary) => void) => { appends++; commit(summary); throw new Error("Database unavailable after append"); };
  const first = registry.run(state, "alice", "request-id", "set-1", operation);
  await assert.rejects(first, /Database unavailable/);
  const replay = await registry.run(state, "alice", "request-id", "set-1", async () => { appends++; return summary; });
  assert.deepEqual(replay, summary); assert.equal(appends, 1);
  assert.throws(() => registry.run(state, "alice", "request-id", "set-2", async () => summary), /different saved set/);
  await registry.run(state, "bob", "request-id", "set-1", async () => { appends++; return summary; });
  assert.equal(appends, 2);
  let executions = 0;
  const pending = () => registry.run(state, "alice", "other-request", "set-1", async () => { executions++; await new Promise((resolve) => setTimeout(resolve, 5)); return summary; });
  await Promise.all([pending(), pending()]); assert.equal(executions, 1);
});

test("source verifier rejects malformed and oversized remote metadata before it can enter room state", async () => {
  for (const metadata of [null, { title: { unexpected: "object" } }, { title: "x".repeat(121) }, { title: "Valid title", author_name: 123 }]) {
    const resolve = createSavedSetResolver({ spotify: { configured: false } as SpotifyApi, appleMusic: { configured: false } as AppleMusicApi, soundCloud: { configured: false } as SoundCloudApi, fetchImpl: (async () => new Response(JSON.stringify(metadata), { status: 200 })) as typeof fetch });
    await assert.rejects(resolve(track, new AbortController().signal), /invalid or oversized metadata/);
  }
});
