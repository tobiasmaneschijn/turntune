import assert from "node:assert/strict";
import test from "node:test";
import { createAppleMusicSession } from "../src/apple-music-session.js";

function token(expiresAt: number) {
  return `test.${Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString("base64url")}.test`;
}


test("switching accounts cannot finish an Apple sign-in request for the previous listener", async () => {
  let oldSignal: AbortSignal | undefined, resolveOld!: (value: {developerToken:string}) => void;
  const configurations: string[] = [];
  const session=createAppleMusicSession({
    now:()=>100_000,
    requestToken: async (identity,signal) => identity === "alice" ? new Promise<{developerToken:string}>(resolve=>{oldSignal=signal;resolveOld=resolve;}) : {developerToken:token(1_000_000)},
    configure: async()=>{configurations.push("configured");return {identity:"bob"};},
  });
  const old=session.get("alice"); const rejected=assert.rejects(old,/session changed/);
  await session.reset(); assert.equal(oldSignal?.aborted,true);
  const latest=await session.get("bob");
  resolveOld({developerToken:token(1_000_000)}); await rejected;
  assert.equal(session.current(),latest); assert.deepEqual(configurations,["configured"]);
});

test("switching accounts revokes an Apple session that finishes connecting late", async()=>{
  let resolveOld!:()=>void, entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const calls:string[]=[];
  const session=createAppleMusicSession({
    now:()=>100_000,
    requestToken: async(identity)=>({developerToken:token(identity==="alice"?1_000_000:2_000_000)}),
    configure:async(payload)=>{
      const identity=payload.developerToken===token(1_000_000)?"alice":"bob";
      calls.push(`configure:${identity}`);
      if(identity==="alice") {entered();await new Promise<void>(resolve=>{resolveOld=resolve;});}
      return {identity};
    },
    dispose:async(instance)=>{calls.push(`unauthorize:${instance.identity}`);},
  });
  const old=session.get("alice");const rejected=assert.rejects(old,/session changed/);await ready;
  const teardown=session.reset(),latest=session.get("bob");
  resolveOld();await rejected;await teardown;
  assert.equal((await latest).identity,"bob");
  assert.deepEqual(calls,["configure:alice","unauthorize:alice","configure:bob"]);
});
