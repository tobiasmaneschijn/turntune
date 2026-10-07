import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mountAdminRoutes } from "./admin-routes.js";

async function fixture(run: (base: string, state: { calls: Array<{ path: string; method: string; body?: unknown }>; fail: boolean }) => Promise<void>) {
  const { createClient } = await import("@supabase/supabase-js");
  const state = { calls: [] as Array<{ path: string; method: string; body?: unknown }>, fail: false };
  const today = new Date().toISOString().slice(0, 10);
  const client = createClient("https://admin.invalid", "fixture", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().text();
    state.calls.push({ path: url.pathname, method: request.method, body: text ? JSON.parse(text) : undefined });
    if (state.fail) return Response.json({ message: "private database failure" }, { status: 500 });
    if (url.pathname.endsWith("soundspin_admin_activity")) return Response.json([{ day: today, users: 5, feedback: 4, messages: 1275 }]);
    if (request.method === "HEAD") return new Response(null, { headers: { "content-range": "0-0/1275" } });
    if (request.method === "PATCH") return Response.json({ id: "11111111-1111-4111-8111-111111111111", status: "reviewing", admin_note: "Verified", updated_at: `${today}T10:00:00Z` });
    return Response.json([]);
  } } }) as SupabaseClient;
  const app = express();
  mountAdminRoutes(app, { client, getAdminUserId: async request => request.get("authorization") === "Bearer admin" ? { ok: true, userId: "admin" } :
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
test("dashboard consumes SQL daily totals rather than capped raw activity rows and hides internal failures", async () => {
  await fixture(async (base, state) => {
    const response = await fetch(`${base}/api/admin/dashboard`, authenticated);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.activity.length, 14);
    assert.equal(payload.activity.at(-1).messages, 1275);
    assert.equal(state.calls.filter(call => call.path.endsWith("soundspin_admin_activity")).length, 1);
    const rpc = state.calls.find(call => call.path.endsWith("soundspin_admin_activity"))!;
    assert.match((rpc.body as { start_at: string }).start_at, /T00:00:00\.000Z$/);
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
    assert.deepEqual(state.calls.at(-1)!.body, { status: "reviewing", admin_note: "Verified", updated_at: (state.calls.at(-1)!.body as { updated_at: string }).updated_at });
    assert.equal((await fetch(`${base}/api/admin/feedback/invalid`, { method: "PATCH", headers: { ...authenticated.headers, "Content-Type": "application/json" }, body: JSON.stringify({ status: "reviewing" }) })).status, 400);
  });
});
