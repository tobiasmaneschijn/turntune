import assert from "node:assert/strict";
import test from "node:test";
import { SocialStore, SOCIAL_LIMITS, type SocialRoomAccess } from "./social-store.js";
import type { User, RoomRole } from "./types.js";

const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222", carol = "33333333-3333-4333-8333-333333333333";
function fixture() {
  let now = 1_000, activityReads = 0;
  let beforeRoomName: (() => Promise<void>) | undefined;
  const users = new Map<string, User>([[alice, { id: alice, name: "Alice", avatarSeed: alice }], [bob, { id: bob, name: "Bob", avatarSeed: bob }], [carol, { id: carol, name: "Carol", avatarSeed: carol }]]);
  const roles = new Map<string, RoomRole>([[alice, "owner"]]);
  const room = { name: "Lounge", isPublic: true, passwordProtected: true, roles };
  const activity = new Map([[bob, { roomSlug: "lounge" }], [carol, { roomSlug: "lounge" }]]);
  const grants: string[] = [];
  const getRoomAccess = async (slug: string, userId: string): Promise<SocialRoomAccess> => slug === "lounge"
    ? { exists: true, isPublic: room.isPublic, passwordProtected: room.passwordProtected, role: roles.get(userId) || null }
    : { exists: false, isPublic: false, passwordProtected: false, role: null };
  const store = new SocialStore({ supabase: null, now: () => now, getProfile: async id => users.get(id) || null,
    searchProfiles: async q => [...users.values()].filter(user => user.name.toLowerCase().includes(q.toLowerCase())),
    getRoomAccess, getRoom: async slug => { await beforeRoomName?.(); return slug === "lounge" ? { name: room.name } : null; },
    getActivity: id => { activityReads++; return activity.get(id) || null; },
    grantRoomMember: async (slug, id) => { assert.equal(slug, "lounge"); grants.push(id); roles.set(id, "member"); } });
  return { store, users, room, roles, grants, activity, now: () => now, advance: (ms: number) => { now += ms; }, activityReads: () => activityReads,
    beforeRoomName: (run: () => Promise<void>) => { beforeRoomName = run; } };
}
async function befriend(store: SocialStore, a = alice, b = bob) { await store.actOnFriend(a, b, "request"); await store.actOnFriend(b, a, "accept"); }

test("friend requests are reciprocal, consent-based and idempotent through retries and cancellation", async () => {
  const { store } = fixture();
  await assert.rejects(store.actOnFriend(alice, alice, "request"), /another listener/);
  await assert.rejects(store.actOnFriend(alice, "44444444-4444-4444-8444-444444444444", "request"), /not found/);
  assert.equal(await store.actOnFriend(alice, bob, "request"), "outgoing");
  assert.equal(await store.actOnFriend(alice, bob, "request"), "outgoing");
  assert.equal(await store.actOnFriend(bob, alice, "request"), "incoming");
  await assert.rejects(store.actOnFriend(alice, bob, "accept"), /recipient/);
  assert.equal((await store.snapshot(alice)).people.length, 1);
  assert.equal((await store.snapshot(bob)).people[0].state, "incoming");
  assert.equal(await store.actOnFriend(alice, bob, "decline"), "none");
  assert.equal(await store.actOnFriend(bob, alice, "decline"), "none");
  await befriend(store);
  assert.equal(await store.actOnFriend(bob, alice, "accept"), "friends");
  assert.equal(await store.actOnFriend(alice, bob, "request"), "friends");
  await assert.rejects(store.actOnFriend(alice, bob, "decline"), /Remove friend/);
  assert.equal(await store.actOnFriend(bob, alice, "remove"), "none");
  assert.equal((await store.snapshot(alice)).people.length, 0);
  assert.equal(await store.actOnFriend(alice, bob, "remove"), "none");
});

test("crossed concurrent requests create one pending relationship, not an automatic friendship", async () => {
  const { store } = fixture();
  assert.deepEqual(await Promise.all([store.actOnFriend(alice, bob, "request"), store.actOnFriend(bob, alice, "request")]), ["outgoing", "incoming"]);
  assert.equal((await store.snapshot(alice)).people.length, 1);
  assert.equal(await store.getRelationship(alice, bob), "outgoing");
});

