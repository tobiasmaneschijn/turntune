import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountSignupRoutes, type SignupRouteOptions } from "./signup-routes.js";

async function fixture(run: (base: string, calls: Array<{ email: string; options: unknown }>) => Promise<void>, overrides: Partial<SignupRouteOptions> = {}) {
  const calls: Array<{ email: string; options: unknown }> = [];
  const app = express();
  mountSignupRoutes(app, {
    admin: { inviteUserByEmail: async (email, options) => { calls.push({ email, options }); return { data: { user: { id: "pending", aud: "authenticated", created_at: "2026-10-13T00:00:00Z", app_metadata: {}, user_metadata: {} } }, error: null }; } },
    invitePassword: "invite-secret", appOrigin: "https://app.test", ...overrides
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function signup(base: string, email = "new@example.com", extra = {}) {
  return fetch(`${base}/api/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Listener", email, invitePassword: "invite-secret", ...extra }) });
}

test("signup sends a supported hosted invitation with a fixed activation destination, never a password or confirmation override", async () => {
  await fixture(async (base, calls) => {
    const response = await signup(base);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls, [{ email: "new@example.com", options: { redirectTo: "https://app.test/update-password", data: { display_name: "Listener" } } }]);
    assert.equal((await signup(base, "other@example.com", { email_confirm: true })).status, 400);
    assert.equal((await signup(base, "other@example.com", { password: "attacker chosen password" })).status, 400);
    assert.equal((await signup(base, "other@example.com", { invitePassword: "wrong" })).status, 403);
    assert.equal(calls.length, 1);
  });
});

test("successful invitations consume their independent creation quota, including parallel calls", async () => {
  await fixture(async (base, calls) => {
    const responses = await Promise.all(Array.from({ length: 5 }, (_, index) => signup(base, `user${index}@example.com`)));
    assert.equal(responses.filter(response => response.status === 202).length, 3);
    assert.equal(responses.filter(response => response.status === 429).length, 2);
    assert.equal(calls.length, 3);
  });
});

test("existing-account and delivery failures have the same generic result, and invalid origin disables signup", async () => {
  const failedAdmin = { inviteUserByEmail: async () => { throw new Error("user already exists or SMTP secret"); } } as SignupRouteOptions["admin"];
  await fixture(async base => {
    const response = await signup(base);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, message: "If this address can be invited, you will receive an email to finish creating your account." });
  }, { admin: failedAdmin });
  await fixture(async (base, calls) => { assert.equal((await signup(base)).status, 503); assert.equal(calls.length, 0); }, { appOrigin: "https://app.test/attacker" });
});
