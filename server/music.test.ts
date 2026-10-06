import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AppleMusicApi } from "./apple-music.js";
import {
  bestCatalogMatch,
  bestCertainCatalogMatch,
  catalogMatchScore,
  isCertainCatalogMatch,
  normalizeTrackText,
  formatDuration
} from "./music.js";
import { SpotifyApi } from "./spotify.js";
import { SpotifyAccounts } from "./spotify-accounts.js";
import type { Store } from "./store.js";
import type { MusicProviderConnection } from "./types.js";
import { resolveTrackMappings } from "./provider-mappings.js";

test("catalog matching favors the same title, artist, and duration", () => {
  const source = { title: "Midnight City (Official Audio)", artist: "M83", durationMs: 244_000 };
  const candidates = [
    { provider: "spotify" as const, id: "wrong", title: "Midnight", artist: "Another Artist", durationMs: 180_000 },
    { provider: "spotify" as const, id: "right", title: "Midnight City", artist: "M83", durationMs: 244_100 }
  ];
  assert.ok(catalogMatchScore(candidates[1], source) > catalogMatchScore(candidates[0], source));
  assert.equal(bestCatalogMatch(candidates, source)?.id, "right");
});

test("catalog matching preserves international titles and folds accented text", () => {
  assert.equal(normalizeTrackText("Beyoncé — Déjà Vu"), "beyonce deja vu");
  assert.equal(normalizeTrackText("夜に駆ける"), "夜に駆ける");
  assert.equal(isCertainCatalogMatch({ provider: "apple", id: "song", title: "夜に駆ける", artist: "YOASOBI", durationMs: 260_000 },
    { title: "夜に駆ける", artist: "YOASOBI", durationMs: 260_500 }), true);
  assert.equal(catalogMatchScore({ provider: "apple", id: "other", title: "群青", artist: "YOASOBI" },
    { title: "夜に駆ける", artist: "YOASOBI" }), 0.23);
});

test("empty normalized titles cannot produce a confident catalog match", () => {
  assert.equal(catalogMatchScore({ provider: "apple", id: "song", title: "Official Audio", artist: "Artist" },
    { title: "Music Video", artist: "Artist" }), 0);
  assert.equal(formatDuration(Infinity), undefined);
  assert.equal(formatDuration(NaN), undefined);
});

test("certain catalog matching rejects a base track for a remix or edit", () => {
  const baseTrack = {
    provider: "spotify" as const,
    id: "base",
    title: "Midnight City",
    artist: "M83",
    durationMs: 244_000
  };

  assert.equal(isCertainCatalogMatch(baseTrack, {
    title: "Midnight City (Eric Prydz Private Remix)",
    artist: "M83",
    durationMs: 244_100
  }), false);
  assert.equal(isCertainCatalogMatch(baseTrack, {
    title: "M83 - Midnight City (Radio Edit)",
    artist: "M83VEVO",
    durationMs: 244_100
  }), false);
});

test("certain catalog matching accepts only exact metadata with a close duration", () => {
  const exact = {
    provider: "spotify" as const,
    id: "exact",
    title: "Midnight City (Eric Prydz Remix)",
    artist: "M83",
    durationMs: 244_900
  };
  const wrongRemix = {
    ...exact,
    id: "wrong-remix",
    title: "Midnight City (Someone Else Remix)"
  };
  const tooLong = { ...exact, id: "too-long", durationMs: 247_500 };
  const source = {
    title: "M83 - Midnight City (Eric Prydz Remix) [Official Audio]",
    artist: "M83 - Topic",
    durationMs: 244_000
  };

  assert.equal(bestCertainCatalogMatch([wrongRemix, tooLong, exact], source)?.id, "exact");
  assert.equal(bestCertainCatalogMatch([wrongRemix, tooLong], source), undefined);
  assert.equal(bestCertainCatalogMatch([exact], { ...source, durationMs: undefined }), undefined);
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

test("simultaneous Spotify catalog searches share the app-token request", async () => {
  let tokenRequests = 0;
  const spotify = new SpotifyApi("client", "secret", "US", async (input) => {
    if (String(input).includes("accounts.spotify.com")) {
      tokenRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ access_token: "app-token", token_type: "Bearer", expires_in: 3600 });
    }
    return Response.json({ tracks: { items: [] } });
  });
  await Promise.all([spotify.searchTracks("one"), spotify.searchTracks("two"), spotify.searchTracks("three")]);
  assert.equal(tokenRequests, 1);
});

function accountStore() {
  let connection: MusicProviderConnection | null = null;
  return {
    get connection() { return connection; },
    store: {
      getMusicConnection: async () => connection,
      saveMusicConnection: async (saved: Omit<MusicProviderConnection, "createdAt" | "updatedAt">) => {
        connection = { ...saved, createdAt: "created", updatedAt: "updated" };
      },
      deleteMusicConnection: async () => { connection = null; }
    } as unknown as Store
  };
}

