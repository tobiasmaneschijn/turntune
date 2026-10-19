import assert from "node:assert/strict";
import test from "node:test";
import { SecurityBudget,claimSocketAccount } from "./security-budget.js";
import { EventEmitter } from "node:events";
import { validateServerConfig } from "./config.js";

test("a failed multi-key budget does not spend another user's available capacity", () => {
  let now=1000; const budget=new SecurityBudget(()=>now);
  const peer={key:"peer",maximum:1,windowMs:1000};
  assert.equal(budget.consume([peer]),true);
  assert.equal(budget.consume([peer,{key:"user",maximum:1,windowMs:1000}]),false);
  assert.equal(budget.consume([{key:"user",maximum:1,windowMs:1000}]),true);
  now=2000; assert.equal(budget.consume([peer]),true);
});
test("capacity fails closed and concurrent leases release only once", async () => {
  const budget=new SecurityBudget(()=>1000,2);
  assert.equal(budget.consume([{key:"a",maximum:1,windowMs:1000},{key:"b",maximum:1,windowMs:1000}]),true);
  assert.equal(budget.consume([{key:"c",maximum:1,windowMs:1000}]),false);
  const release=budget.acquire("work",1)!; assert.equal(budget.acquire("work",1),null);
  release();release(); const next=budget.acquire("work",1); assert.ok(next);next();
  await assert.rejects(budget.run("work",0,async()=>1),/Too many/);
});
test("missing production or unspecified configuration never enables anonymous startup", () => {
  assert.throws(()=>validateServerConfig({}),/authentication is required/);
  assert.throws(()=>validateServerConfig({NODE_ENV:"production"}),/authentication is required/);
  assert.doesNotThrow(()=>validateServerConfig({NODE_ENV:"test"}));
  assert.doesNotThrow(()=>validateServerConfig({NODE_ENV:"development"}));
  assert.throws(()=>validateServerConfig({NODE_ENV:"test",SUPABASE_URL:"https://example.invalid"}),/Incomplete/);
});
test("production pins the project JWKS source without inline or credential overrides",()=>{
  const env={NODE_ENV:"production",SUPABASE_URL:"https://project.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture-public",SUPABASE_SECRET_KEY:"fixture-secret",SUPABASE_JWKS_URL:"https://project.invalid/auth/v1/.well-known/jwks.json"};
  assert.doesNotThrow(()=>validateServerConfig(env));
  assert.throws(()=>validateServerConfig({...env,SUPABASE_JWKS:JSON.stringify({keys:[]})}),/unset SUPABASE_JWKS/);
  assert.throws(()=>validateServerConfig({...env,SUPABASE_JWKS_URL:"https://viewer@project.invalid/auth/v1/.well-known/jwks.json"}),/configured project's Auth JWKS/);
  assert.doesNotThrow(()=>validateServerConfig({...env,SUPABASE_JWKS:"  "}));
  assert.doesNotThrow(()=>validateServerConfig({...env,NODE_ENV:"test",SUPABASE_JWKS:JSON.stringify({keys:[]})}));
});

test("local sign-in rejects a mismatched project JWKS before serving authenticated requests", () => {
  const env = { NODE_ENV: "development", SUPABASE_URL: "https://project.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture-public",
    SUPABASE_SECRET_KEY: "fixture-secret", SUPABASE_JWKS_URL: "https://other-project.invalid/auth/v1/.well-known/jwks.json" };
  assert.throws(() => validateServerConfig(env), /configured project's Auth JWKS/);
  assert.doesNotThrow(() => validateServerConfig({ ...env, SUPABASE_JWKS_URL: "https://project.invalid/auth/v1/.well-known/jwks.json" }));
  const local = { ...env, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_JWKS_URL: "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json" };
  assert.doesNotThrow(() => validateServerConfig(local));
  assert.throws(() => validateServerConfig({ ...local, NODE_ENV: "production" }), /HTTPS project origin/);
});
test("aborted namespace handshakes release account slots even without disconnect",()=>{
  const budget=new SecurityBudget();
  const socket=()=>Object.assign(new EventEmitter(),{conn:Object.assign(new EventEmitter(),{readyState:"open"})});
  for(let attempt=0;attempt<20;attempt++){
    const pending=socket();claimSocketAccount(budget,pending,"actor");
    pending.conn.readyState="closed";pending.conn.emit("close");
    pending.emit("disconnect"); // A later disconnect cannot double-release.
  }
  const valid=Array.from({length:5},socket);for(const connection of valid)claimSocketAccount(budget,connection,"actor");
  assert.throws(()=>claimSocketAccount(budget,socket(),"actor"),/Too many/);
  for(const connection of valid)connection.conn.emit("close");
  const closed=socket();closed.conn.readyState="closed";
  assert.throws(()=>claimSocketAccount(budget,closed,"actor"),/connection has ended/);
  assert.doesNotThrow(()=>claimSocketAccount(budget,socket(),"actor"));
});
