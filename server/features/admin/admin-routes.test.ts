import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mountAdminRoutes } from "./admin-routes.js";

async function fixture(run: (base: string, state: { calls: Array<{ path: string; method: string; body?: unknown }>; fail: boolean; screenshots: boolean }) => Promise<void>) {
  const { createClient } = await import("@supabase/supabase-js");
  const state = { calls: [] as Array<{ path: string; method: string; body?: unknown }>, fail: false, screenshots: false };
  const today = new Date().toISOString().slice(0, 10);
  const client = createClient("https://admin.invalid", "fixture", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().text();
    state.calls.push({ path: url.pathname, method: request.method, body: text ? JSON.parse(text) : undefined });
    if (state.fail) return Response.json({ message: "private database failure" }, { status: 500 });
    if (url.pathname.endsWith("soundspin_admin_summary")) return Response.json({
      metrics: { users: 5, rooms: 3, feedback: 4, openFeedback: 2, messages: 1275 },
      activity: [{ day: today, users: 5, feedback: 4, messages: 1275 }]
    });
    if (url.pathname.endsWith("soundspin_update_feedback_admin")) return Response.json({ id: "11111111-1111-4111-8111-111111111111", status: "reviewing", admin_note: "Verified", updated_at: `${today}T10:00:00Z` });
    if (state.screenshots && url.pathname === "/rest/v1/soundspin_feedback") return Response.json([{
      id: "11111111-1111-4111-8111-111111111111", user_id: "listener", screenshot_paths: ["listener/found.png", "listener/missing.png", "other/private.png"], created_at: `${today}T10:00:00Z`
    }]);
    if (url.pathname === "/storage/v1/object/sign/feedback-screenshots") return Response.json([
      { path: "listener/found.png", signedURL: "/object/sign/feedback-screenshots/listener/found.png?token=fixture", error: null },
      { path: "listener/missing.png", signedURL: null, error: "Object not found" }
    ]);
    if (request.method === "HEAD") return new Response(null, { headers: { "content-range": "0-0/1275" } });
    if (request.method === "PATCH") return Response.json({ id: "11111111-1111-4111-8111-111111111111", status: "reviewing", admin_note: "Verified", updated_at: `${today}T10:00:00Z` });
    return Response.json([]);
  } } }) as SupabaseClient;
  const app = express();
  mountAdminRoutes(app, { client, getAdminUserId: async request => request.get("authorization") === "Bearer admin" ? { ok: true, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } :
    request.get("authorization") ? { ok: false, status: 403, error: "Administrator access required." } : { ok: false, status: 401, error: "Authentication required." }, listenerCount: () => 0 });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, state); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const authenticated = { headers: { Authorization: "Bearer admin" } };

test("administrative routes reject unauthorized requests before privileged data access", async () => {
  await fixture(async (base, state) => {
    for (const [headers, status] of [[{}, 401], [{ Authorization: "Bearer listener" }, 403]] as const) {
      const response = await fetch(`${base}/api/admin/dashboard`, { headers });
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await fetch(`${base}/api/admin/feedback/11111111-1111-4111-8111-111111111111`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ status: "reviewing" }) })).status, status);
    }
    assert.deepEqual(state.calls, []);
  });
});
test("the support inbox signs screenshots together and remains usable when an individual image is missing", async () => {
  await fixture(async (base, state) => {
    state.screenshots = true;
    const response = await fetch(`${base}/api/admin/dashboard`, authenticated);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.feedback[0].screenshots[0].url, /found\.png/);
    assert.equal(payload.feedback[0].screenshots[1].url, null);
    assert.equal(payload.feedback[0].screenshots[2].url, null, "forged paths cannot gain signed previews");
    const signing = state.calls.filter(call => call.path.startsWith("/storage/"));
    assert.equal(signing.length, 1);
    assert.deepEqual(signing[0].body, { paths: ["listener/found.png", "listener/missing.png"], expiresIn: 900 });
  });
});
test("dashboard consumes SQL daily totals rather than capped raw activity rows and hides internal failures", async () => {
  await fixture(async (base, state) => {
    const response = await fetch(`${base}/api/admin/dashboard`, authenticated);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.activity.length, 14);
    assert.equal(payload.activity.at(-1).messages, 1275);
    assert.deepEqual(payload.metrics, { users: 5, rooms: 3, feedback: 4, openFeedback: 2, messages: 1275 });
    assert.equal(state.calls.filter(call => call.path.endsWith("soundspin_admin_summary")).length, 1);
    assert.equal(state.calls.filter(call => call.method === "HEAD").length, 0);
    const rpc = state.calls.find(call => call.path.endsWith("soundspin_admin_summary"))!;
    assert.match((rpc.body as { p_start: string }).p_start, /T00:00:00\.000Z$/);
    assert.equal((rpc.body as { p_actor: string }).p_actor, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    state.fail = true;
    const failure = await fetch(`${base}/api/admin/dashboard`, authenticated);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: "Could not load admin data." });
  });
});
test("feedback updates preserve validated administrative mutations", async () => {
  await fixture(async (base, state) => {
    const response = await fetch(`${base}/api/admin/feedback/11111111-1111-4111-8111-111111111111`, { method: "PATCH", headers: { ...authenticated.headers, "Content-Type": "application/json" }, body: JSON.stringify({ status: "reviewing", adminNote: "Verified", userId: "forged" }) });
    assert.equal(response.status, 200);
    assert.equal(state.calls.at(-1)!.path, "/rest/v1/rpc/soundspin_update_feedback_admin");
    assert.deepEqual(state.calls.at(-1)!.body, { p_actor: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", p_id: "11111111-1111-4111-8111-111111111111", p_status: "reviewing", p_note: "Verified" });
    assert.equal((await fetch(`${base}/api/admin/feedback/invalid`, { method: "PATCH", headers: { ...authenticated.headers, "Content-Type": "application/json" }, body: JSON.stringify({ status: "reviewing" }) })).status, 400);
  });
});
