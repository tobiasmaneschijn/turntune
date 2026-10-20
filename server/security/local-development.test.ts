import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { defaultResourcePolicy } from "../../shared/resource-policy.js";
import { ResourceAdmission } from "../resources/resource-admission.js";
import { mountApiAccess } from "./api-access.js";
import { localRateLimitsDisabled } from "./local-development.js";
import { peerRequestBudget, SecurityBudget } from "./security-budget.js";

test("only explicit development on a loopback bind disables request throttling", () => {
  for (const HOST of ["127.0.0.1", "::1", "[::1]"]) {
    assert.equal(localRateLimitsDisabled({ NODE_ENV: "development", HOST }), true);
  }
  for (const env of [
    {},
    { NODE_ENV: "development" },
    { NODE_ENV: "test", HOST: "127.0.0.1" },
    { NODE_ENV: "production", HOST: "127.0.0.1" },
    { NODE_ENV: "development", HOST: "0.0.0.0" },
    { NODE_ENV: "development", HOST: "::" },
    { NODE_ENV: "development", HOST: "192.0.2.10" },
  ]) assert.equal(localRateLimitsDisabled(env), false);
});

test("local developers can burst authenticated requests while account access and hosted throttling remain enforced", async (t) => {
  const previous = { NODE_ENV: process.env.NODE_ENV, HOST: process.env.HOST };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.NODE_ENV = "production";
  process.env.HOST = "127.0.0.1";

  const budget = new SecurityBudget(() => 1000);
  // Model a developer whose reloads have already exhausted both admission
  // windows and whose earlier requests still occupy their HTTP flight slots.
  assert.equal(budget.consume([
    { key: "http-peer:fixture", maximum: 600, windowMs: 60_000, cost: 600 },
    { key: "http-user:actor", maximum: 300, windowMs: 60_000, cost: 300 },
  ]), true);
  const leases = [
    ...Array.from({ length: 24 }, () => budget.acquire("http-peer-flight:fixture", 24)),
    ...Array.from({ length: 12 }, () => budget.acquire("http-user-flight:actor", 12)),
  ];
  t.after(() => leases.forEach(release => release?.()));

  const app = express();
  const identity = async (request: Request) => request.get("Authorization") === "Bearer fixture" ? "actor" : null;
  app.use("/api", peerRequestBudget(budget, () => "fixture"));
  mountApiAccess(app, {
    getApiUserId: identity,
    getSelfServiceUserId: identity,
    platform: { activeRoom: async () => true },
    blockedRooms: new Set(),
    securityBudget: budget,
    resourceAdmission: new ResourceAdmission(budget),
    resourcePolicies: { get: async () => defaultResourcePolicy() },
  });
  app.get("/api/development-check", (_request, response) => { response.json({ ok: true }); });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/development-check`;
  const request = (authenticated = true) => new Promise<number>((resolve, reject) => {
    get(url, { agent: false, headers: authenticated ? { Authorization: "Bearer fixture" } : {}, signal: AbortSignal.timeout(5000) }, response => {
      response.resume();
      response.once("end", () => resolve(response.statusCode!));
      response.once("error", reject);
    }).once("error", reject);
  });

  assert.equal(await request(), 429);
  process.env.NODE_ENV = "development";
  assert.equal(budget.consume([{ key: "http-user:actor", maximum: 300, windowMs: 60_000 }]), true);
  const burst = [{ key: "development-room-write", capacity: 1, perMinute: 1 }];
  assert.equal(budget.consumeBurst(burst), true);
  assert.equal(budget.consumeBurst(burst), true);
  assert.equal(await request(false), 401);
  const statuses = await Promise.all(Array.from({ length: 25 }, () => request()));
  assert.ok(statuses.every(status => status === 200), "Local authenticated reloads must pass exhausted HTTP admission budgets.");
  process.env.NODE_ENV = "production";
  assert.equal(await request(), 429);
  assert.equal(budget.consumeBurst(burst), true);
  assert.equal(budget.consumeBurst(burst), false);
});
