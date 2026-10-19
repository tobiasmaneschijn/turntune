import assert from "node:assert/strict";
import test from "node:test";
import { advanceRadio,canJoinDjQueue,normalizeRadioState,roomForListener } from "./radio.js";
import { radioState,recordTrackStart,trackEligibility,skipVoteSummary,roomSession } from "./radio-policy.js";
import { effectiveRoomPolicy,hasRoomCapability } from "../../../shared/room-policy.js";
import { parseIsoDuration } from "../music/track-metadata.js";
import type {Room,Track,User} from "../../types.js";
const user=(id:string):User=>({id,name:id,avatarSeed:id});
const track=(id:string,by="a"):Track=>({id,provider:"youtube",providerId:id,title:id,addedBy:user(by),addedAt:1,durationMs:60_000,durationVerified:true});
const room=():Room=>({id:"policy-room",name:"Policy",ownerUserId:"owner",moderatorUserIds:["mod"],djRoleUserIds:[],isPublic:true,passwordProtected:false,settings:{},djUserId:null,djQueueUserIds:["a","b"],djQueues:{a:[track("a1"),track("a2"),track("a3")],b:[track("b1","b"),track("b2","b")]},history:[],playback:{track:null,playing:false,position:0,updatedAt:1},vibe:null,createdAt:1});
test("songs per turn captures a limit, rotates and yields when no track is eligible",()=>{
  const r=room();r.settings.songsPerTurn=2;assert.equal(advanceRadio(r,100)?.id,"a1");r.settings.songsPerTurn=3;assert.equal(advanceRadio(r,200)?.id,"a2");assert.equal(advanceRadio(r,300)?.id,"b1");
  r.settings.maxTrackMinutes=1;r.djQueues.b[0].durationVerified=false;assert.equal(advanceRadio(r,400)?.id,"a3");assert.equal(r.djQueues.b.length,1);
});
test("stop after current archives once without consuming the next item, survives normalization",()=>{
  const r=room();advanceRadio(r,100);radioState(r).stopAfterTrackId="a1";assert.equal(advanceRadio(r,200),null);assert.equal(radioState(r).stopped,true);assert.equal(r.djQueues.b[0].id,"b1");
  const restored=structuredClone(r);normalizeRadioState(restored);assert.equal(advanceRadio(restored,300),null);assert.equal(restored.history.length,1);assert.equal(restored.djQueues.b.length,2);radioState(restored).stopped=false;assert.equal(advanceRadio(restored,400)?.id,"b1");
});
test("repeat ledger retains more than display history and rechecks saved items",()=>{
  const r=room();r.settings.repeatWindowMinutes=1440;for(let i=0;i<150;i++)recordTrackStart(r,track(`recording-${i}`),1000+i);
  assert.match(trackEligibility(r,track("recording-0"),2000)??"",/repeat/);assert.equal(r.history.length,0);
  assert.equal(trackEligibility(r,track("recording-0"),86_401_001),null);
});
test("untrusted duration requires a revision-bound exception while private state stays private",()=>{
  const r=room();r.settings.maxTrackMinutes=5;r.djQueues.a[0].durationVerified=false;r.policyRevision=2;assert.match(trackEligibility(r,r.djQueues.a[0],100)??"",/unknown/);
  radioState(r,100).exceptions.a1=2;assert.equal(trackEligibility(r,r.djQueues.a[0],100),null);r.policyRevision=3;assert.match(trackEligibility(r,r.djQueues.a[0],100)??"",/unknown/);
  const json=JSON.stringify(roomForListener(r,"b"));assert.equal(json.includes('"repeatLedger"'),false);assert.equal(json.includes('"exceptions"'),false);assert.equal(json.includes('"id":"a1"'),false);
});
test("fallback is room owned, never joins its copying owner, and returns to DJs at a boundary",()=>{
  const r=room();r.djQueues={a:[],b:[]};radioState(r).fallback={enabled:true,tracks:[track("fallback","owner")],cursor:0,autoPaused:false};advanceRadio(r,100);
  assert.equal(r.djUserId,null);assert.equal(r.playback.origin,"fallback");assert.deepEqual(r.djQueueUserIds,["a","b"]);const id=r.playback.track!.id;normalizeRadioState(r);assert.equal(r.djUserId,null);assert.equal(r.playback.track!.id,id);
  r.djQueues.a.push(track("a-later"));assert.equal(advanceRadio(r,200)?.id,"a-later");assert.equal(r.playback.origin,"dj");
});
test("capacity includes disconnected lineup members and policy overlays restore latest baseline",()=>{
  const r=room();r.settings.djCapacity=2;assert.equal(canJoinDjQueue(r,"c"),false);assert.equal(canJoinDjQueue(r,"a"),true);
  r.settings.chatMode="everyone";r.settings.sessionOverrides=[{id:"overlay",kind:"staff-chat",expiresAt:200,authorId:"owner"}];assert.equal(effectiveRoomPolicy(r,100).chatMode,"staff");r.settings.chatMode="staff";assert.equal(effectiveRoomPolicy(r,300).chatMode,"staff");
  r.settings.moderatorPermissions={chatParticipants:false,djsPlayback:true,roomDetailsMusic:true,accessInvites:true};assert.equal(hasRoomCapability(r,"mod","chatParticipants"),false);assert.equal(hasRoomCapability(r,"owner","chatParticipants"),true);
});
test("skip vote totals count distinct current listeners and exclude contributor",()=>{
  const r=room();advanceRadio(r,100);radioState(r).skipVotes.userIds=["b","gone"];r.settings.skipVote={enabled:true,minimum:1,percent:60};const summary=skipVoteSummary(r,"b",["a","b","b","c"]);assert.equal(summary.count,1);assert.equal(summary.required,2);assert.equal(summary.voted,true);assert.equal(r.playback.track?.id,"a1");
});
test("scheduled themes overlay manual changes only for their interval and parse finite duration",()=>{
  const r=room();r.settings.themePrompt="Manual";r.settings.themeSchedules=[{id:"session",theme:"Theme",startsAt:100,endsAt:200,timeZone:"Europe/Paris",note:"Session note"}];assert.equal(roomSession(r,150).theme,"Theme");r.settings.themePrompt="New manual";assert.equal(roomSession(r,200).theme,"New manual");assert.equal(roomSession(r,200).sessionNote,null);assert.equal(parseIsoDuration("PT1H2M3S"),3_723_000);assert.equal(parseIsoDuration("PT0S"),undefined);
});
test("new rules gate the next selection while preserving private waiting tracks",()=>{
  const r=room();r.settings.songsPerTurn=2;advanceRadio(r,100);
  r.settings.requireRulesAcceptance=true;r.settings.rulesVersion=2;
  assert.equal(advanceRadio(r,200),null);assert.equal(r.djQueues.a.length,2);assert.equal(r.djQueues.b.length,2);
  r.moderation={restrictions:[],log:[],reports:[],warnings:[],members:{},receipts:{},inviteLinks:[],rulesAcceptance:{b:2},cancelledInvitations:[]};
  assert.equal(advanceRadio(r,300)?.id,"b1");assert.equal(r.djQueues.a.length,2);
});
