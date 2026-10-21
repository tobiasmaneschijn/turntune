import assert from "node:assert/strict";
import test from "node:test";
import type { AppleMusicApi } from "../../integrations/apple-music.js";
import { resolveProviderMappings, resolveTrackMappings } from "./provider-mappings.js";
import { createServerProviderRegistry } from "./provider-registry.js";
import type { CatalogTrack } from "./music.js";
import type { SpotifyApi } from "../../integrations/spotify/spotify.js";

test("excluded providers cannot resolve sources or probe counterpart catalogs", async () => {
  const unavailable = new Proxy({}, { get() { assert.fail("Excluded catalog was accessed"); } });
  const spotify = { configured: false } as SpotifyApi;
  for (const input of [
    { provider: "mixcloud" as const, providerId: "/dj/show/", title: "DJ show" },
    { provider: "apple" as const, providerId: "123", title: "Song" }
  ]) await assert.rejects(resolveTrackMappings(input, spotify, unavailable as AppleMusicApi), /unavailable/);
  const result = await resolveTrackMappings({ provider: "youtube", providerId: "abcdefghijk", title: "Video" }, spotify, unavailable as AppleMusicApi);
  assert.deepEqual(Object.keys(result.mappings ?? {}), ["youtube"]);
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
  const input = { provider: "soundcloud" as const, providerId: "soundcloud:tracks:123", title: "Recording", artist: "Artist", durationMs: 180_000 };
  async function resolveWithFirst(first: "spotify" | "youtube") {
    const releases = {} as Record<"spotify" | "youtube", () => void>;
    const catalog = (provider: "spotify" | "youtube") => ({
      configured: () => true,
      findByIsrc: async () => undefined,
      searchTracks: () => new Promise<CatalogTrack[]>(resolve => {
        releases[provider] = () => resolve([{ provider, id: `${provider}-track`, title: input.title, artist: input.artist, durationMs: input.durationMs, isrc: `${provider}-isrc` }]);
      })
    });
    const providers = createServerProviderRegistry();
    providers.spotify.catalog = catalog("spotify"); providers.youtube.catalog = catalog("youtube");
    const pending = resolveProviderMappings(input, providers, undefined, { allowSpotify: true });
    releases[first]();
    await Promise.resolve();
    releases[first === "spotify" ? "youtube" : "spotify"]();
    return pending;
  }
  const first = await resolveWithFirst("spotify");
  const retried = await resolveWithFirst("youtube");
  assert.equal(first.canonicalId, "soundcloud:soundcloud:tracks:123");
  assert.equal(first.isrc, undefined);
  assert.deepEqual(Object.keys(first.mappings ?? {}), ["soundcloud"]);
  assert.deepEqual(retried, first);
});

test("verified source identity rejects a conflicting counterpart and accepts its corrected recording", async () => {
  const input = { provider: "youtube" as const, providerId: "abcdefghijk", title: "Recording", artist: "Artist", durationMs: 180_000 };
  let counterpartIsrc = "USABC7654321";
  const spotify = { configured: true, findByIsrc: async () => ({ provider: "spotify", id: "a".repeat(22), title: input.title, artist: input.artist, durationMs: input.durationMs, isrc: counterpartIsrc }) } as unknown as SpotifyApi;
  const providers = createServerProviderRegistry({ spotify });
  const options = { allowSpotify: true, verifiedSource: { track: input, isrc: "USABC1234567", duration: { durationVerified: true } } };
  const first = await resolveProviderMappings(input, providers, undefined, options);
  assert.equal(first.canonicalId, "isrc:USABC1234567");
  assert.equal(first.mappings?.spotify, undefined);
  counterpartIsrc = "USABC1234567";
  const retried = await resolveProviderMappings(input, providers, undefined, options);
  assert.equal(retried.canonicalId, first.canonicalId);
  assert.equal(retried.mappings?.spotify?.providerId, "a".repeat(22));
  assert.equal(retried.mappings?.spotify?.matchMethod, "isrc");
});
