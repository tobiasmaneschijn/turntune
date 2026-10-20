import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("moderation schema keeps records private and commits bans, membership, logs and radio atomically", async () => {
  const db = new PGlite(), owner = "11111111-1111-4111-8111-111111111111", listener = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.soundspin_rooms(slug text primary key,name text,owner_id uuid references auth.users(id),is_public boolean,password_hash text,settings jsonb,state jsonb,updated_at timestamptz);
      create table public.soundspin_room_members(room_slug text references public.soundspin_rooms(slug),user_id uuid references auth.users(id),role text check(role in ('owner','moderator','dj','member')),updated_at timestamptz,primary key(room_slug,user_id));
      create table public.soundspin_friendships(user_low uuid,user_high uuid,status text);
      create table public.soundspin_room_invitations(id uuid primary key default gen_random_uuid(),sender_id uuid,recipient_id uuid,room_slug text,created_at timestamptz default now(),expires_at timestamptz,accepted_at timestamptz);
      alter table public.soundspin_rooms enable row level security; alter table public.soundspin_room_members enable row level security;
      grant select,insert,update,delete on public.soundspin_rooms,public.soundspin_room_members,public.soundspin_friendships,public.soundspin_room_invitations to service_role;
      grant select on public.soundspin_room_invitations to authenticated;
      insert into auth.users values('${owner}'),('${listener}');
      insert into public.soundspin_rooms values('lounge','Original','${owner}',true,null,'{}','{"queue":[]}',now());
      insert into public.soundspin_room_members values('lounge','${owner}','owner',now()),('lounge','${listener}','member',now());`);
    await db.exec(await readFile(new URL("../../supabase/migrations/20261009073625_room_moderation_and_access.sql", import.meta.url), "utf8"));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.soundspin_room_moderation"), /permission denied/);
      await assert.rejects(db.query("select * from public.soundspin_room_invitations"), /permission denied/);
      await assert.rejects(db.query("select public.soundspin_commit_room_v2('lounge','{}')"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const privateState = { restrictions: [{ id: "ban", userId: listener, kind: "room-ban", revokedAt: null, expiresAt: null }], log: [{ id: "event", action: "ban", actorId: owner, targetUserId: listener }] };
    const radio = { queue: ["next"], moderation: { secret: "must be stripped" } };
    await assert.rejects(db.query("select public.soundspin_commit_room_v2('lounge',$1,$2,$3,'{}',$4)", [radio, { name: "Changed" }, { user_id: listener, role: "invalid" }, privateState]), /check constraint/);
    assert.equal((await db.query("select name from public.soundspin_rooms")).rows[0].name, "Original");
    assert.equal((await db.query("select * from public.soundspin_room_moderation")).rows.length, 0);
    await db.query("select public.soundspin_commit_room_v2('lounge',$1,$2,null,$3,$4)", [radio, { access_mode: "members", policy_revision: 1 }, [listener], privateState]);
    assert.deepEqual((await db.query("select access_mode,is_public,policy_revision,state from public.soundspin_rooms")).rows[0], { access_mode: "members", is_public: false, policy_revision: 1, state: { queue: ["next"] } });
    assert.equal((await db.query("select public.soundspin_room_has_ban('lounge',$1) as banned", [listener])).rows[0].banned, true);
    assert.equal((await db.query("select * from public.soundspin_room_members where user_id=$1", [listener])).rows.length, 0);
    await assert.rejects(db.query("select public.soundspin_commit_room_v2('lounge','{}','{}',null,'{}',$1)", [{ log: [] }]), /append-only/);
    await assert.rejects(db.query("select public.soundspin_commit_room_v2('lounge','{}','{}',null,$1,$2)", [[owner], privateState]), /owner cannot be removed/);
    // The existing direct invitation defaults stay intact, while every route
    // checks cancellation, current inviter authority, bans, and prior removal.
    await db.query("insert into public.soundspin_rooms(slug,name,owner_id,is_public,settings,state,updated_at) values('open','Open',$1,true,'{}','{}',now())", [owner]);
    await db.query("insert into public.soundspin_friendships values($1,$2,'accepted')", [owner, listener]);
    const invite = async () => (await db.query("select public.soundspin_create_room_invitation($1,$2,'open') as id", [owner, listener])).rows[0].id;
    const firstInvite = await invite();
    assert.equal(await invite(), firstInvite);
    assert.equal((await db.query("select extract(epoch from(expires_at-created_at)) as ttl from public.soundspin_room_invitations where id=$1", [firstInvite])).rows[0].ttl, '3600.000000');
    await db.query("select public.soundspin_commit_room_v2('open','{}','{}',null,'{}',$1)", [{ cancelledInvitations: [firstInvite], log: [] }]);
    await assert.rejects(db.query("select public.soundspin_accept_room_invitation($1,$2)", [listener, firstInvite]), /cancelled/);
    const secondInvite = await invite();
    assert.notEqual(secondInvite, firstInvite);
    await db.query("select public.soundspin_commit_room_v2('open','{}','{}',null,'{}',$1)", [{ log: [], restrictions: privateState.restrictions }]);
    await assert.rejects(db.query("select public.soundspin_accept_room_invitation($1,$2)", [listener, secondInvite]), /banned/);
    await assert.rejects(invite(), /banned/);
    await db.query("select public.soundspin_commit_room_v2('open','{}',$1,null,'{}',$2)", [{ access_mode: 'members' }, { log: [], restrictions: [] }]);
    await db.query("select public.soundspin_accept_room_invitation($1,$2)", [listener, secondInvite]);
    assert.equal((await db.query("select role from public.soundspin_room_members where room_slug='open' and user_id=$1", [listener])).rows[0].role, 'member');
    await db.query("select public.soundspin_commit_room_v2('open','{}','{}',null,$1,$2)", [[listener], { log: [], restrictions: [] }]);
    await assert.rejects(db.query("select public.soundspin_accept_room_invitation($1,$2)", [listener, secondInvite]), /access was removed/);
    await db.exec("reset role");
    assert.equal((await db.query("select prosecdef from pg_proc where proname='soundspin_commit_room_v2'")).rows[0].prosecdef, false);
  } finally { await db.close(); }
});
