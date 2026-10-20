import assert from "node:assert/strict";
import test from "node:test";
import type { AppleMusicApi } from "../../integrations/apple-music.js";
import { resolveTrackMappings } from "./provider-mappings.js";
import type { SpotifyApi } from "../../integrations/spotify/spotify.js";

test("Mixcloud shows keep source playback without matching individual songs", async () => {
  const unavailable = new Proxy({}, { get() { throw new Error("Song catalogs must not be accessed for a show"); } });
  const result = await resolveTrackMappings({ provider: "mixcloud", providerId: "/dj/show/", title: "DJ show", artist: "DJ" },
    unavailable as SpotifyApi, unavailable as AppleMusicApi);
  assert.equal(result.canonicalId, "mixcloud:/dj/show/");
  assert.equal(result.isrc, undefined);
  assert.deepEqual(result.mappings, { mixcloud: { providerId: "/dj/show/", permalinkUrl: undefined, artworkUrl: undefined, matchMethod: "source" } });
});

test("disabled Spotify cannot resolve source tracks or probe counterpart catalogs", async () => {
  let spotifyCalls = 0;
  const spotify = { configured: true, searchTracks: async () => { spotifyCalls++; return []; }, getTrack: async () => { spotifyCalls++; return {}; } } as unknown as SpotifyApi;
  const apple = { configured: false } as AppleMusicApi;
  const input = { provider: "youtube" as const, providerId: "abcdefghijk", title: "Recording" };
  const result = await resolveTrackMappings(input, spotify, apple);
  assert.equal(result.mappings?.spotify, undefined);
  await assert.rejects(resolveTrackMappings({ ...input, provider: "spotify", providerId: "a".repeat(22) }, spotify, apple), /Spotify is disabled/);
  assert.equal(spotifyCalls, 0);
  await resolveTrackMappings(input, spotify, apple, undefined, { allowSpotify: true });
  assert.equal(spotifyCalls, 1);
});

test("conflicting catalog recordings keep source playback regardless of response order", async () => {
  const input = { provider: "youtube" as const, providerId: "abcdefghijk", title: "Recording", artist: "Artist", durationMs: 180_000 };
  async function resolveWithFirst(first: "spotify" | "apple") {
    const releases = {} as Record<"spotify" | "apple", () => void>;
    const catalog = (provider: "spotify" | "apple") => ({
      configured: true,
      searchTracks: () => new Promise(resolve => {
        releases[provider] = () => resolve([{ provider, id: `${provider}-track`, title: input.title, artist: input.artist, durationMs: input.durationMs, isrc: `${provider}-isrc` }]);
      })
    });
    const pending = resolveTrackMappings(input, catalog("spotify") as unknown as SpotifyApi, catalog("apple") as unknown as AppleMusicApi, undefined, { allowSpotify: true });
    releases[first]();
    await Promise.resolve();
    releases[first === "spotify" ? "apple" : "spotify"]();
    return pending;
  }
  const first = await resolveWithFirst("spotify");
  const retried = await resolveWithFirst("apple");
  assert.equal(first.canonicalId, "youtube:abcdefghijk");
  assert.equal(first.isrc, undefined);
  assert.deepEqual(Object.keys(first.mappings ?? {}), ["youtube"]);
  assert.deepEqual(retried, first);
});

test("verified source identity rejects a conflicting counterpart and accepts its corrected recording", async () => {
  const input = { provider: "spotify" as const, providerId: "a".repeat(22), title: "Recording", artist: "Artist", durationMs: 180_000 };
  const spotify = { configured: true, getTrack: async () => ({ provider: "spotify", id: input.providerId, title: input.title, artist: input.artist, durationMs: input.durationMs, isrc: "USABC1234567" }) } as unknown as SpotifyApi;
  let counterpartIsrc = "USABC7654321";
  const apple = { configured: true, findByIsrc: async () => ({ provider: "apple", id: "123", title: input.title, artist: input.artist, durationMs: input.durationMs, isrc: counterpartIsrc }) } as unknown as AppleMusicApi;
  const first = await resolveTrackMappings(input, spotify, apple, undefined, { allowSpotify: true });
  assert.equal(first.canonicalId, "isrc:USABC1234567");
  assert.equal(first.mappings?.apple, undefined);
  counterpartIsrc = "USABC1234567";
  const retried = await resolveTrackMappings(input, spotify, apple, undefined, { allowSpotify: true });
  assert.equal(retried.canonicalId, first.canonicalId);
  assert.equal(retried.mappings?.apple?.providerId, "123");
  assert.equal(retried.mappings?.apple?.matchMethod, "isrc");
});
