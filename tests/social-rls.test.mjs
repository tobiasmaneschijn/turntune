import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222", carol = "33333333-3333-4333-8333-333333333333";
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    create table public.soundspin_profiles(user_id uuid primary key references auth.users(id), display_name text);
    create table public.soundspin_rooms(slug text primary key, name text, owner_id uuid references auth.users(id), is_public boolean, password_hash text, settings jsonb, state jsonb, updated_at timestamptz);
    create table public.soundspin_room_members(room_slug text references public.soundspin_rooms(slug), user_id uuid references auth.users(id), role text check(role in ('owner','moderator','dj','member')), updated_at timestamptz, primary key(room_slug,user_id));
    alter table public.soundspin_profiles enable row level security;
    alter table public.soundspin_rooms enable row level security;
    alter table public.soundspin_room_members enable row level security;
    grant select,insert,update,delete on public.soundspin_profiles, public.soundspin_rooms, public.soundspin_room_members to service_role;
    insert into auth.users values ('${alice}'),('${bob}'),('${carol}');
    insert into public.soundspin_profiles values ('${alice}','Alice'),('${bob}','Bob'),('${carol}','Carol');
    insert into public.soundspin_rooms values ('lounge','Lounge','${alice}',true,'private-hash','{}','{}',now()),('private-lounge','Private lounge','${alice}',false,null,'{}','{}',now());
    insert into public.soundspin_room_members values ('lounge','${alice}','owner',now()),('lounge','${carol}','member',now()),('private-lounge','${alice}','owner',now()),('private-lounge','${carol}','member',now());`);
  await db.exec(await readFile(new URL("../supabase/migrations/20261007081213_friends_and_profile_showcase.sql", import.meta.url), "utf8"));
  return db;
}
const act = async (db, actor, target, action) => (await db.query("select public.soundspin_friend_action($1,$2,$3) as state", [actor, target, action])).rows[0].state;
const invite = async (db, actor, recipient, room) => (await db.query("select public.soundspin_create_room_invitation($1,$2,$3) as id", [actor, recipient, room])).rows[0].id;
const accept = async (db, actor, id) => (await db.query("select public.soundspin_accept_room_invitation($1,$2) as result", [actor, id])).rows[0].result;
const befriend = async (db, a, b) => { await act(db, a, b, "request"); await act(db, b, a, "accept"); };

test("social migration restricts browser access, canonicalizes requests and enforces profile constraints", async () => {
  const db = await database();
  try {
    await db.exec("set role service_role");
    assert.equal(await act(db, alice, bob, "request"), "outgoing");
    assert.equal(await act(db, alice, bob, "request"), "outgoing");
    assert.equal(await act(db, bob, alice, "request"), "incoming");
    assert.equal((await db.query("select * from public.soundspin_friendships")).rows.length, 1);
    await assert.rejects(act(db, alice, alice, "request"), /another listener/);
    await assert.rejects(act(db, alice, bob, "accept"), /recipient/);
    assert.equal(await act(db, bob, alice, "accept"), "friends");
    assert.equal(await act(db, bob, alice, "accept"), "friends");
    await assert.rejects(act(db, alice, bob, "decline"), /Remove friend/);
    await act(db, bob, carol, "request");
    await db.query("insert into public.soundspin_social_settings(user_id,share_activity) values ($1,true),($2,false)", [alice, bob]);
    const invitation = await invite(db, alice, bob, "lounge");
    await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(act(db, alice, bob, "remove"), /permission denied/);
      await assert.rejects(invite(db, alice, bob, "lounge"), /permission denied/);
      await assert.rejects(accept(db, bob, invitation), /permission denied/);
      for (const table of ["soundspin_friendships", "soundspin_social_settings", "soundspin_room_invitations"]) {
        await assert.rejects(db.query(`delete from public.${table}`), /permission denied/);
        await assert.rejects(db.query(`update public.${table} set ${table === "soundspin_social_settings" ? "share_activity = true" : table === "soundspin_friendships" ? "status = 'accepted'" : "accepted_at = now()"}`), /permission denied/);
      }
      if (role === "anon") await assert.rejects(db.query("select * from public.soundspin_friendships"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec(`set test.uid = '${alice}'; set role authenticated`);
    assert.equal((await db.query("select * from public.soundspin_friendships")).rows.length, 1);
    assert.deepEqual((await db.query("select user_id,share_activity from public.soundspin_social_settings")).rows, [{ user_id: alice, share_activity: true }]);
    assert.equal((await db.query("select * from public.soundspin_room_invitations")).rows.length, 1);
    await assert.rejects(db.query("insert into public.soundspin_friendships(user_low,user_high,requested_by) values ($1,$2,$1)", [alice, carol]), /permission denied/);
    await assert.rejects(db.query("insert into public.soundspin_social_settings(user_id) values ($1)", [carol]), /permission denied/);
    await assert.rejects(db.query("insert into public.soundspin_room_invitations(sender_id,recipient_id,room_slug) values ($1,$2,'lounge')", [alice, carol]), /permission denied/);
    await db.exec(`reset role; set test.uid = '${carol}'; set role authenticated`);
    assert.equal((await db.query("select * from public.soundspin_room_invitations")).rows.length, 0);
    assert.equal((await db.query("select * from public.soundspin_social_settings")).rows.length, 0);
    await db.exec("reset role; set role service_role");
    await db.query("update public.soundspin_profiles set handle='alice_1', status_text='Friday songs', favorite_tracks='[{\"title\":\"Song\"}]' where user_id=$1", [alice]);
    await assert.rejects(db.query("update public.soundspin_profiles set handle='alice_1' where user_id=$1", [bob]), /unique constraint/);
    await assert.rejects(db.query("update public.soundspin_profiles set handle='INVALID' where user_id=$1", [bob]), /check constraint/);
    await assert.rejects(db.query("update public.soundspin_profiles set status_text=$2 where user_id=$1", [bob, "x".repeat(81)]), /check constraint/);
    await assert.rejects(db.query("update public.soundspin_profiles set favorite_tracks='[1]' where user_id=$1", [bob]), /check constraint/);
    await assert.rejects(db.query("update public.soundspin_profiles set favorite_tracks='[{},{},{},{}]' where user_id=$1", [bob]), /check constraint/);
    assert.equal(await act(db, carol, bob, "decline"), "none");
    assert.equal(await act(db, alice, bob, "remove"), "none");
    assert.equal(await act(db, alice, bob, "remove"), "none");
    const functions = (await db.query("select proname,prosecdef from pg_proc where proname in ('soundspin_friend_action','soundspin_create_room_invitation','soundspin_accept_room_invitation')")).rows;
    assert.equal(functions.length, 3); assert.equal(functions.every(row => row.prosecdef === false), true);
  } finally { await db.close(); }
});

test("SQL invitation acceptance rechecks friendship, expiry, recipient and private-room authority transactionally", async () => {
  const db = await database();
  try {
    await db.exec("set role service_role");
    await assert.rejects(invite(db, alice, bob, "lounge"), /accepted friends/);
    await befriend(db, alice, bob); await befriend(db, carol, bob);
    await assert.rejects(invite(db, bob, alice, "lounge"), /Join this room/);
    await assert.rejects(invite(db, carol, bob, "private-lounge"), /owner or a moderator/);
    const id = await invite(db, alice, bob, "private-lounge");
    assert.equal(await invite(db, alice, bob, "private-lounge"), id);
    await assert.rejects(accept(db, carol, id), /not found/);
    await db.query("update public.soundspin_rooms set owner_id=$1 where slug='private-lounge'", [carol]);
    await db.query("update public.soundspin_room_members set role='member' where room_slug='private-lounge' and user_id=$1", [alice]);
    await assert.rejects(accept(db, bob, id), /can no longer grant/);
    assert.equal((await db.query("select * from public.soundspin_room_members where room_slug='private-lounge' and user_id=$1", [bob])).rows.length, 0);
    assert.equal((await db.query("select accepted_at from public.soundspin_room_invitations where id=$1", [id])).rows[0].accepted_at, null);
    await db.query("update public.soundspin_rooms set owner_id=$1 where slug='private-lounge'", [alice]);
    assert.deepEqual(await accept(db, bob, id), { roomSlug: "private-lounge", passwordRequired: false });
    assert.deepEqual(await accept(db, bob, id), { roomSlug: "private-lounge", passwordRequired: false });
    assert.equal((await db.query("select role from public.soundspin_room_members where room_slug='private-lounge' and user_id=$1", [bob])).rows[0].role, "member");
    await db.query("delete from public.soundspin_room_members where room_slug='private-lounge' and user_id=$1", [bob]);
    await assert.rejects(accept(db, bob, id), /access was removed/);
    const replacement = await invite(db, alice, bob, "private-lounge");
    assert.notEqual(replacement, id);
    await assert.rejects(accept(db, bob, id), /not found/);
    await act(db, alice, bob, "remove");
    await assert.rejects(accept(db, bob, replacement), /no longer available/);
    await befriend(db, alice, bob);
    const publicId = await invite(db, alice, bob, "lounge");
    assert.deepEqual(await accept(db, bob, publicId), { roomSlug: "lounge", passwordRequired: true });
    const expiresId = await invite(db, alice, bob, "lounge");
    await db.query("update public.soundspin_room_invitations set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where id=$1", [expiresId]);
    await assert.rejects(accept(db, bob, expiresId), /expired/);
    assert.equal((await db.query("select accepted_at from public.soundspin_room_invitations where id=$1", [expiresId])).rows[0].accepted_at, null);
    const changedPrivacy = await invite(db, carol, bob, "lounge");
    await db.exec("update public.soundspin_rooms set is_public=false where slug='lounge'");
    await assert.rejects(accept(db, bob, changedPrivacy), /can no longer grant/);
    await db.query("insert into public.soundspin_room_members values ('lounge',$1,'moderator',now())", [bob]);
    assert.equal((await accept(db, bob, changedPrivacy)).passwordRequired, true);
    assert.equal((await db.query("select role from public.soundspin_room_members where room_slug='lounge' and user_id=$1", [bob])).rows[0].role, "moderator");
  } finally { await db.close(); }
});

test("SQL bounds friendship listings and pending invitations without creating excess records", async () => {
  const db = await database();
  try {
    const peers = Array.from({ length: 101 }, (_, index) => `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`);
    for (const peer of peers) { await db.query("insert into auth.users values ($1)", [peer]); await db.query("insert into public.soundspin_profiles(user_id,display_name) values ($1,'Peer')", [peer]); }
    await db.exec("set role service_role");
    for (const peer of peers.slice(0, 100)) await act(db, alice, peer, "request");
    await assert.rejects(act(db, alice, peers[100], "request"), /friends limit/);
    assert.equal((await db.query("select count(*)::integer as count from public.soundspin_friendships where user_low=$1 or user_high=$1", [alice])).rows[0].count, 100);
    for (const peer of peers.slice(0, 31)) await act(db, peer, alice, "accept");
    for (const peer of peers.slice(0, 30)) await invite(db, alice, peer, "lounge");
    await assert.rejects(invite(db, alice, peers[30], "lounge"), /Too many pending/);
    assert.equal((await db.query("select count(*)::integer as count from public.soundspin_room_invitations")).rows[0].count, 30);
  } finally { await db.close(); }
});