test("activity requires accepted friendship, opt-in and viewer room access", async () => {
  const { store, room, roles, activityReads } = fixture();
  await store.setShareActivity(bob, true);
  await store.actOnFriend(alice, bob, "request");
  assert.equal((await store.snapshot(alice)).people[0].room, undefined);
  assert.equal(activityReads(), 0);
  await store.actOnFriend(bob, alice, "accept");
  assert.deepEqual((await store.snapshot(alice)).people[0].room, { slug: "lounge", name: "Lounge", canJoin: true });
  assert.equal((await store.snapshot(bob)).shareActivity, true);
  room.isPublic = false; roles.delete(alice);
  assert.equal((await store.snapshot(alice)).people[0].room, undefined);
  roles.set(alice, "member");
  assert.equal((await store.snapshot(alice)).people[0].room?.slug, "lounge");
  await store.setShareActivity(bob, false);
  assert.equal((await store.snapshot(alice)).people[0].room, undefined);
  assert.equal((await store.snapshot(alice)).people.some(person => person.user.id === carol), false);
});

test("search is bounded, excludes the viewer and does not browse all people on an empty query", async () => {
  const { store } = fixture();
  assert.deepEqual(await store.searchPeople(alice, ""), []);
  assert.deepEqual(await store.searchPeople(alice, "A"), []);
  assert.deepEqual(await store.searchPeople(alice, "ali"), []);
  assert.equal((await store.searchPeople(alice, "bo"))[0].id, bob);
  await assert.rejects(store.searchPeople(alice, "x".repeat(49)), /48 characters/);
});

test("an opt-out or removed friendship during activity metadata lookup prevents late activity disclosure", async () => {
  const { store, beforeRoomName } = fixture();
  await befriend(store); await store.setShareActivity(bob, true);
  beforeRoomName(() => store.setShareActivity(bob, false));
  assert.equal((await store.snapshot(alice)).people[0].room, undefined);
  await store.setShareActivity(bob, true);
  beforeRoomName(async () => { await store.actOnFriend(alice, bob, "remove"); });
  assert.equal((await store.snapshot(alice)).people[0].room, undefined);
});

test("room invitations require accepted friends and current room membership, deduplicate and keep passwords private", async () => {
  const { store, roles, advance } = fixture();
  await assert.rejects(store.createInvitation(alice, bob, "lounge"), /accepted friends/);
  await befriend(store);
  await assert.rejects(store.createInvitation(bob, alice, "lounge"), /Join this room/);
  const [first, retry] = await Promise.all([store.createInvitation(alice, bob, "lounge"), store.createInvitation(alice, bob, "lounge")]);
  assert.equal(first, retry);
  assert.equal((await store.snapshot(bob)).invitations.length, 1);
  await assert.rejects(store.acceptInvitation(carol, first), /not found/);
  assert.deepEqual(await store.acceptInvitation(bob, first), { roomSlug: "lounge", passwordRequired: true });
  assert.deepEqual(await store.acceptInvitation(bob, first), { roomSlug: "lounge", passwordRequired: true });
  assert.equal((await store.snapshot(bob)).invitations.length, 0);
  roles.delete(alice);
  await assert.rejects(store.acceptInvitation(bob, first), /Join this room/);
  roles.set(alice, "owner"); advance(SOCIAL_LIMITS.invitationMs);
  await assert.rejects(store.acceptInvitation(bob, first), /expired/);
});

test("private invitations recheck authority and never restore membership using an already accepted invitation", async () => {
  const { store, room, roles, grants } = fixture();
  room.isPublic = false;
  await befriend(store);
  const invitation = await store.createInvitation(alice, bob, "lounge");
  roles.set(alice, "member");
  assert.equal((await store.snapshot(bob)).invitations.length, 0);
  await assert.rejects(store.acceptInvitation(bob, invitation), /owner or a moderator/);
  roles.set(alice, "owner");
  assert.equal((await store.acceptInvitation(bob, invitation)).passwordRequired, true);
  assert.deepEqual(grants, [bob]);
  await store.acceptInvitation(bob, invitation); assert.deepEqual(grants, [bob]);
  roles.delete(bob);
  await assert.rejects(store.acceptInvitation(bob, invitation), /access was removed/);
  assert.deepEqual(grants, [bob]);
  await store.actOnFriend(alice, bob, "remove");
  await assert.rejects(store.acceptInvitation(bob, invitation), /accepted friends/);
});

test("ordinary private-room members cannot grant access but may invite an already admitted friend", async () => {
  const { store, room, roles, grants } = fixture();
  room.isPublic = false; roles.set(alice, "member");
  await befriend(store);
  await assert.rejects(store.createInvitation(alice, bob, "lounge"), /owner or a moderator/);
  roles.set(bob, "moderator");
  const id = await store.createInvitation(alice, bob, "lounge");
  await store.acceptInvitation(bob, id);
  assert.equal(roles.get(bob), "moderator");
  assert.deepEqual(grants, []);
});
