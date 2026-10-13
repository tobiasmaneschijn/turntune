import assert from "node:assert/strict";
import test from "node:test";
import { MixcloudApi } from "./mixcloud.js";
import { isMixcloudShowKey, mixcloudShowKey } from "../shared/mixcloud.js";
import { trackSchema } from "../shared/room-protocol.js";
import { libraryTrackSchema } from "./private-library.js";

const show = { key: "/test-dj/show-one/", name: "Recorded set", audio_length: 3600,
  pictures: { large: "https://thumbnailer.mixcloud.com/large.jpg" }, user: { name: "Uploader" } };

test("Mixcloud search uses the public API with bounds and normalizes show metadata", async () => {
  const requests: string[] = [];
  const api = new MixcloudApi((async (input, init) => {
    requests.push(String(input));
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return Response.json({ data: [show, { ...show, key: "/test-dj/" }, { ...show, audio_length: 0 },
      { ...show, key: "/test-dj/other/", name: "x".repeat(140), pictures: { large: "http://bad.test/image", medium: "https://thumbnailer.mixcloud.com/medium.jpg" } }] });
  }) as typeof fetch);
  const results = await api.searchTracks("recorded sets", 100);
  assert.equal(new URL(requests[0]).hostname, "api.mixcloud.com");
  assert.equal(new URL(requests[0]).pathname, "/search/");
  assert.equal(new URL(requests[0]).searchParams.get("type"), "cloudcast");
  assert.equal(new URL(requests[0]).searchParams.get("limit"), "12");
  assert.deepEqual(results[0], { provider: "mixcloud", id: show.key, title: "Recorded set", artist: "Uploader",
    thumbnail: "https://thumbnailer.mixcloud.com/large.jpg", duration: "1:00:00", durationMs: 3_600_000,
    permalinkUrl: "https://www.mixcloud.com/test-dj/show-one/" });
  assert.equal(results.length, 2);
  assert.equal(results[1].title.length, 120);
  assert.equal(results[1].thumbnail, "https://thumbnailer.mixcloud.com/medium.jpg");
});

test("Mixcloud resolution fixes the request hostname and checks canonical show identity", async () => {
  const requests: string[] = [];
  const api = new MixcloudApi((async (input, init) => {
    requests.push(String(input)); assert.ok(init?.signal);
    return Response.json(show);
  }) as typeof fetch);
  assert.equal((await api.resolveTrack("https://mixcloud.com/test-dj/show-one?utm_source=share")).id, show.key);
  assert.deepEqual(requests, ["https://api.mixcloud.com/test-dj/show-one/"]);
  for (const invalid of ["https://evil.test/test-dj/show-one/", "https://api.mixcloud.com/test-dj/show-one/", "http://mixcloud.com/test-dj/show-one/", "https://user:pass@mixcloud.com/test-dj/show-one/", "https://mixcloud.com:444/test-dj/show-one/", "https://mixcloud.com/test-dj/", "https://mixcloud.com/test-dj/show-one/embed-html/", "https://mixcloud.com/test-dj/%2fshow-one/", "https://mixcloud.com/ignored/../test-dj/show-one/", "//evil.test/test-dj/show-one/"]) {
    assert.equal(mixcloudShowKey(invalid), null, invalid);
    await assert.rejects(api.resolveTrack(invalid), /valid Mixcloud show URL/);
  }
  assert.equal(requests.length, 1);
  await assert.rejects(api.resolveTrack("/another/show/"), /not an available show/);
});

test("Mixcloud handles unavailable, malformed and oversized responses without catalog results", async () => {
  for (const response of [new Response("", { status: 404 }), new Response("{ invalid json"),
    new Response(" ".repeat(1_048_577)), Response.json({ key: show.key, name: "not a show" })]) {
    const api = new MixcloudApi((async () => response) as typeof fetch);
    await assert.rejects(api.resolveTrack(show.key), /Could not load|invalid response|oversized response|not an available show/);
  }
});

test("Mixcloud room and private library tracks require safe keys and a matching source URL", () => {
  const input = { provider: "mixcloud", providerId: show.key, title: show.name, permalinkUrl: `https://www.mixcloud.com${show.key}` };
  for (const schema of [trackSchema, libraryTrackSchema]) {
    assert.equal(schema.safeParse(input).success, true);
    assert.equal(schema.safeParse({ ...input, providerId: "/test-dj/../" }).success, false);
    assert.equal(schema.safeParse({ ...input, permalinkUrl: "https://evil.test/test-dj/show-one/" }).success, false);
    assert.equal(schema.safeParse({ ...input, permalinkUrl: "https://www.mixcloud.com/test-dj/another/" }).success, false);
    assert.equal(schema.safeParse({ ...input, permalinkUrl: undefined }).success, false);
  }
  assert.equal(isMixcloudShowKey(show.key), true);
  assert.equal(isMixcloudShowKey("/test-dj/show-one"), false);
});
