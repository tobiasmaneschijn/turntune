import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { configureTelemetry, type MetricOptions, type MetricType } from "../../shared/observability.js";
import { providerJson, readBoundedJson } from "./provider-http.js";
import { GiphyApi } from "./giphy.js";
import { SpotifyApi } from "./spotify/spotify.js";
import { AppleMusicApi } from "./apple-music.js";
import { SoundCloudApi } from "./soundcloud.js";
import { createSavedSetResolver, resolveSavedSet } from "../features/music/saved-set.js";

function captureProviderMetrics(t: TestContext) {
  const metrics: Array<{ type: MetricType; name: string; value: number; options: MetricOptions }> = [];
  const restore = configureTelemetry({ captureError() {}, log() {}, async flush() {},
    metric(type, name, value, options) { if (name.startsWith("provider.request.")) metrics.push({ type, name, value, options }); }
  });
  t.after(restore);
  return metrics;
}

test("provider JSON bounds announced and streamed bytes and cancels the reader", async () => {
  let canceled = 0;
  const body = () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(101)); }, cancel() { canceled++; } });
  await assert.rejects(readBoundedJson(new Response(body(), { headers: { "content-length": "101" } }), 100), /oversized/);
  await assert.rejects(readBoundedJson(new Response(body()), 100), /oversized/);
  assert.equal(canceled, 2);
});

test("a provider deadline covers a body that never completes and caller abort reaches GIPHY fetch", async t => {
  const metrics = captureProviderMetrics(t);
  let canceled = false;
  await assert.rejects(providerJson("giphy", async () => new Response(new ReadableStream({ cancel() { canceled = true; } })), "https://api.giphy.com/fixture", {}, { timeoutMs: 20 }), /timeout|aborted/i);
  assert.equal(canceled, true);
  let fetchSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const api = new GiphyApi("fixture", async (_input, init) => {
    fetchSignal = init!.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => fetchSignal!.addEventListener("abort", () => reject(fetchSignal!.reason), { once: true }));
  });
  const pending = api.gifs("query", controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(fetchSignal?.aborted, true);
  assert.deepEqual(metrics.filter(metric => metric.name === "provider.request.results").map(metric => metric.options.attributes), [
    { operation: "provider.request", provider: "giphy", status: 200, outcome: "timeout", reason: "network" },
    { operation: "provider.request", provider: "giphy", outcome: "canceled", reason: "client" }
  ]);
});

test("saved-set timeout aborts the actual Spotify token/source connection", async () => {
  let fetchSignal: AbortSignal | undefined;
  const spotify = new SpotifyApi("fixture", "secret", "US", async (_input, init) => {
    fetchSignal = init!.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => fetchSignal!.addEventListener("abort", () => reject(fetchSignal!.reason), { once: true }));
  });
  const resolve = createSavedSetResolver({ spotify, appleMusic: new AppleMusicApi(undefined, undefined, undefined), soundCloud: new SoundCloudApi(), allowSpotify: true });
  const result = await resolveSavedSet([{ provider: "spotify", providerId: "abcdefghij123456789012", title: "Recording" }], resolve, 25);
  assert.equal(result.tracks.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(fetchSignal?.aborted, true);
});

test("per-provider admission remains bounded during stalled concurrent requests", async t => {
  const metrics = captureProviderMetrics(t);
  const controllers = Array.from({ length: 12 }, () => new AbortController());
  const pending = controllers.map(controller => providerJson("apple", async (_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true })), "https://api.music.apple.com/fixture", { signal: controller.signal }));
  await assert.rejects(providerJson("apple", async () => Response.json({}), "https://api.music.apple.com/fixture"), /capacity/);
  controllers.forEach(controller => controller.abort());
  await Promise.allSettled(pending);
  assert.deepEqual((await providerJson("apple", async () => Response.json({ ok: true }), "https://api.music.apple.com/fixture")).payload, { ok: true });
  const results = metrics.filter(metric => metric.name === "provider.request.results");
  assert.equal(metrics.filter(metric => metric.name === "provider.request.attempts").length, 14);
  assert.equal(results.length, 14);
  assert.equal(results.filter(metric => metric.options.attributes?.outcome === "canceled").length, 12);
  assert.deepEqual(results[0].options.attributes, { operation: "provider.request", provider: "apple", outcome: "rejected", reason: "capacity" });
  assert.equal(results.at(-1)?.options.attributes?.outcome, "success");
});

