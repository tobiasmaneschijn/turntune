import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "./store.js";
import { emptyModeration } from "./room-access.js";
import type { Room,User } from "./types.js";

const listener:User={id:"listener",name:"Listener",avatarSeed:"listener"};
function fixture(id="test-room"):Room{return{id,name:id,ownerUserId:"owner",moderatorUserIds:[],djRoleUserIds:[],isPublic:false,passwordProtected:false,settings:{accessMode:"members"},djUserId:null,djQueueUserIds:[],djQueues:{},history:[],playback:{track:null,playing:false,position:0,updatedAt:1},vibe:null,createdAt:1,moderation:{...emptyModeration(),members:{listener:{user:listener,role:"member",joinedAt:1}}}};}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}

test("a join queued behind revocation cannot recreate private membership or register presence",async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"soundspin-release-admission-"));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const store=new Store({supabase:null,dataDir});await store.init();
  const room=store.getOrCreateLocalRoom("test-room",fixture);
  const barrier=deferred(),entered=deferred();let registered=false;
  const revoke=store.withRoomOperation(room.id,async()=>{entered.resolve();await barrier.promise;delete room.moderation!.members.listener;});
  await entered.promise;
  const admission=store.admitRoom(room,listener,null,()=>undefined,()=>{registered=true;});
  barrier.resolve();await revoke;
  await assert.rejects(admission,/no longer have access/);
  assert.equal(registered,false);assert.equal(room.moderation!.members.listener,undefined);
});

test("live registration completes before a later ordered revocation runs",async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"soundspin-release-order-"));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const store=new Store({supabase:null,dataDir});await store.init();
  const room=store.getOrCreateLocalRoom("test-room",fixture);const admitted=new Set<string>();
  const admission=store.admitRoom(room,listener,null,()=>undefined,()=>{admitted.add(listener.id);});
  const revocation=store.withRoomOperation(room.id,async()=>{assert.equal(admitted.has(listener.id),true);admitted.delete(listener.id);delete room.moderation!.members.listener;});
  await admission;await revocation;assert.equal(admitted.size,0);
});

test("durable room cache evicts inactive rooms by count and bytes and preserves pinned rooms",async()=>{
  const db={from(table:string){let id="";const q={select(){return q;},eq(_key:string,value:string){id=value;return q;},in(){return q;},async maybeSingle(){return{data:table==="soundspin_rooms"?{state:{...fixture(id),padding:"x".repeat(500)},name:id,owner_id:"owner",is_public:false,settings:{accessMode:"members"},access_mode:"members"}:table==="soundspin_room_moderation"?{data:emptyModeration()}:null,error:null};},then(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};return q;}} as unknown as SupabaseClient;
  const store=new Store({supabase:db,maxCachedRooms:2,maxCachedRoomBytes:1800});const pinned=new Set<string>();
  store.setRoomCacheHooks(()=>undefined,id=>pinned.has(id));
  await store.loadRoom("room-a");await store.loadRoom("room-b");
  assert.equal(store.getRoom("room-a"),undefined,"byte ceiling evicts the least recently touched unpinned room");
  assert.ok(store.getRoom("room-b"));pinned.add("room-b");
  await assert.rejects(store.loadRoom("room-c"),/room service is busy/);
  assert.ok(store.getRoom("room-b"));assert.equal(store.cachedRoomCount,1);assert.ok(store.cachedRoomBytes<=1800);
});

test("startup loads seventy active sessions without exhausting the bounded Supabase request budget", async () => {
  const { createBoundedAdminClient } = await import("./supabase-client.js");
  const slugs = Array.from({ length: 70 }, (_, index) => `session-${String(index).padStart(4, "0")}`);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  let metadataRequests = 0;
  let activeMetadata = 0;
  let maximumMetadata = 0;
  const client = createBoundedAdminClient({
    env: {
      url: "https://fixture.supabase.co",
      publishableKeys: { default: "sb_publishable_fixture" },
      secretKeys: { default: "sb_secret_fixture" }
    },
    fetcher: async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/soundspin_rooms") && url.searchParams.get("select") === "slug") {
        return Response.json(slugs.map(slug => ({ slug })));
      }
      if (!url.pathname.endsWith("/soundspin_rooms")) return Response.json([]);
      metadataRequests++;
      activeMetadata++;
      maximumMetadata = Math.max(maximumMetadata, activeMetadata);
      try {
        // Keep concurrent metadata requests in flight so unbounded fanout fails
        // the real SDK fetch budget rather than passing through instant mocks.
        await new Promise(resolve => setTimeout(resolve, 3));
        const id = url.searchParams.get("slug")?.slice(3);
        assert.ok(id && slugs.includes(id));
        const room = {
          ...fixture(id), ownerUserId: ownerId, isPublic: true,
          settings: { accessMode: "public" as const, djAccess: "everyone" as const },
          moderation: emptyModeration()
        };
        return Response.json([{ state: room, name: id, owner_id: ownerId,
          is_public: true, password_hash: null, settings: room.settings,
          access_mode: "public", policy_revision: 0 }]);
      } finally {
        activeMetadata--;
      }
    }
  });
  const rooms = await new Store({ supabase: client }).listSessionRooms();
  assert.deepEqual(rooms.map(room => room.id), slugs);
  assert.equal(metadataRequests, 70);
  assert.ok(maximumMetadata > 1, "the session loader still makes bounded parallel progress");
  assert.ok(maximumMetadata <= 8, "session metadata loading leaves capacity for authenticated API traffic");
  assert.equal(activeMetadata, 0);
});
