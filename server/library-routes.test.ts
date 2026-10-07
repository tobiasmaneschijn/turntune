import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountPrivateLibraryRoutes } from "./library-routes.js";
import type { LibraryMutation } from "./private-library.js";
import type { Store } from "./store.js";

interface Fixture {
  calls: Array<{ kind: "read" | "write"; userId: string; mutation?: LibraryMutation }>;
  failStore: boolean;
}
async function withRoutes(run: (base: string, fixture: Fixture) => Promise<void>) {
  const fixture: Fixture = { calls: [], failStore: false };
  const library = { picks: [], sets: [] };
  const store = {
    async getPrivateLibrary(userId: string) {
      fixture.calls.push({ kind: "read", userId });
      if (fixture.failStore) throw new Error("Read failed");
      return library;
    },
    async updatePrivateLibrary(userId: string, mutation: LibraryMutation) {
      fixture.calls.push({ kind: "write", userId, mutation });
      if (fixture.failStore) throw new Error("Write failed");
      return library;
    },
  } as unknown as Store;
  const app = express();
  mountPrivateLibraryRoutes(app, store, async request => {
    if (request.headers.authorization === "Bearer verifier-error") throw new Error("Credentials could not be verified");
    return request.headers.authorization === "Bearer alice" ? "alice" : null;
  });
  // Suppress Express's development error logging for intentionally malformed bodies.
  const bodyErrors: express.ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: "Invalid request body" });
  };
  app.use(bodyErrors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP fixture did not start");
  try { await run(`http://127.0.0.1:${address.port}`, fixture); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const post = (body: unknown, token = "alice"): RequestInit => ({
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const assertPrivate = (response: Response, status: number) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
};

test("denied or unverifiable private-library requests never reach Store and cannot be cached", async () => {
  await withRoutes(async (base, fixture) => {
    for (const token of ["denied", "verifier-error"]) {
      const status = token === "denied" ? 401 : 500;
      assertPrivate(await fetch(`${base}/api/library?userId=bob`, { headers: { Authorization: `Bearer ${token}` } }), status);
      assertPrivate(await fetch(`${base}/api/library?userId=bob`, post({ type: "clear-library", userId: "bob" }, token)), status);
    }
    assert.deepEqual(fixture.calls, []);
  });
});

test("private-library GET and POST use verified identity and strip body/query identity claims", async () => {
  await withRoutes(async (base, fixture) => {
    const read = await fetch(`${base}/api/library?userId=bob&ownerId=bob`, { headers: { Authorization: "Bearer alice" } });
    assertPrivate(read, 200);
    assert.deepEqual(await read.json(), { library: { picks: [], sets: [] } });
    const write = await fetch(`${base}/api/library?userId=bob`, post({ type: "save-pick", userId: "bob", ownerId: "bob",
      track: { provider: "youtube", providerId: "abcdefghijk", title: "Owned pick", addedBy: { id: "bob" }, roomId: "private-room" } }));
    assertPrivate(write, 200);
    assert.deepEqual(fixture.calls, [
      { kind: "read", userId: "alice" },
      { kind: "write", userId: "alice", mutation: { type: "save-pick", track: { provider: "youtube", providerId: "abcdefghijk", title: "Owned pick" } } },
    ]);
  });
});

test("private-library validation, JSON parsing and Store failures all retain no-store", async () => {
  await withRoutes(async (base, fixture) => {
    assertPrivate(await fetch(`${base}/api/library`, post({ type: "unsupported" })), 400);
    assertPrivate(await fetch(`${base}/api/library`, { ...post({}), body: "{" }), 400);
    assert.equal(fixture.calls.length, 0);
    fixture.failStore = true;
    assertPrivate(await fetch(`${base}/api/library`, { headers: { Authorization: "Bearer alice" } }), 500);
    assertPrivate(await fetch(`${base}/api/library`, post({ type: "clear-library" })), 500);
    assert.deepEqual(fixture.calls.map(call => [call.kind, call.userId]), [["read", "alice"], ["write", "alice"]]);
  });
});
