import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import test, { type TestContext } from "node:test";
import express from "express";
import { defaultResourcePolicy } from "../../shared/resource-policy.js";
import { ResourceAdmission } from "../resources/resource-admission.js";
import { mountApiAccess } from "./api-access.js";
import { peerRequestBudget, SecurityBudget } from "./security-budget.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function accessCheck<T>() {
  const entered = deferred<void>();
  const result = deferred<T>();
  return { entered: entered.promise, release: result.resolve, wait: () => { entered.resolve(); return result.promise; } };
}

async function fixture(t: TestContext) {
  const gates = {
    identity: async () => "actor" as string | null,
    room: async () => true,
    policy: async () => defaultResourcePolicy(),
  };
  const requests = new Map<string, {
    accepted: ReturnType<typeof deferred<express.Response>>;
    handled: ReturnType<typeof deferred<express.Response>>;
  }>();
  const handledIds: string[] = [];
  const app = express();
  const budget = new SecurityBudget();
  app.use((request, response, next) => {
    requests.get(request.get("X-Fixture-Request")!)?.accepted.resolve(response);
    next();
  });
  app.use("/api", peerRequestBudget(budget, () => "fixture-peer"));
  mountApiAccess(app, {
    getApiUserId: () => gates.identity(), getSelfServiceUserId: () => gates.identity(),
    platform: { activeRoom: () => gates.room() }, blockedRooms: new Set(), securityBudget: budget,
    resourceAdmission: new ResourceAdmission(budget), resourcePolicies: { get: () => gates.policy() },
  });
  app.use("/api", (request, response) => {
    const id = request.get("X-Fixture-Request")!;
    handledIds.push(id);
    requests.get(id)!.handled.resolve(response);
    if (request.get("X-Fixture-Hold") !== "yes") response.json({ ok: true });
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  let nextId = 0;
  function start(path: string, { hold = false, method = "GET" } = {}) {
    const id = String(++nextId);
    const accepted = deferred<express.Response>();
    const handled = deferred<express.Response>();
    requests.set(id, { accepted, handled });
    let client!: ReturnType<typeof httpRequest>;
    const result = new Promise<number>((resolve, reject) => {
      client = httpRequest({ host: "127.0.0.1", port, path, method, agent: false,
        headers: { "X-Fixture-Request": id, ...(hold ? { "X-Fixture-Hold": "yes" } : {}) },
        signal: AbortSignal.timeout(5000) }, response => {
        response.resume();
        response.once("end", () => resolve(response.statusCode!));
        response.once("error", reject);
      });
      client.once("error", reject);
      client.end();
    });
    // Cancellation is intentional in these navigation/recovery workflows.
    void result.catch(() => undefined);
    return { id, result, handled: handled.promise, async cancel() {
      const response = await accepted.promise;
      const closed = once(response, "close");
      client.destroy();
      await closed;
      await result.catch(() => undefined);
    } };
  }
  return { gates, start, handledIds };
}

const settled = () => new Promise<void>(resolve => setImmediate(resolve));

test("a listener can return to rooms after canceled access checks and recover when live requests finish", { timeout: 10000 }, async t => {
  const app = await fixture(t);
  const canceled: string[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const identity = accessCheck<string | null>();
    app.gates.identity = identity.wait;
    const request = app.start("/api/rooms");
    canceled.push(request.id);
    await identity.entered;
    await request.cancel();
    identity.release("actor");
    await settled();
  }
  app.gates.identity = async () => "actor";
  for (let attempt = 0; attempt < 6; attempt++) {
    const room = accessCheck<boolean>();
    app.gates.room = room.wait;
    const request = app.start("/api/rooms/lounge");
    canceled.push(request.id);
    await room.entered;
    await request.cancel();
    room.release(true);
    await settled();
  }
  app.gates.room = async () => true;
  assert.equal(await app.start("/api/rooms").result, 200, "Canceled navigation must not exhaust the listener's request slots.");
  assert.equal(await app.start("/api/social").result, 200);
  assert.ok(canceled.every(id => !app.handledIds.includes(id)), "Canceled requests must stop before route handlers.");

  const live = await Promise.all(Array.from({ length: 12 }, async () => {
    const request = app.start("/api/rooms", { hold: true });
    return { request, response: await request.handled };
  }));
  assert.equal(await app.start("/api/social").result, 429, "Actual concurrent work must remain bounded.");
  live[0].response.json({ ok: true });
  assert.equal(await live[0].request.result, 200);
  assert.equal(await app.start("/api/social").result, 200, "Completing one request must restore capacity.");
  await Promise.all(live.slice(1).map(({ request }) => request.cancel()));
  assert.equal(await app.start("/api/rooms").result, 200, "Canceling admitted requests must restore capacity too.");
});

test("a room owner can save after leaving while the room policy is loading", { timeout: 10000 }, async t => {
  const app = await fixture(t);
  const canceled: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const policy = accessCheck<ReturnType<typeof defaultResourcePolicy>>();
    app.gates.policy = policy.wait;
    const request = app.start("/api/rooms/lounge", { method: "PATCH" });
    canceled.push(request.id);
    await policy.entered;
    await request.cancel();
    policy.release(defaultResourcePolicy());
    await settled();
  }
  app.gates.policy = async () => defaultResourcePolicy();
  assert.equal(await app.start("/api/rooms/lounge", { method: "PATCH" }).result, 200, "Canceled saves must not strand room-write slots.");
  assert.ok(canceled.every(id => !app.handledIds.includes(id)), "A save canceled before admission must not reach the write handler.");
});
