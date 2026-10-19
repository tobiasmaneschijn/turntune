import assert from "node:assert/strict";
import test from "node:test";
import { mountRoomActions } from "./room-actions.js";
import { safeSocketHandler } from "../../realtime/socket-handler.js";
import { advanceRadio } from "./radio.js";
import { radioState } from "./radio-policy.js";
import { RoomSessionScheduler } from "./room-session-scheduler.js";
import type { Room,User } from "../../types.js";
import type { RoomCommandService } from "./room-command-service.js";
const user=(id:string):User=>({id,name:id,avatarSeed:id});
const state=():Room=>({id:"music-room",name:"Music",ownerUserId:"owner",moderatorUserIds:[],djRoleUserIds:[],isPublic:true,passwordProtected:false,settings:{manualPlayback:"staff",skipVote:{enabled:true,minimum:2,percent:60}},djUserId:null,djQueueUserIds:["dj"],djQueues:{dj:["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"].map(id=>({id,provider:"youtube",providerId:id,title:id,addedBy:user("dj"),addedAt:1}))},history:[],playback:{track:null,playing:false,position:0,updatedAt:1},vibe:null,createdAt:1});
function harness(room:Room){
  const handlers=new Map<string,ReturnType<typeof safeSocketHandler>>();let actor="dj",chain:Promise<unknown>=Promise.resolve();
  const commands={execute:async(_room:Room,change:(draft:Room)=>{result:unknown}|Promise<{result:unknown}>)=>{const operation=chain.then(async()=>{const draft=structuredClone(room),result=await change(draft);Object.assign(room,draft);return result.result;});chain=operation.catch(()=>{});return operation;}} as RoomCommandService;
  mountRoomActions({socket:{id:"socket",connected:true},onAction:(event:string,handler:Parameters<typeof safeSocketHandler>[0])=>handlers.set(event,safeSocketHandler(handler,()=>{})),commands,getMembership:()=>({room,user:user(actor)}),assertAuthorized:()=>{},onlineUserIds:()=>["dj","listener-a","listener-b"],store:{}} as unknown as Parameters<typeof mountRoomActions>[0]);
  return{commands,setActor:(value:string)=>{actor=value;},run:async(event:string,payload:unknown)=>{let result:{ok:boolean;error?:string}|undefined;await handlers.get(event)!(payload,(reply:{ok:boolean;error?:string})=>{result=reply;});return result!;}};
}
test("staff-only manual control preserves current DJ natural completion and rejects stale duplicate end",async()=>{
  const room=state();advanceRadio(room,100);const h=harness(room),trackId=room.playback.track!.id,revision=room.playback.revision;
  assert.equal((await h.run("queue:next",{trackId})).ok,false);
  assert.equal((await h.run("playback:ended",{trackId,revision})).ok,true);
  assert.equal((await h.run("playback:ended",{trackId,revision})).ok,false);assert.equal(room.history.length,1);
});
test("distinct skip votes and simultaneous stale commands produce one advancement",async()=>{
  const room=state();advanceRadio(room,100);const h=harness(room),trackId=room.playback.track!.id;
  h.setActor("listener-a");assert.equal((await h.run("playback:skip-vote",{trackId,vote:true})).ok,true);assert.equal(room.playback.track?.id,trackId);
  await h.run("playback:skip-vote",{trackId,vote:true});assert.equal(radioState(room).skipVotes.userIds.length,1);
  h.setActor("listener-b");const results=await Promise.all([h.run("playback:skip-vote",{trackId,vote:true}),h.run("playback:skip-vote",{trackId,vote:true})]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(room.history.length,1);
});
test("fallback recovery advances an overdue play once then pauses until admission without overriding manual pause",async()=>{
  const room=state();room.djQueues.dj=[];const fallback={id:"source",provider:"youtube" as const,providerId:"fallback",title:"Fallback",addedBy:user("owner"),addedAt:1,durationMs:1000,durationVerified:true};radioState(room).fallback={enabled:true,tracks:[fallback],cursor:0,autoPaused:false};advanceRadio(room,1000);
  let now=5000,online=0;const h=harness(room);const scheduler=new RoomSessionScheduler(h.commands,()=>{},()=>online,()=>now);
  try{const before=room.playback.track!.id;await scheduler.recover(room);assert.notEqual(room.playback.track!.id,before);assert.equal(room.history.length,1);assert.equal(room.playback.playing,false);assert.equal(radioState(room).fallback.autoPaused,true);
    online=1;now=6000;const id=room.playback.track!.id;await scheduler.reconcilePresence(room);assert.equal(room.playback.track!.id,id);assert.equal(room.playback.playing,true);
    room.playback.playing=false;radioState(room).fallback.autoPaused=false;await scheduler.reconcilePresence(room);assert.equal(room.playback.playing,false);
  }finally{scheduler.clear();}
});
