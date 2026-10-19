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