test("concurrent Spotify access requests refresh once and retain rotated credentials", async () => {
  const storage = accountStore();
  let refreshRequests = 0;
  let beginRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { beginRefresh = resolve; });
  let finishRefresh!: () => void;
  const refreshFinished = new Promise<void>((resolve) => { finishRefresh = resolve; });
  const spotify = new SpotifyApi("client", "secret", "US", async (_input, init) => {
    const body = init?.body as URLSearchParams;
    if (body.get("grant_type") === "authorization_code") {
      return Response.json({ access_token: "first", refresh_token: "refresh-1", expires_in: 1 });
    }
    refreshRequests += 1;
    assert.equal(body.get("refresh_token"), refreshRequests === 1 ? "refresh-1" : "refresh-2");
    beginRefresh();
    await refreshFinished;
    return Response.json({ access_token: "refreshed", refresh_token: "refresh-2", expires_in: 3600 });
  });
  const accounts = new SpotifyAccounts(storage.store, spotify, "encryption-key");
  await accounts.connect("user", "code", "http://localhost/callback");
  const first = accounts.getAccessToken("user");
  const second = accounts.getAccessToken("user");
  await refreshStarted;
  assert.equal(refreshRequests, 1);
  finishRefresh();
  assert.deepEqual(await Promise.all([first, second]), ["refreshed", "refreshed"]);
  accounts.invalidate("user");
  assert.equal(await accounts.getAccessToken("user"), "refreshed");
  assert.equal(refreshRequests, 2);
});

test("disconnecting Spotify cancels an in-flight refresh and prevents new token requests", async () => {
  const storage = accountStore();
  let beginRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { beginRefresh = resolve; });
  let finishRefresh!: () => void;
  const refreshFinished = new Promise<void>((resolve) => { finishRefresh = resolve; });
  const spotify = new SpotifyApi("client", "secret", "US", async (_input, init) => {
    const body = init?.body as URLSearchParams;
    if (body.get("grant_type") === "authorization_code") {
      return Response.json({ access_token: "first", refresh_token: "refresh-1", expires_in: 1 });
    }
    beginRefresh();
    await refreshFinished;
    return Response.json({ access_token: "late-access", refresh_token: "late-refresh", expires_in: 3600 });
  });
  const accounts = new SpotifyAccounts(storage.store, spotify, "encryption-key");
  await accounts.connect("user", "code", "http://localhost/callback");
  const refresh = accounts.getAccessToken("user");
  await refreshStarted;
  const disconnect = accounts.disconnect("user");
  await assert.rejects(accounts.getAccessToken("user"), /being updated/);
  const rejected = assert.rejects(refresh, /connection changed/);
  finishRefresh();
  await rejected;
  await disconnect;
  assert.equal(storage.connection, null);
  await assert.rejects(accounts.getAccessToken("user"), /Connect Spotify first/);
});

test("disconnect queued during Spotify connection leaves no stored or cached credentials", async () => {
  const storage = accountStore();
  let beginConnect!: () => void;
  const connectionStarted = new Promise<void>((resolve) => { beginConnect = resolve; });
  let finishConnect!: () => void;
  const connectionFinished = new Promise<void>((resolve) => { finishConnect = resolve; });
  const spotify = new SpotifyApi("client", "secret", "US", async () => {
    beginConnect();
    await connectionFinished;
    return Response.json({ access_token: "first", refresh_token: "refresh-1", expires_in: 3600 });
  });
  const accounts = new SpotifyAccounts(storage.store, spotify, "encryption-key");
  const connect = accounts.connect("user", "code", "http://localhost/callback");
  await connectionStarted;
  const disconnect = accounts.disconnect("user");
  finishConnect();
  await Promise.all([connect, disconnect]);
  assert.equal(storage.connection, null);
  await assert.rejects(accounts.getAccessToken("user"), /Connect Spotify first/);
});

test("Apple Music counterpart mapping rejects a different remix and accepts exact metadata", async () => {
  const source = { provider: "soundcloud" as const, providerId: "soundcloud:tracks:123", title: "Midnight City (Club Remix)", artist: "M83", durationMs: 244_000 };
  const candidate = { provider: "apple" as const, id: "base-recording", title: "Midnight City", artist: "M83", durationMs: 244_000 };
  const spotify = { configured: false } as SpotifyApi;
  const apple = { configured: true, searchTracks: async () => [candidate] } as unknown as AppleMusicApi;
  assert.equal((await resolveTrackMappings(source, spotify, apple)).mappings?.apple, undefined);
  const exactApple = { configured: true, searchTracks: async () => [{ ...candidate, id: "exact-remix", title: source.title }] } as unknown as AppleMusicApi;
  const resolved = await resolveTrackMappings(source, spotify, exactApple);
  assert.equal(resolved.mappings?.apple?.providerId, "exact-remix");
  assert.equal(resolved.mappings?.apple?.matchMethod, "exact-metadata");
});
