import crypto from "node:crypto";
import { z } from "zod";
import type { Socket } from "socket.io";
import { trackSchema, queueTrackSchema, queueMoveSchema, queueNextSchema, playbackSchema, vibeVoteSchema, moderatorSchema, djRoleSchema, roomCommandSchemas } from "../shared/room-protocol.js";
import { PROVIDER_LABELS, roomAllowsProvider } from "../shared/providers.js";
import { effectiveRoomPolicy, hasRoomCapability } from "../shared/room-policy.js";
import { radioState, skipVoteSummary, trackEligibility, activeDjRestriction } from "./radio-policy.js";
import { appendModerationLog, ensureModeration } from "./room-access.js";
import { announcementSchema, changeAnnouncement } from "./announcements.js";
import { advanceRadio, appendQueueSet, canJoinDjQueue, privateQueue, removeDj, sameRecording, type QueueUndoRegistry } from "./radio.js";
import { resolveSavedSet, type SetImportRegistry, type createSavedSetResolver } from "./saved-set.js";
import { RoomCommandError, type safeSocketHandler } from "./socket-handler.js";
import type { Store, RoomChange } from "./store.js";
import type { RoomCommandService } from "./room-command-service.js";
import type { Room, User } from "./types.js";
import type { resolveTrackMappings } from "./provider-mappings.js";

