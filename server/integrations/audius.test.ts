import assert from "node:assert/strict";
import test from "node:test";
import { AudiusApi } from "./audius.js";
import { createServerProviderRegistry } from "../features/music/provider-registry.js";
import { resolveProviderMappings } from "../features/music/provider-mappings.js";

const track = {
  id: "a5aXGmz", title: "A public recording", duration: 170, permalink: "/creator/public-recording",
  user: { name: "Creator", handle: "creator" },
  is_streamable: true, is_available: true, is_delete: false, is_unlisted: false,
  is_stream_gated: false, is_scheduled_release: false, access: { stream: true, download: false },
  allowed_api_keys: null, access_authorities: null, stream_conditions: null,
  artwork: {
    "150x150": "https://creatornode.audius.co/content/cover/150x150.jpg",
    "480x480": "https://creatornode.audius.co/content/cover/480x480.jpg",
    "1000x1000": "https://creatornode.audius.co/content/cover/1000x1000.jpg",
    mirrors: ["https://cn0.mainnet.audiusindex.org", "https://audius-creator-1.theblueprint.xyz"]
  }
};

test("searching Audius returns public recordings with creator credit and artwork variants and mirrors", async () => {
  const requests: URL[] = [];
  const api = new AudiusApi("public-api-key", "server-only-bearer", async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.origin, "https://api.audius.co");
    assert.equal(new Headers(init?.headers).get("x-api-key"), "public-api-key");
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    assert.ok(init?.signal instanceof AbortSignal); assert.equal(init?.redirect, "error");
    return Response.json({ data: [track,
      { ...track, is_stream_gated: true }, { ...track, is_unlisted: true },
      { ...track, allowed_api_keys: ["public-api-key"] }, { ...track, access_authorities: ["authority"] },
      { ...track, access: { stream: false } }, { ...track, is_available: false },
      { ...track, is_delete: true }, { ...track, is_scheduled_release: true },
      { ...track, stream_conditions: { usdc_purchase: { price: 100 } } },
      { ...track, is_stream_gated: undefined }, { ...track, duration: 0 }
    ] });
  });
  const results = await api.searchTracks(" public & music ", 100);
  assert.equal(requests[0].pathname, "/v1/tracks/search");
  assert.equal(requests[0].searchParams.get("query"), "public & music");
  assert.equal(requests[0].searchParams.get("limit"), "12");
  assert.equal(requests[0].searchParams.get("includePurchaseable"), "false");
  assert.equal(results.length, 1);
  assert.equal(results[0].artist, "Creator"); assert.equal(results[0].durationMs, 170_000);
  assert.equal(results[0].permalinkUrl, "https://audius.co/creator/public-recording");
  assert.equal(results[0].thumbnail, track.artwork["480x480"]);
  assert.deepEqual(results[0].artworkSources, track.artwork);
  assert.doesNotMatch(JSON.stringify(results), /server-only-bearer|public-api-key/);
});

test("resolving an Audius track accepts only canonical pages and keeps credentials on the official API", async () => {
  const requests: string[] = [];
  const api = new AudiusApi("public-api-key", "server-only-bearer", async (input, init) => {
    requests.push(String(input));
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new URL(String(input)).pathname === "/v1/resolve"
      ? new Response(null, { status: 302, headers: { location: `/v1/tracks/${track.id}` } })
      : Response.json({ data: track });
  });
  const resolved = await api.resolveTrack("https://audius.co/creator/public-recording?utm_source=friend#play");
  assert.equal(resolved.id, track.id);
  assert.equal(new URL(requests[0]).searchParams.get("url"), "https://audius.co/creator/public-recording");
  assert.equal(requests[1], `https://api.audius.co/v1/tracks/${track.id}`);
  for (const url of ["http://audius.co/creator/recording", "https://audius.co.evil.test/creator/recording", "https://user:pass@audius.co/creator/recording", "https://audius.co/creator", "https://audius.co/creator/playlist/set", "https://audius.co/creator/album/set", "https://audius.co/creator/%2frecording"]) {
    await assert.rejects(api.resolveTrack(url), /valid Audius track URL/);
  }
  assert.equal(requests.length, 2);
  const mismatched = new AudiusApi("public-api-key", undefined, async () => Response.json({ data: { ...track, permalink: "/creator/different-recording" } }));
  await assert.rejects(mismatched.resolveTrack(resolved.permalinkUrl!), /different recording/);
  const redirecting = new AudiusApi("public-api-key", "server-only-bearer", async () => new Response(null, { status: 302, headers: { location: "https://evil.test/v1/tracks/abc" } }));
  await assert.rejects(redirecting.resolveTrack(resolved.permalinkUrl!), /unsafe redirect/);
});

test("queueing a public Audius recording verifies its source and rechecks access before playback", async () => {
  let gated = false, mismatched = false, calls = 0;
  const api = new AudiusApi("public-api-key", "server-only-bearer", async (input, init) => {
    calls++; assert.equal(new URL(String(input)).pathname, `/v1/tracks/${track.id}`);
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return Response.json({ data: { ...track, id: mismatched ? "otherId" : track.id, is_stream_gated: gated } });
  });
  const source = { provider: "audius" as const, providerId: track.id, title: "Unverified title", durationMs: 1 };
  const providers = createServerProviderRegistry({ audius: api });
  const verified = await resolveProviderMappings(source, providers);
  assert.equal(verified.title, track.title);
  assert.deepEqual(verified.artworkSources, track.artwork);
  assert.deepEqual(verified.mappings?.audius?.artworkSources, track.artwork);
  assert.equal(verified.durationMs, 170_000); assert.equal(verified.durationVerified, true); assert.equal(verified.isLive, false);
  const stream = new URL(await api.playbackUrl(track.id));
  assert.equal(stream.origin, "https://api.audius.co");
  assert.equal(stream.pathname, `/v1/tracks/${track.id}/stream`);
  assert.deepEqual([...stream.searchParams.keys()], ["api_key"]);
  assert.equal(stream.searchParams.get("api_key"), "public-api-key");
  assert.doesNotMatch(stream.href, /server-only-bearer/);
  gated = true;
  await assert.rejects(api.playbackUrl(track.id), /not publicly playable/);
  await assert.rejects(resolveProviderMappings(source, providers), /not publicly playable/);
  gated = false; mismatched = true;
  await assert.rejects(providers.audius.resolveSource(source, new AbortController().signal), /not publicly playable/);
  const before = calls;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.getTrack(track.id, controller.signal));
  assert.equal(calls, before);
  const malformed = new AudiusApi("public-api-key", undefined, async () => Response.json({ data: null }));
  await assert.rejects(malformed.getTrack(track.id), /not publicly playable/);
});
