import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountDeletionService } from "./account-deletion.js";

function fixture() {
  const calls:string[]=[],updates:Array<Record<string,unknown>>=[],roomChecks:string[][]=[];
  let pending=0,roomPending=0,exists=true,deleteFailure=false;
  const job={id:"11111111-1111-4111-8111-111111111111",user_id:"22222222-2222-4222-8222-222222222222",state:"running",owned_room_count:3,owned_room_slugs:["owned-room","second-room","archived-room"],stage:"requested"};
  const client={
    rpc:async(name:string)=>{calls.push(name);return {data:name==="soundspin_claim_account_deletion"?job:name==="soundspin_erase_archived_account"?{remaining:false}:null,error:null};},
    from:(table:string)=>{
      let kind="select",head=false,roomFilter=false;
      const query:Record<string,unknown>={};
      for(const method of ["eq","in","lt","lte","order","limit","maybeSingle","single"])query[method]=()=>query;
      query.in=(column:string,values:string[])=>{if(column==="room_slug"){roomFilter=true;roomChecks.push(values);}return query;};
      query.select=(_fields:string,options?:{head?:boolean})=>{head=Boolean(options?.head);return query;};
      query.update=(value:Record<string,unknown>)=>{kind="update";if(table==="soundspin_account_deletion_jobs")updates.push(value);return query;};
      query.delete=()=>{kind="delete";return query;};
      query.then=(resolve:(value:unknown)=>void)=>{calls.push(`${table}:${kind}`);resolve({data:table==="soundspin_rooms"?exists?[{slug:"owned-room"}]:[]:[],count:head&&table==="soundspin_storage_deletion_outbox"?(roomFilter?roomPending:pending):0,error:null});};
      return query;
    },
    auth:{admin:{getUserById:async()=>({data:{user:exists?{id:job.user_id}:null},error:null}),deleteUser:async()=>{calls.push("auth-delete");if(deleteFailure)return{error:{status:503}};exists=false;return{error:null};}}}
  } as unknown as SupabaseClient;
  const service=new AccountDeletionService(client,{
    disconnectProviders:async()=>{calls.push("disconnect-providers");},
    onAccountRestricted:()=>{calls.push("disconnect-account");},
    onRoomRestricted:()=>{calls.push("disconnect-room");},
    eraseAccountData:async()=>{calls.push("erase-live-room-data");}
  });
  return{service,calls,updates,roomChecks,setPending:(count:number)=>{pending=count;},setRoomPending:(count:number)=>{roomPending=count;},setDeleteFailure:(value:boolean)=>{deleteFailure=value;}};
}

test("account erasure never deletes Auth before failed or pending Storage cleanup; retry completes",async()=>{
  const f=fixture();f.setPending(1);
  const result=await f.service.runNext();assert.equal(result?.complete,false);
  assert.equal(f.calls.includes("auth-delete"),false);
  assert.ok(f.calls.indexOf("soundspin_restrict_deletion_account")<f.calls.indexOf("soundspin_enqueue_upload_deletion"));
  assert.ok(f.updates.some(value=>value.state==="failed"));
  assert.equal(JSON.stringify(f.updates).includes("token"),false);
  f.setPending(0);f.setRoomPending(1);f.calls.length=0;
  assert.equal((await f.service.runNext())?.complete,false,"foreign uploads in an owned room must also finish before Auth deletion");
  assert.equal(f.calls.includes("auth-delete"),false);
  assert.deepEqual(f.roomChecks.at(-1),["owned-room","second-room","archived-room"]);
  f.setRoomPending(0);f.calls.length=0;f.roomChecks.length=0;
  assert.equal((await f.service.runNext())?.complete,true);
  assert.equal(f.roomChecks.length,2,"the complete room inventory is checked together before and after Auth deletion");
  assert.ok(f.calls.indexOf("disconnect-providers")<f.calls.indexOf("auth-delete"));
  assert.ok(f.calls.indexOf("erase-live-room-data")<f.calls.indexOf("auth-delete"));
  assert.ok(f.calls.indexOf("soundspin_erase_archived_account")<f.calls.indexOf("auth-delete"));
  assert.ok(f.calls.indexOf("auth-delete")<f.calls.indexOf("soundspin_complete_account_deletion"));
});

test("Auth deletion failure retains the saved owned-room inventory and resumes all steps",async()=>{
  const f=fixture();f.setDeleteFailure(true);
  assert.equal((await f.service.runNext())?.complete,false);
  assert.ok(f.updates.some(value=>Array.isArray(value.owned_room_slugs)&&value.owned_room_slugs.includes("owned-room")));
  assert.equal(f.calls.includes("soundspin_complete_account_deletion"),false);
  f.setDeleteFailure(false);
  assert.equal((await f.service.runNext())?.complete,true);
});
