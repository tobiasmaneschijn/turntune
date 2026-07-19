import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AppleMusicApi } from "./apple-music.js";
import { bestCatalogMatch, catalogMatchScore } from "./music.js";
import { SpotifyApi } from "./spotify.js";
import { SpotifyAccounts } from "./spotify-accounts.js";
import type { Store } from "./store.js";
import type { MusicProviderConnection } from "./types.js";

test("catalog matching favors the same title, artist, and duration", () => {
  const source = { title: "Midnight City (Official Audio)", artist: "M83", durationMs: 244_000 };
  const candidates = [
    { provider: "spotify" as const, id: "wrong", title: "Midnight", artist: "Another Artist", durationMs: 180_000 },
    { provider: "spotify" as const, id: "right", title: "Midnight City", artist: "M83", durationMs: 244_100 }
  ];
  assert.ok(catalogMatchScore(candidates[1], source) > catalogMatchScore(candidates[0], source));
  assert.equal(bestCatalogMatch(candidates, source)?.id, "right");
});

test("Spotify catalog adapter reuses its app token and maps tracks", async () => {
  let tokenRequests = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("accounts.spotify.com")) {
      tokenRequests += 1;
      return Response.json({ access_token: "app-token", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes("/search?")) {
      assert.match(url, /market=US/);
      return Response.json({ tracks: { items: [{
        id: "1234567890123456789012",
        uri: "spotify:track:1234567890123456789012",
        name: "Midnight City",
        duration_ms: 244_000,
        external_ids: { isrc: "FRS711100560" },
        external_urls: { spotify: "https://open.spotify.com/track/1234567890123456789012" },
        artists: [{ name: "M83" }],
        album: { images: [{ url: "https://i.scdn.co/art.jpg" }] }
      }] } });
    }
    return Response.json({ error: { message: "unexpected request" } }, { status: 500 });
  };
  const spotify = new SpotifyApi("client", "secret", "US", fetcher);
  const first = await spotify.searchTracks("Midnight City");
  const second = await spotify.searchTracks("M83");
  assert.equal(tokenRequests, 1);
  assert.equal(first[0].isrc, "FRS711100560");
  assert.equal(second[0].artist, "M83");
});

test("Apple Music adapter signs a developer token and maps catalog results", async () => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const fetcher: typeof fetch = async (input, init) => {
    assert.match(String(input), /\/v1\/catalog\/us\/search\?/);
    assert.match(String(input), /types=songs/);
    assert.match(String((init?.headers as Record<string, string>).Authorization), /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    return Response.json({ results: { songs: { data: [{
      id: "1613600188",
      attributes: {
        name: "Backseat",
        artistName: "Beach Bunny",
        durationInMillis: 221_000,
        isrc: "USQE92100257",
        url: "https://music.apple.com/us/album/backseat/1613600183?i=1613600188",
        artwork: { url: "https://is1-ssl.mzstatic.com/image/{w}x{h}.jpg" }
      }
    }] } } });
  };
  const apple = new AppleMusicApi("TEAM", "KEY", pem, "us", fetcher);
  const results = await apple.searchTracks("Backseat");
  assert.equal(results[0].id, "1613600188");
  assert.equal(results[0].thumbnail, "https://is1-ssl.mzstatic.com/image/600x600.jpg");
  assert.equal(results[0].isrc, "USQE92100257");
});

test("Spotify account refresh tokens are encrypted at rest and can be refreshed", async () => {
  let saved: MusicProviderConnection | null = null;
  const store = {
    getMusicConnection: async () => saved,
    saveMusicConnection: async (connection: Omit<MusicProviderConnection, "createdAt" | "updatedAt">) => {
      saved = { ...connection, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    },
    deleteMusicConnection: async () => { saved = null; }
  } as unknown as Store;
  const fetcher: typeof fetch = async (_input, init) => {
    const body = init?.body as URLSearchParams;
    return body.get("grant_type") === "authorization_code"
      ? Response.json({ access_token: "first-access", refresh_token: "refresh-secret", token_type: "Bearer", expires_in: 1, scope: "streaming" })
      : Response.json({ access_token: "refreshed-access", token_type: "Bearer", expires_in: 3600, scope: "streaming" });
  };
  const spotify = new SpotifyApi("client", "secret", "US", fetcher);
  const accounts = new SpotifyAccounts(store, spotify, "test-encryption-key");
  await accounts.connect("user-id", "code", "http://localhost/callback");
  const stored = saved as MusicProviderConnection | null;
  assert.ok(stored);
  assert.equal(stored.refreshTokenCiphertext.includes("refresh-secret"), false);
  accounts.invalidate("user-id");
  assert.equal(await accounts.getAccessToken("user-id"), "refreshed-access");
});
