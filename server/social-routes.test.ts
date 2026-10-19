import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { mountSocialRoutes } from "./social-routes.js";
import { SocialError, type SocialStore } from "./social-store.js";

const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222", invitation = "33333333-3333-4333-8333-333333333333";
async function fixture(run: (base: string, calls: unknown[][], advance: () => void) => Promise<void>) {
  const calls: unknown[][] = [];
  let now = 1000;
  const record = async (kind: string, ...args: unknown[]) => { calls.push([kind, ...args]); };
  const store = {
    snapshot: async (actor: string) => { await record("snapshot", actor); return { people: [], invitations: [], shareActivity: false }; },
    searchPeople: async (actor: string, query: string) => { await record("search", actor, query); return []; },
    actOnFriend: async (actor: string, target: string, action: string) => { await record("friend", actor, target, action); if (action === "accept") throw new SocialError("Only the recipient can accept this request.", 403); return "outgoing"; },
    setBlocked: async (actor: string, target: string, blocked: boolean) => { await record("block", actor, target, blocked); },
    setReceiveRequests: async (actor: string, enabled: boolean) => { await record("receive", actor, enabled); },
    setShareActivity: async (actor: string, share: boolean) => { await record("settings", actor, share); },
    createInvitation: async (actor: string, recipient: string, room: string) => { await record("invite", actor, recipient, room); return invitation; },
    acceptInvitation: async (actor: string, id: string) => { await record("accept-invite", actor, id); return { roomSlug: "lounge", passwordRequired: true }; },
  } as unknown as SocialStore;
  const app = express();
  mountSocialRoutes(app, store, async req => {
    if (req.headers.authorization === "Bearer error") throw new Error("Credential verification failed.");
    return req.headers.authorization === "Bearer alice" ? alice : null;
  }, () => now);
  const bodyErrors: express.ErrorRequestHandler = (error, _req, res, _next) => { res.status(error.status || 500).json({ error: "Invalid body." }); };
  app.use(bodyErrors);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No HTTP fixture.");
  try { await run(`http://127.0.0.1:${address.port}`, calls, () => { now += 60_000; }); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const headers = { Authorization: "Bearer alice", "Content-Type": "application/json" };
const request = (method: string, body?: unknown): RequestInit => ({ method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const status = (response: Response, expected: number) => { assert.equal(response.status, expected); assert.equal(response.headers.get("cache-control"), "no-store"); };

test("all social routes require verified credentials and retain no-store on failures", async () => fixture(async (base, calls) => {
  for (const [path, init] of [["/api/social", request("GET")], ["/api/people?q=Bob", request("GET")], [`/api/friends/${bob}`, request("PUT", { action: "request" })],
    ["/api/social/settings", request("PATCH", { shareActivity: true })], [`/api/social/blocks/${bob}`, request("PUT", { blocked: true })], ["/api/room-invitations", request("POST", { userId: bob, roomSlug: "lounge" })],
    [`/api/room-invitations/${invitation}/accept`, request("POST")]] as const) {
    status(await fetch(base + path, { ...init, headers: { ...headers, Authorization: "Bearer denied" } }), 401);
  }
  const unavailable = await fetch(`${base}/api/social`, { headers: { Authorization: "Bearer error" } });
  status(unavailable, 500);
  assert.deepEqual(await unavailable.json(), { error: "Could not complete this request. Try again." });
  assert.deepEqual(calls, []);
}));

test("query/body identity cannot replace the verified actor and target/recipient validation precedes Store writes", async () => fixture(async (base, calls) => {
  status(await fetch(`${base}/api/social?userId=${bob}`, request("GET")), 200);
  status(await fetch(`${base}/api/people?q=Bob&viewer=${bob}`, request("GET")), 200);
  const friend = await fetch(`${base}/api/friends/${bob}`, request("PUT", { action: "request" })); status(friend, 200); assert.deepEqual(await friend.json(), { state: "outgoing" });
  status(await fetch(`${base}/api/friends/${bob}`, request("PUT", { action: "request", actorId: bob })), 400);
  status(await fetch(`${base}/api/social/settings`, request("PATCH", { shareActivity: true, userId: bob })), 400);
  status(await fetch(`${base}/api/social/settings`, request("PATCH", { shareActivity: true })), 200);
  const sent = await fetch(`${base}/api/room-invitations`, request("POST", { userId: bob, roomSlug: "lounge" })); status(sent, 200); assert.deepEqual(await sent.json(), { invitationId: invitation });
  const accepted = await fetch(`${base}/api/room-invitations/${invitation}/accept?userId=${bob}`, request("POST")); status(accepted, 200); assert.deepEqual(await accepted.json(), { roomSlug: "lounge", passwordRequired: true });
  assert.deepEqual(calls, [["snapshot", alice], ["search", alice, "Bob"], ["friend", alice, bob, "request"], ["settings", alice, true], ["invite", alice, bob, "lounge"], ["accept-invite", alice, invitation]]);
  status(await fetch(`${base}/api/friends/invalid`, request("PUT", { action: "request" })), 400);
  status(await fetch(`${base}/api/friends/${bob}`, { ...request("PUT", {}), body: "{" }), 400);
  status(await fetch(`${base}/api/friends/${bob}`, request("PUT", { action: "accept" })), 403);
}));

test("invitation attempts are bounded per verified account and resume after the retry interval", async () => fixture(async (base, calls, advance) => {
  for (let index = 0; index < 10; index++) status(await fetch(`${base}/api/room-invitations`, request("POST", { userId: bob, roomSlug: "lounge" })), 200);
  const limited = await fetch(`${base}/api/room-invitations`, request("POST", { userId: bob, roomSlug: "lounge" })); status(limited, 429);
  assert.equal(limited.headers.get("retry-after"), "60"); assert.equal(calls.length, 10);
  advance(); status(await fetch(`${base}/api/room-invitations`, request("POST", { userId: bob, roomSlug: "lounge" })), 200);
  assert.equal(calls.length, 11);
}));


test("blocking and request preferences use only the verified actor and reject extra identity fields", async () => fixture(async(base,calls)=>{
  status(await fetch(`${base}/api/social/blocks/${bob}`,request("PUT",{blocked:true,actor: bob})),400);
  status(await fetch(`${base}/api/social/blocks/${bob}`,request("PUT",{blocked:true})),200);
  status(await fetch(`${base}/api/social/settings`,request("PATCH",{receiveRequests:false})),200);
  status(await fetch(`${base}/api/social/settings`,request("PATCH",{})),400);
  assert.deepEqual(calls,[["block",alice,bob,true],["receive",alice,false]]);
}));
