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
