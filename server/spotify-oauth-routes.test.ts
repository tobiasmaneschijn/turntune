import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountSpotifyOAuthRoutes, spotifyReturnPath } from "./spotify-oauth-routes.js";

async function fixture(run: (base: string, context: { connected: string[]; now: number; fail: boolean }) => Promise<void>) {
  const app = express();
  const context = { connected: [] as string[], now: 1_000, fail: false };
  mountSpotifyOAuthRoutes(app, { getUserId: async request => request.get("authorization") === "Bearer alice" ? "alice" : null,
    accounts: { configured: true, connect: async userId => { if (context.fail) throw new Error("Provider unavailable"); context.connected.push(userId); } },
    redirectUri: () => "https://app.test/api/spotify/callback", authorizationUrl: (_uri, state) => `https://spotify.test/authorize?state=${state}`, now: () => context.now });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, context); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
async function begin(base: string, returnTo = "/") {
  const response = await fetch(`${base}/api/spotify/connect?${new URLSearchParams({ returnTo })}`, { headers: { Authorization: "Bearer alice" } });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { cookie: cookie.split(";")[0], state: new URL((await response.json()).url).searchParams.get("state")! };
}
const callback = (base: string, state: string, cookie?: string, code = "provider-code") => fetch(`${base}/api/spotify/callback?${new URLSearchParams({ state, code })}`, {
  redirect: "manual", headers: cookie ? { Cookie: cookie } : undefined });

test("forwarded OAuth URLs cannot link another browser, and the rightful browser can complete once", async () => {
  await fixture(async (base, context) => {
    const flow = await begin(base, "/room/lounge?tab=player#connect");
    assert.equal((await callback(base, flow.state)).status, 400);
    assert.equal((await callback(base, flow.state, `${flow.cookie}wrong`)).status, 400);
    assert.deepEqual(context.connected, []);
    const success = await callback(base, flow.state, flow.cookie);
    assert.equal(success.status, 302);
    assert.equal(success.headers.get("location"), "/room/lounge?tab=player&spotify=connected#connect");
    assert.match(success.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
    assert.deepEqual(context.connected, ["alice"]);
    assert.equal((await callback(base, flow.state, flow.cookie)).status, 400);
    assert.deepEqual(context.connected, ["alice"]);
  });
});
test("independent browser flows, denial, provider error, expiry, and missing authentication remain bounded", async () => {
  await fixture(async (base, context) => {
    assert.equal((await fetch(`${base}/api/spotify/connect`)).status, 401);
    const first = await begin(base), second = await begin(base);
    assert.equal((await callback(base, first.state, second.cookie)).status, 400);
    const denial = await callback(base, first.state, first.cookie, "");
    assert.equal(denial.headers.get("location"), "/?spotify=denied");
    context.fail = true;
    assert.equal((await callback(base, second.state, second.cookie)).headers.get("location"), "/?spotify=error");
    const expired = await begin(base);
    context.now += 600_000;
    assert.equal((await callback(base, expired.state, expired.cookie)).status, 400);
    assert.deepEqual(context.connected, []);
  });
});
test("OAuth return paths are normalized and cannot redirect to another origin", async () => {
  for (const path of ["//evil.test", "/\\evil.test/", "https://evil.test", "/\t/evil.test", "/\n/evil.test", null]) assert.equal(spotifyReturnPath(path), "/");
  assert.equal(spotifyReturnPath("/room/../settings?x=1#account"), "/settings?x=1#account");
  await fixture(async (base) => {
    const flow = await begin(base, "/\\evil.test/");
    assert.equal((await callback(base, flow.state, flow.cookie)).headers.get("location"), "/?spotify=connected");
  });
});
