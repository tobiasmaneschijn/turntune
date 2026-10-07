import assert from "node:assert/strict";
import test from "node:test";
import { mountRoomActions } from "./room-actions.js";
import { safeSocketHandler } from "./socket-handler.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "./store.js";
import { RoomCommandService } from "./room-command-service.js";
import { reconcileDjPresence } from "./dj-presence.js";
import { RoomCommandError } from "./socket-handler.js";
import { QueueUndoRegistry } from "./radio.js";
import type { Room, User } from "./types.js";

function rolesFixture() {
  const handlers = new Map<string, ReturnType<typeof safeSocketHandler>>();
  const calls: Array<{ role: string; roomId: string; actor: string; target: string; enabled: boolean }> = [];
  const user: User = { id: "owner", name: "Owner", avatarSeed: "owner" };
  const room = { id: "room-b", djQueueUserIds: [] } as unknown as Room;
  const options = {
    socket: { id: "socket", connected: true },
    onAction: (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => handlers.set(event, safeSocketHandler(handler)),
    getMembership: () => ({ room, user }), assertAuthorized: () => {}, broadcast: () => {},
    store: {
      setModerator: async (roomId: string, actor: string, target: string, enabled: boolean) => { calls.push({ role: "moderator", roomId, actor, target, enabled }); },
      setDjRole: async (roomId: string, actor: string, target: string, enabled: boolean) => { calls.push({ role: "dj", roomId, actor, target, enabled }); }
    },
    cancelEviction: () => {}, forgetDj: () => {}
  } as unknown as Parameters<typeof mountRoomActions>[0];
  mountRoomActions(options);
  const run = async (event: string, payload: unknown) => {
    let result: { ok: boolean; error?: string } | undefined;
    await handlers.get(event)!(payload, (reply: { ok: boolean; error?: string }) => { result = reply; });
    return result;
  };
  return { calls, run };
}
const target = "11111111-1111-4111-8111-111111111111";

test("delayed role actions for another room are rejected before changing current room membership", async () => {
  const { calls, run } = rolesFixture();
  for (const [event, field] of [["room:moderator:set", "moderator"], ["room:dj-role:set", "dj"]]) {
    const result = await run(event, { roomId: "room-a", userId: target, [field]: true });
    assert.equal(result?.ok, false);
    assert.match(result?.error || "", /room session changed/);
  }
  assert.deepEqual(calls, []);
});

test("matching and legacy optional-room role payloads preserve verified current membership identity", async () => {
  const { calls, run } = rolesFixture();
  assert.deepEqual(await run("room:moderator:set", { roomId: "room-b", userId: target, moderator: true, actor: "forged" }), { ok: true });
  assert.deepEqual(await run("room:dj-role:set", { userId: target, dj: false }), { ok: true });
  assert.deepEqual(calls, [
    { role: "moderator", roomId: "room-b", actor: "owner", target, enabled: true },
    { role: "dj", roomId: "room-b", actor: "owner", target, enabled: false }
  ]);
});

test("malformed optional room identifiers do not reach either role mutation", async () => {
  const { calls, run } = rolesFixture();
  for (const roomId of ["", "../room-b", 42, null]) {
    assert.equal((await run("room:moderator:set", { roomId, userId: target, moderator: true }))?.ok, false);
    assert.equal((await run("room:dj-role:set", { roomId, userId: target, dj: true }))?.ok, false);
  }
  assert.deepEqual(calls, []);
});

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

for (const secondTab of [false, true]) {
  test(`a DJ join committed after disconnect ${secondTab ? "preserves a surviving account tab" : "schedules eviction for the final account socket"}`, async () => {
    const started = gate(); const unblock = gate(); let hold = false;
    const store = new Store({ supabase: { from() { return { update({ state }: { state: Room }) {
      const query = { eq() { return query; }, select() { return query; }, async maybeSingle() {
        if (hold) { started.release(); await unblock.promise; }
        return { data: { slug: state.id }, error: null };
      } }; return query;
    } }; } } as unknown as SupabaseClient });
    const user: User = { id: "alice", name: "Alice", avatarSeed: "alice" };
    const room: Room = { id: "room-one", name: "One", ownerUserId: user.id, moderatorUserIds: [], djRoleUserIds: [],
      isPublic: true, passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
      playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 };
    await store.saveRoom(room); hold = true;
    const socket = { id: "first", connected: true };
    const online = new Map<string, User>([[socket.id, user]]);
    if (secondTab) online.set("second", user);
    const effects: string[] = [];
    const handlers = new Map<string, ReturnType<typeof safeSocketHandler>>();
    mountRoomActions({
      socket, store, commands: new RoomCommandService(store, () => {}),
      getMembership: () => socket.connected ? { room, user } : null,
      onAction: (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => handlers.set(event, safeSocketHandler(handler)),
      assertAuthorized: () => {},
      rememberDj: (roomId: string, remembered: User) => reconcileDjPresence(store.getRoom(roomId)!, remembered, {
        onlineUsers: online.values(), remember: () => effects.push("remember"),
        scheduleEviction: () => effects.push("evict"), cancelEviction: () => effects.push("cancel")
      })
    } as unknown as Parameters<typeof mountRoomActions>[0]);
    let result: { ok: boolean; error?: string } | undefined;
    const pending = handlers.get("dj:join")!(undefined, (reply: { ok: boolean; error?: string }) => { result = reply; });
    await started.promise;
    assert.deepEqual(room.djQueueUserIds, []);
    socket.connected = false; online.delete(socket.id);
    // Disconnect cannot schedule a DJ eviction yet: that entry is still a draft.
    assert.deepEqual(effects, []);
    unblock.release(); await pending;
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(room.djQueueUserIds, [user.id]);
    assert.deepEqual(effects, ["remember", secondTab ? "cancel" : "evict"]);
  });
}

for (const role of ["moderator", "dj"] as const) {
  for (const ended of ["departed", "expired"] as const) {
    test(`a queued ${role} change rechecks its ${ended} socket before writing`, async () => {
      const started = gate(); const unblock = gate(); let hold = false; let roleWrites = 0;
      const room: Room = { id: "room-one", name: "One", ownerUserId: "owner", moderatorUserIds: [], djRoleUserIds: [],
        isPublic: true, passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
        playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 };
      const store = new Store({ supabase: {
        from(table: string) {
          const query = {
            select() { return query; }, eq() { return query; },
            async single() { return { data: { owner_id: "owner" }, error: null }; },
            async maybeSingle() {
              if (table === "soundspin_room_members") return { data: { role: "member" }, error: null };
              if (hold) { started.release(); await unblock.promise; }
              return { data: { slug: room.id }, error: null };
            },
            update() { return query; }
          }; return query;
        },
        async rpc() { roleWrites++; return { data: true, error: null }; }
      } as unknown as SupabaseClient });
      await store.saveRoom(room); hold = true;
      const user: User = { id: "owner", name: "Owner", avatarSeed: "owner" };
      const socket = { id: "socket", connected: true }; let expired = false;
      const handlers = new Map<string, ReturnType<typeof safeSocketHandler>>();
      mountRoomActions({ socket, store, getMembership: () => socket.connected ? { room, user } : null,
        onAction: (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => handlers.set(event, safeSocketHandler(handler)),
        assertAuthorized: () => { if (expired) throw new RoomCommandError("Session expired."); }, broadcast: () => assert.fail("rejected role broadcast")
      } as unknown as Parameters<typeof mountRoomActions>[0]);
      const prior = store.changeRoom(room, draft => { draft.name = "Earlier command"; return { result: undefined }; });
      await started.promise;
      let result: { ok: boolean; error?: string } | undefined;
      const pending = handlers.get(`room:${role === "moderator" ? "moderator" : "dj-role"}:set`)!(
        { roomId: room.id, userId: target, [role]: true }, (reply: { ok: boolean; error?: string }) => { result = reply; });
      // Settle the owner's preliminary reads while the prior write still holds the room queue.
      await new Promise<void>(resolve => setImmediate(resolve));
      if (ended === "departed") socket.connected = false; else expired = true;
      unblock.release(); await prior; await pending;
      assert.equal(result?.ok, false);
      assert.match(result?.error || "", ended === "departed" ? /room session changed/ : /expired/);
      assert.equal(roleWrites, 0);
      assert.deepEqual(room.moderatorUserIds, []); assert.deepEqual(room.djRoleUserIds, []);
    });
  }
}

test("a role change rechecks the socket after an awaited ownership verification", async () => {
  const started = gate(); const unblock = gate(); let ownerReads = 0; let writes = 0;
  const room = { id: "room-one", ownerUserId: "owner", moderatorUserIds: [], djRoleUserIds: [], djQueueUserIds: [], settings: {} } as unknown as Room;
  const store = new Store({ supabase: {
    from() { const query = { select() { return query; }, eq() { return query; }, update() { return query; },
      async maybeSingle() { return { data: { slug: room.id }, error: null }; },
      async single() { if (++ownerReads === 2) { started.release(); await unblock.promise; } return { data: { owner_id: "owner" }, error: null }; }
    }; return query; }, async rpc() { writes++; return { data: true, error: null }; }
  } as unknown as SupabaseClient });
  await store.saveRoom(room);
  const user: User = { id: "owner", name: "Owner", avatarSeed: "owner" }; const socket = { id: "socket", connected: true };
  const handlers = new Map<string, ReturnType<typeof safeSocketHandler>>();
  mountRoomActions({ socket, store, getMembership: () => ({ room, user }), assertAuthorized: () => {},
    onAction: (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => handlers.set(event, safeSocketHandler(handler))
  } as unknown as Parameters<typeof mountRoomActions>[0]);
  let result: { ok: boolean; error?: string } | undefined;
  const pending = handlers.get("room:moderator:set")!({ roomId: room.id, userId: target, moderator: true }, (reply: { ok: boolean; error?: string }) => { result = reply; });
  await started.promise; socket.connected = false; unblock.release(); await pending;
  assert.equal(result?.ok, false); assert.match(result?.error || "", /room session changed/);
  assert.equal(writes, 0); assert.deepEqual(room.moderatorUserIds, []);
});

test("real queue handlers preserve deliberate receipt errors and reject set imports before provider work", async () => {
  const room = { id: "room-one", ownerUserId: "alice", moderatorUserIds: [], djRoleUserIds: [], djQueueUserIds: [], djQueues: {},
    settings: {}, history: [], playback: { track: null } } as unknown as Room;
  const user: User = { id: "alice", name: "Alice", avatarSeed: "alice" };
  const handlers = new Map<string, ReturnType<typeof safeSocketHandler>>(); let storageFails = false;
  mountRoomActions({ socket: { id: "socket", connected: true }, getMembership: () => ({ room, user }), assertAuthorized: () => {},
    onAction: (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => handlers.set(event, safeSocketHandler(handler, () => {})),
    queueUndo: new QueueUndoRegistry(),
    commands: { execute: async (_room: Room, change: (draft: Room) => { result: unknown }) => {
      const result = change(structuredClone(room));
      if (storageFails) throw new Error("Private database internals");
      return result.result;
    } },
    store: { getPrivateLibrary: () => assert.fail("unadmitted import fetched private library") },
    setImports: { run: () => assert.fail("unadmitted import entered provider workflow") }
  } as unknown as Parameters<typeof mountRoomActions>[0]);
  const run = async (event: string, payload: unknown) => {
    let result: { ok: boolean; error?: string } | undefined;
    await handlers.get(event)!(payload, (reply: { ok: boolean; error?: string }) => { result = reply; }); return result;
  };
  assert.match((await run("queue:undo", { token: target }))?.error || "", /Undo expired/);
  assert.match((await run("queue:remove", { trackId: target }))?.error || "", /no longer in your queue/);
  assert.match((await run("queue:set-add", { setId: target, requestId: target }))?.error || "", /Join the DJ lineup/);
  storageFails = true;
  assert.equal((await run("dj:join", undefined))?.error, "Could not save this change. Please reconnect to check the room and try again.");
});