interface Membership { room: Room; user: User }
interface RoomActionOptions {
  socket: Socket;
  onAction: (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => void;
  store: Store;
  commands: RoomCommandService;
  getMembership: (socketId: string) => Membership | null;
  assertAuthorized: () => void;
  broadcast: (room: Room) => void;
  rememberDj: (roomId: string, user: User) => void;
  forgetDj: (roomId: string, userId: string) => void;
  cancelEviction: (roomId: string, userId: string) => void;
  watchAnnouncement: (room: Room) => void;
  queueUndo: QueueUndoRegistry;
  setImports: SetImportRegistry;
  resolveTrack: (input: z.infer<typeof trackSchema>) => ReturnType<typeof resolveTrackMappings>;
  resolveSavedRecording: ReturnType<typeof createSavedSetResolver>;
  onlineUserIds?: (roomId:string)=>string[];
}

const fail = (message: string): never => { throw new RoomCommandError(message); };
const controlsPlayback = (room: Room, userId: string) => hasRoomCapability(room,userId,"djsPlayback") || (effectiveRoomPolicy(room).manualPlayback!=="staff"&&room.djUserId === userId);
const queueReceipt = <T>(operation: () => T): T => {
  try { return operation(); }
  catch (error) { return fail(error instanceof Error ? error.message : "This queue change is no longer available."); }
};

/** Feature boundary for admitted room commands. No draft is broadcast before saving. */
export function mountRoomActions(options: RoomActionOptions) {
  const { socket, onAction, store, commands } = options;
  const currentMember = () => options.getMembership(socket.id) || fail("Join a room first.");
  const assertCurrent = (member: Membership) => {
    options.assertAuthorized();
    const current = options.getMembership(socket.id);
    if (!socket.connected || !current || current.room !== member.room || current.user.id !== member.user.id) fail("Your room session changed. Join the room again.");
    if(member.room.moderation?.restrictions?.some(r=>r.userId===member.user.id&&r.kind==="room-ban"&&r.revokedAt===null&&(r.expiresAt===null||r.expiresAt>Date.now()))) fail("You are banned from this room.");
  };
  const action = <T>(event: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, change: (draft: Room, member: Membership, input: T) => RoomChange<Record<string, unknown>>) => {
    onAction(event, async (payload, reply) => {
      const input = schema.safeParse(payload);
      if (!input.success) return reply?.({ ok: false, error: "Invalid room command." });
      const member = currentMember();
      const result = await commands.execute(member.room, draft => { assertCurrent(member);if(["dj:join","queue:next","playback:update","playback:skip-vote","vibe:vote"].includes(event)&&draft.settings.requireRulesAcceptance&&draft.moderation?.rulesAcceptance?.[member.user.id]!==(draft.settings.rulesVersion??1))fail("Accept the room rules before participating.");return change(draft, member, input.data); });
      reply?.({ ok: true, ...result });
    });
  };
  const cleanupRemoved = (room: Room, previous: string[]) => {
    for (const id of previous.filter(id => !room.djQueueUserIds.includes(id))) {
      options.cancelEviction(room.id, id); options.forgetDj(room.id, id);
    }
  };
  onAction("room:moderator:set", async (payload, reply) => {
    const parsed = moderatorSchema.safeParse(payload); const member = currentMember();
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid moderator change." });
    if (parsed.data.roomId !== undefined && parsed.data.roomId !== member.room.id) fail("Your room session changed. Join the room again.");
    const previous = [...member.room.djQueueUserIds]; assertCurrent(member);
    await store.setModerator(member.room.id, member.user.id, parsed.data.userId, parsed.data.moderator, () => assertCurrent(member));
    cleanupRemoved(member.room, previous); options.broadcast(member.room); reply?.({ ok: true });
  });
  onAction("room:dj-role:set", async (payload, reply) => {
    const parsed = djRoleSchema.safeParse(payload); const member = currentMember();
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid DJ role change." });
    if (parsed.data.roomId !== undefined && parsed.data.roomId !== member.room.id) fail("Your room session changed. Join the room again.");
    const previous = [...member.room.djQueueUserIds]; assertCurrent(member);
    await store.setDjRole(member.room.id, member.user.id, parsed.data.userId, parsed.data.dj, () => assertCurrent(member));
    cleanupRemoved(member.room, previous); options.broadcast(member.room); reply?.({ ok: true });
  });
  action("dj:join", roomCommandSchemas["dj:join"], (draft, member, input) => {
    if(draft.settings.requireRulesAcceptance && draft.moderation?.rulesAcceptance?.[member.user.id] !== (draft.settings.rulesVersion??1)) fail("Accept the room rules before joining the DJ lineup.");
    if (!canJoinDjQueue(draft, member.user.id) && !(input?.override&&hasRoomCapability(draft,member.user.id,"djsPlayback")&&!activeDjRestriction(draft,member.user.id))) fail("DJ joins are locked, full, or require a DJ role.");
    if (!draft.djQueueUserIds.includes(member.user.id)) {
      const index = draft.djUserId ? draft.djQueueUserIds.indexOf(draft.djUserId) : -1;
      if (index >= 0) draft.djQueueUserIds.splice(index, 0, member.user.id); else draft.djQueueUserIds.push(member.user.id);
    }
    privateQueue(draft, member.user.id);
    if (!draft.playback.track) advanceRadio(draft);
    return { result: {}, committed: () => options.rememberDj(draft.id, member.user) };
  });
  action("dj:leave", z.unknown(), (draft, member) => {
    const wasCurrent = draft.djUserId === member.user.id;
    removeDj(draft, member.user.id); if (wasCurrent) advanceRadio(draft);
    return { result: {}, committed: () => { options.cancelEviction(draft.id, member.user.id); options.forgetDj(draft.id, member.user.id); } };
  });
  onAction("queue:add", async (payload, reply) => {
    const parsed = trackSchema.safeParse(payload); const member = currentMember();
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid track." });
    assertCurrent(member);
    if (!roomAllowsProvider(member.room.settings, parsed.data.provider)) fail(`${PROVIDER_LABELS[parsed.data.provider]} is disabled in this room.`);
    const resolved = await options.resolveTrack(parsed.data);
    const result = await commands.execute(member.room, draft => {
      assertCurrent(member);
      const recording = { ...parsed.data, ...resolved };
      if (!roomAllowsProvider(draft.settings, recording.provider)) fail(`${PROVIDER_LABELS[recording.provider]} is disabled in this room.`);
      if (draft.playback.track && sameRecording(draft.playback.track, recording)) fail("That track is already playing.");
      const queue = privateQueue(draft, member.user.id);
      const duplicate = queue.findIndex(track => sameRecording(track, recording));
      if (duplicate >= 0) fail(`That track is already #${duplicate + 1} in the queue.`);
      if (queue.length >= 1000) fail("Your waiting queue is full. Remove a track before adding another.");
      const track = { id: crypto.randomUUID(), ...recording, addedBy: member.user, addedAt: Date.now() };
      queue.push(track);
      if (!draft.playback.track && draft.djQueueUserIds.includes(member.user.id)) advanceRadio(draft);
      const started = draft.playback.track?.id === track.id;
      return { result: { started, position: started ? 0 : queue.length } };
    });
    reply?.({ ok: true, ...result });
  });
  onAction("queue:set-add", async (payload, reply) => {
    const input = roomCommandSchemas["queue:set-add"].safeParse(payload);
    const member = currentMember(); if (!input.success) return reply?.({ ok: false, error: "Invalid saved set." });
    assertCurrent(member);
    const result = await options.setImports.run(member.room, member.user.id, input.data.requestId, input.data.setId, async markCommitted => {
      const library = await store.getPrivateLibrary(member.user.id);
      const set = library.sets.find(value => value.id === input.data.setId);
      if (!set) fail("This saved set is no longer in your private library.");
      const resolved = await resolveSavedSet(set!.tracks, options.resolveSavedRecording);
      return commands.execute(member.room, draft => {
        assertCurrent(member);
        const enabledTracks = resolved.tracks.filter(track => roomAllowsProvider(draft.settings, track.provider));
        if (privateQueue(draft, member.user.id).length + enabledTracks.length > 1000) fail("Your waiting queue is full. Remove tracks before adding this set.");
        const appended = resolved.tracks.length ? appendQueueSet(draft, member.user, resolved.tracks) : { added: 0, skipped: [], started: false };
        const outcome = { ...appended, skipped: [...resolved.skipped, ...appended.skipped] };
        return { result: outcome, committed: () => markCommitted(outcome) };
      });
    });
    reply?.({ ok: true, ...result });
  });
  action("queue:remove", queueTrackSchema, (draft, member, input) => {
    const transaction = queueReceipt(() => options.queueUndo.beginRemove(member.room, member.user.id, input.trackId, Date.now(), draft));
    return { result: { undo: transaction.receipt }, committed: transaction.commit, rejected: () => { transaction.rollback(); } };
  });
  action("queue:undo", roomCommandSchemas["queue:undo"], (draft, member, input) => {
    const transaction = queueReceipt(() => options.queueUndo.beginRestore(member.room, member.user.id, input.token, Date.now(), draft));
    return { result: { position: transaction.result.position }, committed: transaction.commit, rejected: () => { transaction.rollback(); } };
  });
  action("queue:play-next", queueTrackSchema, (draft, member, input) => {
    const queue = privateQueue(draft, member.user.id); const index = queue.findIndex(track => track.id === input.trackId);
    if (index < 0) fail("Track not found.");
    if (!roomAllowsProvider(draft.settings, queue[index].provider)) fail(`${PROVIDER_LABELS[queue[index].provider]} is disabled in this room.`);
    queue.unshift(...queue.splice(index, 1)); return { result: {} };
  });
  action("queue:move", queueMoveSchema, (draft, member, input) => {
    const queue = privateQueue(draft, member.user.id); const index = queue.findIndex(track => track.id === input.trackId);
    if (index < 0) fail("Track not found."); const [track] = queue.splice(index, 1);
    queue.splice(Math.min(input.toIndex, queue.length), 0, track); return { result: {} };
  });
  action("queue:next", queueNextSchema, (draft, member, input) => {
    if (!controlsPlayback(draft, member.user.id)) fail("Only the current DJ or a room moderator can skip tracks.");
    if (draft.playback.track?.id !== input.trackId) fail("That track has already ended.");
    advanceRadio(draft); return { result: {} };
  });
  action("playback:ended",roomCommandSchemas["playback:ended"],(draft,member,input)=>{
    if(draft.djUserId!==member.user.id || draft.playback.origin==="fallback") fail("Only the current DJ can report track completion.");
    if(draft.playback.track?.id!==input.trackId || (input.revision!==undefined&&input.revision!==(draft.playback.revision??0))) fail("That track has already ended.");
    const track=draft.playback.track!;
    if(track.durationVerified&&track.durationMs&&!track.isLive){const elapsed=draft.playback.position+(draft.playback.playing?(Date.now()-draft.playback.updatedAt)/1000:0);if(elapsed<track.durationMs/1000-2)fail("The track has not reached its end.");}
    advanceRadio(draft);return {result:{}};
  });
  action("playback:stop-after",roomCommandSchemas["playback:stop-after"],(draft,member,input)=>{
    if(!hasRoomCapability(draft,member.user.id,"djsPlayback"))fail("Room playback permission is required.");
    if(input.enabled&&!draft.playback.track)fail("There is no current track.");
    radioState(draft).stopAfterTrackId=input.enabled?draft.playback.track!.id:null;appendModerationLog(draft,{action:input.enabled?"playback-stop-after":"playback-stop-cancel",actorId:member.user.id,reason:""});return {result:{}};
  });
  action("playback:resume",z.unknown(),(draft,member)=>{
    if(!hasRoomCapability(draft,member.user.id,"djsPlayback"))fail("Room playback permission is required.");
    const state=radioState(draft);state.stopped=false;state.stopAfterTrackId=null;if(!draft.playback.track)advanceRadio(draft);appendModerationLog(draft,{action:"playback-resume",actorId:member.user.id,reason:""});return {result:{}};
  });
  action("playback:skip-vote",roomCommandSchemas["playback:skip-vote"],(draft,member,input)=>{
    if(!effectiveRoomPolicy(draft).skipVote?.enabled)fail("Vote to skip is disabled.");
    if(draft.playback.track?.id!==input.trackId)fail("The track changed. Vote on the current track.");
    if(draft.playback.track!.addedBy.id===member.user.id)fail("You cannot vote to skip your own track.");
    const state=radioState(draft);if(state.skipVotes.trackId!==input.trackId)state.skipVotes={trackId:input.trackId,userIds:[]};
    state.skipVotes.userIds=state.skipVotes.userIds.filter(id=>id!==member.user.id);if(input.vote)state.skipVotes.userIds.push(member.user.id);
    const summary=skipVoteSummary(draft,member.user.id,options.onlineUserIds?.(draft.id)??[member.user.id]);
    if(summary.count>=summary.required)advanceRadio(draft);return {result:{}};
  });
  action("queue:exception",queueTrackSchema,(draft,member,input)=>{
    if(!hasRoomCapability(draft,member.user.id,"djsPlayback"))fail("Room playback permission is required.");
    const track=Object.values(draft.djQueues).flat().find(t=>t.id===input.trackId);if(!track)fail("Track not found.");
    radioState(draft).exceptions[input.trackId]=draft.policyRevision??0;
    appendModerationLog(draft,{actorId:member.user.id,action:"track-exception",targetUserId:track!.addedBy.id,reason:track!.title});
    return {result:{}};
  });
  action("queue:exception-request",queueTrackSchema,(draft,member,input)=>{
    const track=privateQueue(draft,member.user.id).find(t=>t.id===input.trackId);if(!track)fail("Track not found.");
    const reason=trackEligibility(draft,track!);if(!reason||!(/Duration|minute limit/.test(reason)))fail("This track does not need a length exception.");
    const moderation=ensureModeration(draft);
    if(moderation.reports.some(r=>r.trackId===input.trackId&&r.status==="open"))return{result:{}};
    if(moderation.reports.filter(r=>r.reporterId===member.user.id&&r.createdAt>Date.now()-3600000).length>=5)fail("Too many reports. Try again in an hour.");
    moderation.reports.push({id:crypto.randomUUID(),reporterId:member.user.id,targetUserId:member.user.id,trackId:input.trackId,category:"track-exception",reason:track!.title,createdAt:Date.now(),status:"open"});return{result:{}};
  });
  onAction("fallback:set",async(payload,reply)=>{
    const input=roomCommandSchemas["fallback:set"].safeParse(payload),member=currentMember();if(!input.success)fail("Invalid fallback set.");assertCurrent(member);
    const data=input.data!;
    if(!hasRoomCapability(member.room,member.user.id,"roomDetailsMusic"))fail("Room music policy permission is required.");
    let tracks:Awaited<ReturnType<typeof resolveSavedSet>>|undefined;
    if(data.setId){const library=await store.getPrivateLibrary(member.user.id);const set=library.sets.find(s=>s.id===data.setId);if(!set)fail("Saved set not found.");tracks=await resolveSavedSet(set!.tracks,options.resolveSavedRecording);if(tracks.skipped.length)fail("Every fallback track must be available. Fix the saved set and try again.");}
    await commands.execute(member.room,draft=>{assertCurrent(member);if(!hasRoomCapability(draft,member.user.id,"roomDetailsMusic"))fail("Room music policy permission is required.");const state=radioState(draft);if(tracks){const copies=tracks.tracks.map(t=>({...t,id:crypto.randomUUID(),addedBy:member.user,addedAt:Date.now()}));if(copies.some(t=>!t.durationVerified||!t.durationMs||t.isLive))fail("Fallback requires verified finite recordings.");state.fallback.tracks=copies;state.fallback.cursor=0;}if(data.enabled&&!state.fallback.tracks.length)fail("Choose a saved set first.");state.fallback.enabled=data.enabled;appendModerationLog(draft,{actorId:member.user.id,action:"fallback-set",reason:"",details:{enabled:data.enabled,replaced:Boolean(tracks),count:state.fallback.tracks.length}});if(!draft.playback.track)advanceRadio(draft);return{result:{}};});reply?.({ok:true});
  });
  action("playback:update", playbackSchema, (draft, member, input) => {
    if (!controlsPlayback(draft, member.user.id)) fail("Only the current DJ or a room moderator controls playback.");
    if (draft.playback.track?.id !== input.trackId) fail("Invalid playback update.");
    draft.playback = { ...draft.playback, playing: input.playing, position: input.position, updatedAt: Date.now() };radioState(draft).fallback.autoPaused=false; return { result: {} };
  });
  action("room:announcement", announcementSchema, (draft, member, input) => {
    if(!hasRoomCapability(draft,member.user.id,"roomDetailsMusic"))fail(draft.moderatorUserIds.includes(member.user.id)?"Room details permission is required.":"Only room owners and moderators can edit the room note.");
    try { changeAnnouncement(draft, member.user.id, input); } catch (error) { fail((error as Error).message); }
    return { result: {}, committed: () => options.watchAnnouncement(member.room) };
  });
  action("vibe:vote", vibeVoteSchema, (draft, member, input) => {
    const track = draft.playback.track; if (!track) fail("There is no track to vote on.");
    if (input.trackId && input.trackId !== track!.id) fail("The track changed. React to the current track instead.");
    if (track!.addedBy.id === member.user.id) fail("You cannot vote on a track you added.");
    if (!draft.vibe || draft.vibe.trackId !== track!.id) draft.vibe = { trackId: track!.id, votes: {} };
    if (input.value === 0) delete draft.vibe.votes[member.user.id]; else draft.vibe.votes[member.user.id] = input.value;
    return { result: {} };
  });
}