test("SoundCloud canonical redirects preserve credentials only at the explicitly trusted HTTPS origin", async t => {
  const metrics = captureProviderMetrics(t);
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => {
    calls.push(String(input));
    return calls.length === 1 ? new Response("", { status: 302, headers: { location: "/tracks/1" } }) : Response.json({ ok: true });
  };
  assert.deepEqual((await providerJson("soundcloud", fetcher, "https://api.soundcloud.com/resolve", { headers: { Authorization: "OAuth fixture" } }, { allowedRedirectOrigins: ["https://api.soundcloud.com"] })).payload, { ok: true });
  assert.deepEqual(calls, ["https://api.soundcloud.com/resolve", "https://api.soundcloud.com/tracks/1"]);
  let unsafeCalls = 0;
  await assert.rejects(providerJson("soundcloud", async () => { unsafeCalls++; return new Response("", { status: 302, headers: { location: "https://attacker.invalid/steal" } }); }, "https://api.soundcloud.com/resolve", {}, { allowedRedirectOrigins: ["https://api.soundcloud.com"] }), /unsafe redirect/);
  assert.equal(unsafeCalls, 1);
  assert.equal(metrics.filter(metric => metric.name === "provider.request.attempts").length, 2);
  assert.deepEqual(metrics.filter(metric => metric.name === "provider.request.results").map(metric => metric.options.attributes), [
    { operation: "provider.request", provider: "soundcloud", status: 200, outcome: "success" },
    { operation: "provider.request", provider: "soundcloud", status: 302, outcome: "failure", reason: "invalid_response" }
  ]);
  assert.doesNotMatch(JSON.stringify(metrics), /https:|attacker|OAuth|Authorization|tracks\/1/);
});

test("provider outcomes distinguish upstream rate limits, invalid bodies and network failures while retaining successful results", async t => {
  const metrics = captureProviderMetrics(t);
  const url = "https://provider.invalid/private?token=private";
  assert.deepEqual((await providerJson("youtube", async () => Response.json({ saved: true }), url)).payload, { saved: true });
  const rateLimited = await providerJson("youtube", async () => Response.json({ private: "provider response" }, { status: 429 }), url);
  assert.equal(rateLimited.response.status, 429);
  await assert.rejects(providerJson("youtube", async () => new Response("private malformed response"), url), /invalid response/);
  const unavailable = new TypeError("private network error");
  await assert.rejects(providerJson("youtube", async () => { throw unavailable; }, url), error => error === unavailable);
  const results = metrics.filter(metric => metric.name === "provider.request.results");
  assert.deepEqual(results.map(metric => metric.options.attributes), [
    { operation: "provider.request", provider: "youtube", status: 200, outcome: "success" },
    { operation: "provider.request", provider: "youtube", status: 429, outcome: "failure", reason: "rate_limit" },
    { operation: "provider.request", provider: "youtube", status: 200, outcome: "failure", reason: "invalid_response" },
    { operation: "provider.request", provider: "youtube", outcome: "failure", reason: "network" }
  ]);
  assert.equal(metrics.filter(metric => metric.name === "provider.request.attempts").length, results.length);
  const durations = metrics.filter(metric => metric.name === "provider.request.duration");
  assert.equal(durations.length, results.length);
  assert.ok(durations.every(metric => Number.isFinite(metric.value) && metric.value >= 0 && metric.options.unit === "millisecond"));
  assert.doesNotMatch(JSON.stringify(metrics), /private|token|provider response|malformed|network error/);
});

test("saved YouTube verification forwards one caller deadline through counterpart mappings and duration lookup", async () => {
  const controller = new AbortController();
  const catalogSignals: Array<AbortSignal | undefined> = [];
  const upstreamSignals: AbortSignal[] = [];
  const spotify = { configured: true, searchTracks: async (_query: string, _limit: number, signal: AbortSignal) => { catalogSignals.push(signal); return []; } } as unknown as SpotifyApi;
  const appleMusic = { configured: true, searchTracks: async (_query: string, _limit: number, _storefront: string, signal: AbortSignal) => { catalogSignals.push(signal); return []; } } as unknown as AppleMusicApi;
  const resolver = createSavedSetResolver({ spotify, appleMusic, soundCloud: new SoundCloudApi(), youtubeApiKey: "fixture", allowSpotify: true, fetchImpl: async (url, init) => {
    upstreamSignals.push(init!.signal as AbortSignal);
    return String(url).includes("/oembed") ? Response.json({ title: "Verified", author_name: "Artist" }) : Response.json({ items: [{ id: "abcdefghijk", contentDetails: { duration: "PT3M" } }] });
  } });
  const track = await resolver({ provider: "youtube", providerId: "abcdefghijk", title: "Client hint" }, controller.signal);
  assert.equal(track.durationVerified, true);
  assert.equal(track.durationMs, 180_000);
  assert.equal(catalogSignals.length, 2);
  assert.ok(catalogSignals.every(signal => signal instanceof AbortSignal && signal === catalogSignals[0]));
  assert.equal(upstreamSignals.length, 2);
  controller.abort();
  assert.ok(upstreamSignals.every(signal => signal.aborted));
  assert.ok(catalogSignals.every(signal => signal?.aborted));
});
