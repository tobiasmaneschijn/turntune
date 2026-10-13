import assert from "node:assert/strict";
import test from "node:test";
import { SocialStore, SOCIAL_LIMITS, type SocialRoomAccess } from "./social-store.js";
import type { User, RoomRole } from "./types.js";

const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222", carol = "33333333-3333-4333-8333-333333333333";
function fixture() {
  let now = 1_000, activityReads = 0;
  let beforeRoomName: (() => Promise<void>) | undefined;
  const users = new Map<string, User>([[alice, { id: alice, name: "Alice", avatarSeed: alice }], [bob, { id: bob, name: "Bob", avatarSeed: bob }], [carol, { id: carol, name: "Carol", avatarSeed: carol }]]);
  const visible = new Set(users.keys());
  const roles = new Map<string, RoomRole>([[alice, "owner"]]);
  const room = { name: "Lounge", isPublic: true, passwordProtected: true, roles };
  const activity = new Map([[bob, { roomSlug: "lounge" }], [carol, { roomSlug: "lounge" }]]);
  const grants: string[] = [];
  const getRoomAccess = async (slug: string, userId: string): Promise<SocialRoomAccess> => slug === "lounge"
    ? { exists: true, isPublic: room.isPublic, passwordProtected: room.passwordProtected, role: roles.get(userId) || null }
    : { exists: false, isPublic: false, passwordProtected: false, role: null };
  const store = new SocialStore({ supabase: null, now: () => now, getProfile: async id => users.get(id) || null,
    isProfileVisible: id => visible.has(id),
    searchProfiles: async q => [...users.values()].filter(user => user.name.toLowerCase().includes(q.toLowerCase())),
    getRoomAccess, getRoom: async slug => { await beforeRoomName?.(); return slug === "lounge" ? { name: room.name } : null; },
    getActivity: id => { activityReads++; return activity.get(id) || null; },
    grantRoomMember: async (slug, id) => { assert.equal(slug, "lounge"); grants.push(id); roles.set(id, "member"); } });
  return { store, users, visible, room, roles, grants, activity, now: () => now, advance: (ms: number) => { now += ms; }, activityReads: () => activityReads,
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


test("declines impose a cooldown, blocks revoke friendship/activity/invites, and unblock remains explicit", async () => {
  const { store, advance } = fixture();
  await store.actOnFriend(alice,bob,"request");
  await store.actOnFriend(bob,alice,"remove");
  await assert.rejects(store.actOnFriend(alice,bob,"request"),/cannot receive/);
  advance(SOCIAL_LIMITS.declineMs);
  await befriend(store);
  await store.setShareActivity(bob,true);
  const id=await store.createInvitation(alice,bob,"lounge");
  await store.setBlocked(bob,alice,true);
  assert.equal(await store.isBlocked(alice,bob),true);
  assert.equal((await store.snapshot(alice)).people.length,0);
  assert.equal((await store.snapshot(bob)).blockedPeople[0].id,alice);
  await assert.rejects(store.actOnFriend(alice,bob,"request"),/cannot receive/);
  await assert.rejects(store.createInvitation(alice,bob,"lounge"),/accepted friends/);
  await assert.rejects(store.acceptInvitation(bob,id),/not found/);
  await store.setBlocked(bob,alice,false);
  assert.equal(await store.isBlocked(alice,bob),false);
  assert.equal(await store.getRelationship(alice,bob),"none");
  await store.setReceiveRequests(bob,false);
  await assert.rejects(store.actOnFriend(alice,bob,"request"),/cannot receive/);
  await store.setReceiveRequests(bob,true);
  await store.actOnFriend(alice,bob,"request");
  advance(SOCIAL_LIMITS.requestMs);
  assert.equal(await store.getRelationship(alice,bob),"none");
  await assert.rejects(store.actOnFriend(bob,alice,"accept"),/not found/);
});

test("blocking during activity lookup prevents a late disclosure", async () => {
  const { store,beforeRoomName }=fixture();
  await befriend(store); await store.setShareActivity(bob,true);
  beforeRoomName(()=>store.setBlocked(bob,alice,true));
  assert.equal((await store.snapshot(alice)).people[0].room,undefined);
});

test("service RPC quota rejections remain actionable while database diagnostics stay private", async () => {
  const makeStore = (error: { code: string; message: string }) => new SocialStore({
    supabase: { rpc: async () => ({ data: null, error }) } as unknown as import("@supabase/supabase-js").SupabaseClient,
    getRoomAccess: async () => ({ exists: false, isPublic: false, passwordProtected: false, role: null }),
  });
  await assert.rejects(makeStore({ code: "P0001", message: "Too many pending friend requests." }).actOnFriend(alice,bob,"request"),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 429);
  await assert.rejects(makeStore({ code: "42P01", message: "relation secret_internal_table does not exist" }).actOnFriend(alice,bob,"request"),
    (error: unknown) => error instanceof Error && !error.message.includes("secret_internal_table") && !("status" in error));
});

test("hidden subjects disappear from social identities while anonymous owner-held blocks remain removable", async () => {
  const { store, visible, roles, users } = fixture();
  roles.set(bob, "member");
  users.set(carol, { ...users.get(carol)!, avatarKey: "pulse", avatarUrl: "https://fixture.supabase.co/storage/v1/object/public/profile-avatars/private.png", isAppAdmin: true });
  await befriend(store);
  await store.createInvitation(bob, alice, "lounge");
  await store.setBlocked(alice, carol, true);
  const active = await store.snapshot(alice);
  assert.equal(active.people[0].user.name, "Bob");
  assert.equal(active.invitations[0].from.name, "Bob");
  assert.equal(active.blockedPeople[0].name, "Carol");

  visible.delete(bob); visible.delete(carol);
  const hidden = await store.snapshot(alice);
  assert.deepEqual(hidden.people, []);
  assert.deepEqual(hidden.invitations, []);
  assert.deepEqual(hidden.blockedPeople, [{ id: carol, name: "Unavailable listener", avatarSeed: carol }]);
  assert.deepEqual(await store.searchPeople(alice, "Bo"), []);
  await store.setBlocked(alice, carol, false);
  assert.deepEqual((await store.snapshot(alice)).blockedPeople, []);
  visible.add(bob);
  assert.equal((await store.snapshot(alice)).people[0].user.name, "Bob");
});

test("service social identities use one bounded active-subject RPC rather than a bypass-RLS profile read", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const profiles = new Map([[bob, { user_id: bob, display_name: "Bob", avatar_key: "pulse", avatar_url: null, is_app_admin: false }]]);
  const rows = [{ user_low: alice, user_high: bob, requested_by: alice, status: "accepted", updated_at: new Date().toISOString() },
    { user_low: alice, user_high: carol, requested_by: alice, status: "accepted", updated_at: new Date().toISOString() }];
  const db = {
    rpc: async (name: string, args: { p_ids?: string[] }) => {
      calls.push({ name, args });
      if (name === "soundspin_users_blocked") return { data: false, error: null };
      assert.equal(name, "soundspin_social_profiles");
      assert.ok(args.p_ids && args.p_ids.length <= 500);
      return { data: args.p_ids.flatMap(id => profiles.has(id) ? [profiles.get(id)] : []), error: null };
    },
    from(table: string) {
      assert.notEqual(table, "soundspin_profiles", "the service client must not bypass subject visibility through SELECT");
      let status = "", columns = "";
      const query = {
        select(value: string) { columns = value; return query; },
        eq(column: string, value: string) { if (column === "status") status = value; return query; },
        or() { return query; }, in() { return query; }, is() { return query; }, gt() { return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() { return { data: table === "soundspin_social_settings" ? { share_activity: false, receive_requests: true } : null, error: null }; },
        then(resolve: (value: unknown) => unknown) {
          const data = table === "soundspin_friendships" && status === "accepted" ? rows
            : table === "soundspin_user_blocks" ? [{ blocked_id: carol }]
            : table === "soundspin_social_settings" && columns === "user_id" ? [] : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return query;
    }
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
  const store = new SocialStore({ supabase: db, getRoomAccess: async () => ({ exists: false, isPublic: false, passwordProtected: false, role: null }) });
  const snapshot = await store.snapshot(alice);
  assert.deepEqual(snapshot.people.map(person => person.user.id), [bob]);
  assert.deepEqual(snapshot.blockedPeople, [{ id: carol, name: "Unavailable listener", avatarSeed: carol }]);
  const profileCalls = calls.filter(call => call.name === "soundspin_social_profiles");
  assert.equal(profileCalls.length, 2, "friends and owned block identities use bounded batch projections");
});
