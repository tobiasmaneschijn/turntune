import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PlatformSecurity } from "./platform-security.js";
import { securityEvent, securityEventSnapshot } from "./security-events.js";

test("platform gates fail closed outside explicit local fixtures and verify trusted Auth confirmation",async()=>{
  assert.equal(await new PlatformSecurity(null).activeAccount("any"),false);
  assert.equal(await new PlatformSecurity(null,true).activeAccount("any"),true);
  let state: string|null=null,confirmed=false,failed=false,authReads=0;
  const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:state?{state}:null,error:failed?{message:"private DB detail"}:null})})})}),
    auth:{admin:{getUserById:async()=>{authReads++;return{data:{user:{email_confirmed_at:confirmed?"2026-10-13T00:00:00Z":null,user_metadata:{email_verified:true}}},error:null};}}}} as unknown as SupabaseClient;
  const gate=new PlatformSecurity(client);
  assert.equal(await gate.activeAccount("user"),false,"metadata claim cannot substitute for confirmed Auth identity");
  confirmed=true;gate.invalidate("user");assert.equal(await gate.activeAccount("user"),true);
  assert.equal(await gate.activeAccount("user"),true);assert.equal(authReads,2,"confirmation cache is bounded, restriction reads stay fresh");
  state="suspended";assert.equal(await gate.activeAccount("user"),false,"cached confirmed identity cannot bypass immediate suspension");
  failed=true;await assert.rejects(gate.activeAccount("user"),/could not be verified/);
});

test("security event fields are bounded, redacted and keep fixed metric labels during log sampling",()=>{
  const original=console.log,lines:string[]=[];console.log=(line)=>{lines.push(String(line));};
  try {
    securityEvent("admin_change","success",{requestId:"bad\nsecret=token",actorId:"password:secret",durationMs:Infinity,count:-10});
    const row=JSON.parse(lines[0]);assert.equal(row.requestId,undefined);assert.equal(row.actorId,undefined);assert.equal(row.durationMs,undefined);assert.equal(row.count,0);
    for(let index=0;index<100;index++)securityEvent("authorization_denied","denied",{requestId:"safe-id",status:403});
    assert.equal(lines.length,61);assert.ok(securityEventSnapshot()["authorization_denied:denied"]>=100);
    assert.ok(lines.every(line=>!line.includes("secret")));
  }finally {console.log=original;}
});

test("maintenance batches fresh restrictions while unconfirmed and newly suspended accounts stay blocked",async()=>{
  const denied = new Set<string>(), disabled = new Set<string>();
  const batches: Array<{ p_accounts: string[]; p_rooms: string[] }> = [];
  let failed = false, authFailed = false, authReads = 0, failedBatch = -1;
  const client = { rpc: async (name: string, input: { p_accounts: string[]; p_rooms: string[] }) => {
    assert.equal(name, "soundspin_access_status"); batches.push(input);
    return { data: { accounts: [...input.p_accounts.filter(id => !denied.has(id)), "not-requested"],
      rooms: [...input.p_rooms.filter(slug => !disabled.has(slug)), "not-requested"] }, error: failed || batches.length === failedBatch ? { message: "private" } : null };
  }, auth: { admin: { getUserById: async (id: string) => {
    if (authFailed && id === "unavailable") return { data: { user: null }, error: { status: 503 } };
    authReads++; return { data: { user: { email_confirmed_at: id === "pending" ? null : "2026-10-20T00:00:00Z" } }, error: null };
  } } } } as unknown as SupabaseClient;
  const gate = new PlatformSecurity(client);
  let result = await gate.checkConnections(["alice", "alice", "pending"], ["lounge"]);
  assert.deepEqual([...result.accounts], [["alice", true], ["pending", false]]);
  assert.deepEqual([...result.rooms], [["lounge", true]]);
  denied.add("alice"); disabled.add("lounge");
  result = await gate.checkConnections(["alice", "pending"], ["lounge"]);
  assert.equal(result.accounts.get("alice"), false); assert.equal(result.rooms.get("lounge"), false);
  assert.equal(authReads, 2, "restriction refresh does not refetch cached trusted confirmation");
  await gate.checkAccess(Array.from({ length: 205 }, (_, i) => `user-${i}`), []);
  assert.deepEqual(batches.slice(2).map(batch => batch.p_accounts.length), [100, 100, 5]);
  authFailed = true;
  result = await gate.checkConnections(["alice", "unavailable", "pending"], ["lounge"]);
  assert.equal(result.accounts.get("alice"), false, "known suspension survives another account's Auth outage");
  assert.equal(result.rooms.get("lounge"), false, "known room disable survives another account's Auth outage");
  assert.equal(result.accounts.get("pending"), false);
  assert.equal(result.accounts.has("unavailable"), false, "an unverifiable identity remains unknown during maintenance");
  await assert.rejects(gate.checkAccess(["unavailable"], []), /identity could not be verified/, "commands still fail closed");
  authFailed = false;
  assert.equal((await gate.checkConnections(["unavailable"], [])).accounts.get("unavailable"), true, "unknown identities can recover on the next check");
  const manyAccounts = ['alice', ...Array.from({ length: 200 }, (_, index) => `batch-user-${index}`)];
  const manyRooms = ['lounge', ...Array.from({ length: 200 }, (_, index) => `batch-room-${index}`)];
  failedBatch = batches.length + 2;
  result = await gate.checkConnections(manyAccounts, manyRooms);
  assert.equal(result.accounts.get('alice'), false, 'a later batch outage retains an earlier suspension');
  assert.equal(result.rooms.get('lounge'), false, 'a later batch outage retains an earlier room restriction');
  assert.equal(result.accounts.has('batch-user-99'), false);
  assert.equal(result.rooms.has('batch-room-99'), false);
  assert.equal(result.accounts.get('batch-user-199'), true, 'maintenance continues after the unavailable batch');
  assert.equal(result.rooms.get('batch-room-199'), true);
  failedBatch = -1;
  result = await gate.checkConnections(['batch-user-99'], ['batch-room-99']);
  assert.equal(result.accounts.get('batch-user-99'), true); assert.equal(result.rooms.get('batch-room-99'), true);
  failedBatch = batches.length + 2;
  await assert.rejects(gate.checkAccess(manyAccounts, manyRooms), /could not be verified/, 'strict checks reject a later batch failure');
  failed = true; await assert.rejects(gate.checkAccess(["alice"], []), /could not be verified/);
});
