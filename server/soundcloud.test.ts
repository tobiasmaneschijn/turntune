import assert from "node:assert/strict";
import test from "node:test";
import { SoundCloudApi } from "./soundcloud.js";

test("searchTracks authenticates once, filters blocked tracks, and maps stable URNs", async () => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization") || undefined;
    requests.push({ url, authorization });

    if (url === "https://secure.soundcloud.com/oauth/token") {
      assert.match(authorization || "", /^Basic /);
      assert.equal(String(init?.body), "grant_type=client_credentials");
      return Response.json({ access_token: "app-token", refresh_token: "refresh-token", expires_in: 3600 });
    }

    assert.match(url, /^https:\/\/api\.soundcloud\.com\/tracks\?/);
    assert.equal(authorization, "OAuth app-token");
    return Response.json([
      {
        urn: "soundcloud:tracks:123",
        title: "Playable track",
        artwork_url: "https://i1.sndcdn.com/artworks-test.jpg",
        duration: 185000,
        permalink_url: "https://soundcloud.com/test/playable-track",
        access: "playable",
        streamable: true,
        user: { username: "Uploader" },
        publisher_metadata: { artist: "Release artist" }
      },
      {
        urn: "soundcloud:tracks:456",
        title: "Blocked track",
        permalink_url: "https://soundcloud.com/test/blocked-track",
        access: "blocked",
        streamable: false,
        user: { username: "Uploader" }
      }
    ]);
  }) as typeof fetch;

  const api = new SoundCloudApi("client-id", "client-secret", fetcher);
  const first = await api.searchTracks("test");
  const second = await api.searchTracks("another test");

  assert.deepEqual(first, [{
    provider: "soundcloud",
    id: "soundcloud:tracks:123",
    title: "Playable track",
    artist: "Uploader",
    thumbnail: "https://i1.sndcdn.com/artworks-test.jpg",
    duration: "3:05",
    durationMs: 185000,
    permalinkUrl: "https://soundcloud.com/test/playable-track"
  }]);
  assert.equal(second.length, 1);
  assert.equal(requests.filter(({ url }) => url.includes("/oauth/token")).length, 1);
  assert.equal(requests.filter(({ url }) => url.includes("/tracks?")).length, 2);
});
