import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { createBoundedAdminClient, createBoundedSupabaseFetch } from "./supabase-client.js";

const origin = "https://bounded-supabase-fixture.invalid";
const target = `${origin}/rest/v1/soundspin_fixture`;

test("Supabase fetch sends credentials only to its fixed project and refuses redirects", async () => {
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try { assert.throws(() => createBoundedSupabaseFetch("http://127.0.0.1:54321"), /HTTPS/); }
  finally { if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode; }
  let calls = 0;
  let canceled = false;
  const bounded = createBoundedSupabaseFetch(origin, async (_input, init) => {
    calls++; assert.equal(init?.redirect, "error");
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 302, headers: { location: "https://attacker.invalid/" } });
  });
  await assert.rejects(bounded("https://attacker.invalid/", { headers: { apikey: "local-fixture" } }), /outside/);
  await assert.rejects(bounded(`${origin.replace("https://", "https://user:password@")}\/rest/v1/fixture`), /outside/);
  assert.equal(calls, 0);
  await assert.rejects(bounded(target), /redirects/);
  assert.equal(calls, 1); assert.equal(canceled, true);
});

test("Supabase fetch bounds announced and streamed bytes and cancels oversized responses", async () => {
  let canceled = 0;
  const stream = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { canceled++; } });
  const announced = createBoundedSupabaseFetch(origin, async () => new Response(stream(), { headers: { "content-length": "5" } }), { maxResponseBytes: 4 });
  const streamed = createBoundedSupabaseFetch(origin, async () => new Response(stream()), { maxResponseBytes: 4 });
  await assert.rejects(announced(target), /oversized/);
  await assert.rejects(streamed(target), /oversized/);
  assert.equal(canceled, 2);
});

test("Supabase deadline aborts a stalled fetch even when the transport ignores cancellation", { timeout: 1000 }, async () => {
  let signal: AbortSignal | undefined;
  let calls = 0;
  const bounded = createBoundedSupabaseFetch(origin, async (_input, init) => {
    calls++; signal = init!.signal!;
    return calls === 1 ? new Promise<Response>(() => {}) : Response.json({ ok: true });
  }, { timeoutMs: 20, maxConcurrent: 1 });
  await assert.rejects(bounded(target), /timed out/);
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await (await bounded(target)).json(), { ok: true });
});

test("Supabase deadline includes streamed body and cannot hang on a broken cancel promise", { timeout: 1000 }, async () => {
  let canceled = false;
  const bounded = createBoundedSupabaseFetch(origin, async () => new Response(new ReadableStream<Uint8Array>({
    cancel() { canceled = true; return new Promise<void>(() => {}); }
  })), { timeoutMs: 20 });
  await assert.rejects(bounded(target), /timed out/);
  assert.equal(canceled, true);
});

test("caller aborts from both Request and init propagate; a preaborted call does no work", async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const bounded = createBoundedSupabaseFetch(origin, async (_input, init) => {
    calls++; signal = init!.signal!;
    return new Promise<Response>(() => {});
  });
  const preaborted = new AbortController(); preaborted.abort();
  await assert.rejects(bounded(target, { signal: preaborted.signal }));
  assert.equal(calls, 0);
  for (const fromRequest of [false, true]) {
    const controller = new AbortController();
    const pending = fromRequest ? bounded(new Request(target, { signal: controller.signal })) : bounded(target, { signal: controller.signal });
    controller.abort(new Error("Local fixture canceled."));
    await assert.rejects(pending, /fixture canceled/);
    assert.equal(signal?.aborted, true);
  }
});

test("all Supabase clients share admission until body completion and recover after abort", async () => {
  const controller = new AbortController();
  const first = createBoundedSupabaseFetch(origin, async () => new Response(new ReadableStream()), { maxConcurrent: 1 });
  let calls = 0;
  const second = createBoundedSupabaseFetch(origin, async () => { calls++; return Response.json({ ok: true }); }, { maxConcurrent: 1 });
  const pending = first(target, { signal: controller.signal });
  await nextTurn();
  await assert.rejects(second(target), /capacity/);
  assert.equal(calls, 0);
  controller.abort(); await assert.rejects(pending);
  assert.deepEqual(await (await second(target)).json(), { ok: true });
});

test("concurrent streamed Supabase responses share aggregate byte capacity and release it", async () => {
  const controller = new AbortController();
  const first = createBoundedSupabaseFetch(origin, async () => new Response(new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new Uint8Array(3)); }
  })), { maxBufferedBytes: 4 });
  const second = createBoundedSupabaseFetch(origin, async () => Response.json({}), { maxBufferedBytes: 4 });
  const pending = first(target, { signal: controller.signal });
  await nextTurn();
  await assert.rejects(second(target), /response capacity/);
  controller.abort(); await assert.rejects(pending);
  assert.deepEqual(await (await second(target)).json(), {});
});

test("supported Supabase SDK hook preserves RPC results and project-specific fixture credentials", async () => {
  let calls = 0;
  const client = createBoundedAdminClient({ env: { url: origin, publishableKeys: { default: "sb_publishable_fixture" }, secretKeys: { default: "sb_secret_fixture" } },
    fetcher: async (input, init) => {
      calls++;
      assert.ok(String(input) === `${origin}/rest/v1/rpc/soundspin_fixture`, "Unexpected SDK fixture target.");
      assert.ok(new Headers(init?.headers).get("apikey") === "sb_secret_fixture", "SDK did not use the injected fixture credentials.");
      return Response.json({ ok: true }, { headers: { "content-range": "0-0/1" } });
    }
  });
  const { data, error } = await client.rpc("soundspin_fixture", {});
  assert.equal(error, null); assert.deepEqual(data, { ok: true }); assert.equal(calls, 1);
});
