import assert from "node:assert/strict";
import test from "node:test";
import type { AppleMusicApi } from "./apple-music.js";
import { resolveTrackMappings } from "./provider-mappings.js";
import type { SpotifyApi } from "./spotify.js";

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
