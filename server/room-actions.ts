import crypto from "node:crypto";
import { z } from "zod";
import type { Socket } from "socket.io";
import { trackSchema, queueTrackSchema, queueMoveSchema, queueNextSchema, playbackSchema, vibeVoteSchema, moderatorSchema, djRoleSchema, roomCommandSchemas } from "../shared/room-protocol.js";
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
}

const fail = (message: string): never => { throw new RoomCommandError(message); };
const controlsPlayback = (room: Room, userId: string) => room.djUserId === userId || room.ownerUserId === userId || room.moderatorUserIds.includes(userId);
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
  };
  const action = <T>(event: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, change: (draft: Room, member: Membership, input: T) => RoomChange<Record<string, unknown>>) => {
    onAction(event, async (payload, reply) => {
      const input = schema.safeParse(payload);
      if (!input.success) return reply?.({ ok: false, error: "Invalid room command." });
      const member = currentMember();
      const result = await commands.execute(member.room, draft => { assertCurrent(member); return change(draft, member, input.data); });
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
  action("dj:join", z.unknown(), (draft, member) => {
    if (!canJoinDjQueue(draft, member.user.id)) fail("This room requires a DJ role or moderator access.");
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
    if (!member.room.djQueueUserIds.includes(member.user.id)) fail("Join the DJ queue before adding tracks.");
    const resolved = await options.resolveTrack(parsed.data);
    const result = await commands.execute(member.room, draft => {
      assertCurrent(member);
      if (!canJoinDjQueue(draft, member.user.id) || !draft.djQueueUserIds.includes(member.user.id)) fail("Your DJ membership changed. Try again from your current room.");
      const recording = { ...parsed.data, ...resolved };
      if (draft.playback.track && sameRecording(draft.playback.track, recording)) fail("That track is already playing.");
      const queue = privateQueue(draft, member.user.id);
      const duplicate = queue.findIndex(track => sameRecording(track, recording));
      if (duplicate >= 0) fail(`That track is already #${duplicate + 1} in the queue.`);
      if (queue.length >= 1000) fail("Your waiting queue is full. Remove a track before adding another.");
      queue.push({ id: crypto.randomUUID(), ...recording, addedBy: member.user, addedAt: Date.now() });
      const started = !draft.playback.track; if (started) advanceRadio(draft);
      return { result: { started, position: started ? 0 : queue.length } };
    });
    reply?.({ ok: true, ...result });
  });
  onAction("queue:set-add", async (payload, reply) => {
    const input = roomCommandSchemas["queue:set-add"].safeParse(payload);
    const member = currentMember(); if (!input.success) return reply?.({ ok: false, error: "Invalid saved set." });
    assertCurrent(member);
    if (!canJoinDjQueue(member.room, member.user.id) || !member.room.djQueueUserIds.includes(member.user.id)) fail("Join the DJ lineup with permission before adding a set.");
    const result = await options.setImports.run(member.room, member.user.id, input.data.requestId, input.data.setId, async markCommitted => {
      const library = await store.getPrivateLibrary(member.user.id);
      const set = library.sets.find(value => value.id === input.data.setId);
      if (!set) fail("This saved set is no longer in your private library.");
      const resolved = await resolveSavedSet(set!.tracks, options.resolveSavedRecording);
      return commands.execute(member.room, draft => {
        assertCurrent(member);
        if (!canJoinDjQueue(draft, member.user.id) || !draft.djQueueUserIds.includes(member.user.id)) fail("Join the DJ lineup with permission before adding a set.");
        if (privateQueue(draft, member.user.id).length + resolved.tracks.length > 1000) fail("Your waiting queue is full. Remove tracks before adding this set.");
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
    if (index < 0) fail("Track not found."); queue.unshift(...queue.splice(index, 1)); return { result: {} };
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
  action("playback:update", playbackSchema, (draft, member, input) => {
    if (!controlsPlayback(draft, member.user.id)) fail("Only the current DJ or a room moderator controls playback.");
    if (draft.playback.track?.id !== input.trackId) fail("Invalid playback update.");
    draft.playback = { ...draft.playback, playing: input.playing, position: input.position, updatedAt: Date.now() }; return { result: {} };
  });
  action("room:announcement", announcementSchema, (draft, member, input) => {
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
