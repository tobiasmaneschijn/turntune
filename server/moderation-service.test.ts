import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Store } from "./store.js";
import { ModerationService, MODERATION_MAX_RECEIPTS, MODERATION_RECEIPT_TTL_MS } from "./moderation-service.js";
import { emptyModeration, isRoomBanned } from "./room-access.js";
import { roomForListener } from "./radio.js";
import type { Room } from "./types.js";
import { RoomCommandError } from "./socket-handler.js";

async function fixture(t: { after: (run: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-moderation-"));
  t.after(async () => { const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(os.tmpdir())); assert.ok(path.basename(target).startsWith("soundspin-moderation-")); await rm(target, { recursive: true, force: true }); });
  const store = new Store({ dataDir: directory, supabase: null }); await store.init();
  const room: Room = { id: "test-room", name: "Room", ownerUserId: "owner", moderatorUserIds: ["mod", "peer"], djRoleUserIds: [], isPublic: true, passwordProtected: false,
    settings: { djAccess: "everyone" }, djUserId: null, djQueueUserIds: ["listener"], djQueues: { listener: [] }, history: [], playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: Date.now(), moderation: emptyModeration() };
  room.moderation!.members.listener = { user: { id: "listener", name: "Listener", avatarSeed: "listener" }, role: "member", joinedAt: Date.now() };
  await store.saveRoom(room); return { store, room, directory };
}

test("moderation preserves listening/queues, enforces staff hierarchy, is idempotent and survives expiry/restart", async t => {
  const { store, room, directory } = await fixture(t); let now = Date.now(); const ejected: string[] = [];
  const service = new ModerationService(store, { now: () => now, revokeAdmission: (_room, user) => { ejected.push(user); } });
  await assert.rejects(service.act(room.id, "mod", { requestId: randomUUID(), action: "ban", userId: "peer" }), /owner/);
  await service.act(room.id, "mod", { requestId: randomUUID(), action: "timeout", userId: "listener", durationMinutes: 5 });
  assert.deepEqual(ejected, []); assert.deepEqual(room.djQueueUserIds, ["listener"]); assert.ok(room.djQueues.listener);
  const requestId = randomUUID(); await service.act(room.id, "owner", { requestId, action: "ban", userId: "mod", durationMinutes: 5 });
  await service.act(room.id, "owner", { requestId, action: "ban", userId: "mod", durationMinutes: 5 });
  assert.deepEqual(ejected, ["mod"]); assert.ok(isRoomBanned(room, "mod"));
  await assert.rejects(service.act(room.id, "mod", { requestId: randomUUID(), action: "session", kind: "staff-chat" }), /banned/);
  const restored = new Store({ dataDir: directory, supabase: null }); await restored.init(); const next = restored.getRoom(room.id)!;
  assert.ok(isRoomBanned(next, "mod")); assert.equal(Object.hasOwn(roomForListener(next, "listener"), "moderation"), false);
  now += 6 * 60000; await new ModerationService(restored, { now: () => now }).expire(next);
  assert.equal(isRoomBanned(next, "mod"), false); assert.equal(next.moderation!.log.filter(item => item.action === "restriction-expired").length, 2);
});

test("offline role revocation, member removal and mixed permission edits have distinct authority", async t => {
  const { store, room } = await fixture(t); const service = new ModerationService(store);
  await service.act(room.id, "owner", { requestId: randomUUID(), action: "role", userId: "peer", role: "member" });
  assert.equal(room.moderatorUserIds.includes("peer"), false); assert.equal((await store.getRoomAccess(room.id, "peer")).role, "member");
  await assert.rejects(store.updateRoomSettings(room.id, "mod", { name: "Forbidden", moderatorPermissions: { chatParticipants: true, djsPlayback: true, roomDetailsMusic: true, accessInvites: true } }), /Only the owner/);
  assert.equal(room.name, "Room");
  await store.updateRoomSettings(room.id, "owner", { accessMode: "members", rulesText: "Room rules", requireRulesAcceptance: true });
  await service.acceptRules(room.id, "listener", room.settings.rulesVersion!); assert.equal(service.ownStatus(room, "listener").rulesAccepted, true);
  const rulesVersion = room.settings.rulesVersion;
  await store.updateRoomSettings(room.id, "owner", { rulesText: "  Room rules  " });
  assert.equal(room.settings.rulesVersion, rulesVersion); assert.equal(service.ownStatus(room, "listener").rulesAccepted, true);
  await service.act(room.id, "owner", { requestId: randomUUID(), action: "member-remove", userId: "peer" });
  assert.equal((await store.getRoomAccess(room.id, "peer")).role, null);
});

test("invite links are bounded/idempotent and temporary controls restore edited lasting policy", async t => {
  const { store, room } = await fixture(t); let now = Date.now(); const service = new ModerationService(store, { now: () => now });
  await store.updateRoomSettings(room.id, "owner", { accessMode: "members" });
  const requestId = randomUUID(), linkInput = { requestId, action: "create-link", maxUses: 1 };
  const link = await service.invitationAction(room.id, "owner", linkInput);
  assert.equal(JSON.stringify(room.moderation).includes(link.token as string), false);
  const recovered = await service.invitationAction(room.id, "owner", linkInput);
  assert.equal(recovered.tokenUnavailable, true); assert.equal(recovered.token, undefined);
  const first = await service.redeemLink(room.id, "new-member", link.token as string, randomUUID()); assert.equal(first.ok, true);
  await service.redeemLink(room.id, "new-member", link.token as string, randomUUID());
  await assert.rejects(service.redeemLink(room.id, "other-member", link.token as string, randomUUID()), /use limit/);
  await service.act(room.id, "owner", { requestId: randomUUID(), action: "session", kind: "slow-mode", value: 10, durationMinutes: 5 });
  await store.updateRoomSettings(room.id, "owner", { slowModeSeconds: 30 }); now += 6 * 60000; await service.expire(room);
  assert.equal(room.settings.slowModeSeconds, 30); assert.deepEqual(room.settings.sessionOverrides, []);
});

test("warnings are private and acknowledged; report targets, limits and permission changes are enforced", async t => {
  const { store, room } = await fixture(t); const messageId = randomUUID();
  const service = new ModerationService(store, { isAdmitted: () => true, validateMessage: async (_room, id) => id === messageId ? { userId: "listener" } : null });
  const warning = await service.act(room.id, "owner", { requestId: randomUUID(), action: "warn", userId: "listener", reason: "Keep chat on topic." });
  const warningId = (warning.warning as { id: string }).id;
  assert.equal(service.ownStatus(room, "listener").warnings.length, 1);
  assert.equal(service.ownStatus(room, "peer").warnings.length, 0);
  await assert.rejects(service.act(room.id, "peer", { requestId: randomUUID(), action: "warning-read", warningId }), /not found/);
  await service.act(room.id, "listener", { requestId: randomUUID(), action: "warning-read", warningId });
  assert.equal(service.ownStatus(room, "listener").warnings.length, 0);
  await assert.rejects(service.report(room.id, "listener", { requestId: randomUUID(), messageId, targetUserId: "peer", reason: "Report" }), /does not match/);
  const firstReport = { requestId: randomUUID(), targetUserId: "person-0", reason: "Review this participant." };
  await service.report(room.id, "listener", firstReport);
  for (let i = 1; i < 5; i++) await service.report(room.id, "listener", { requestId: randomUUID(), targetUserId: `person-${i}`, reason: "Review this participant." });
  await service.report(room.id, "listener", firstReport);
  await assert.rejects(service.report(room.id, "listener", { requestId: randomUUID(), targetUserId: "person-0", reason: "Same open report." }), /Report limit/);
  assert.equal(service.ownStatus(room, "owner").openReports, 5);
  assert.equal(service.ownStatus(room, "listener").openReports, undefined);
  await assert.rejects(service.report(room.id, "listener", { requestId: randomUUID(), targetUserId: "sixth", reason: "Report" }), /Report limit/);
  await store.updateRoomSettings(room.id, "owner", { moderatorPermissions: { chatParticipants: false, djsPlayback: true, roomDetailsMusic: true, accessInvites: true } });
  assert.equal((await service.view(room.id, "mod", "reports")).items.length, 0);
  await assert.rejects(service.act(room.id, "mod", { requestId: randomUUID(), action: "timeout", userId: "listener" }), /permission/);
});

test("fresh-UUID duplicate reports consume the submission budget without persistent receipts, writes or broadcasts", async t => {
  const { store, room, directory } = await fixture(t); let now = Date.now(), broadcasts = 0;
  const service = new ModerationService(store, { now: () => now, isAdmitted: () => true, broadcast: () => { broadcasts++; } });
  const input = { requestId: randomUUID(), targetUserId: "listener", reason: "Review this participant." };
  const first = await service.report(room.id, "listener", input);
  const before = await readFile(path.join(directory, "soundspin.json"), "utf8");
  await service.report(room.id, "listener", input);
  for (let i=0;i<4;i++) {
    const duplicate = await service.report(room.id, "listener", { ...input, requestId: randomUUID() });
    assert.equal((duplicate.report as { id: string }).id, (first.report as { id: string }).id);
  }
  assert.equal(room.moderation!.reports.length, 1); assert.equal(Object.keys(room.moderation!.receipts).length, 1);
  assert.equal(broadcasts, 1); assert.equal(await readFile(path.join(directory, "soundspin.json"), "utf8"), before);
  await assert.rejects(service.report(room.id, "listener", { ...input, requestId: randomUUID() }), /Report limit/);
  await assert.rejects(service.report(room.id, "listener", { ...input, reason: "Conflicting ID" }), /another action/);
  await assert.rejects(service.report(room.id, "listener", { ...input, requestId: randomUUID(), category: "track-exception" }), /reserved/);
  now += 3600000;
  await service.report(room.id, "listener", { ...input, requestId: randomUUID(), targetUserId: "peer" });
  assert.equal(room.moderation!.reports.length, 2);
});

test("bounded moderation replay receipts reject new work at capacity, expire, and preserve genuine restrictions and evidence", async t => {
  const { store, room } = await fixture(t); let now = Date.now();
  const service = new ModerationService(store, { now: () => now });
  const ban = await service.act(room.id, "owner", { requestId: randomUUID(), action: "ban", userId: "listener", durationMinutes: null });
  const restrictionId = (ban.restriction as { id: string }).id;
  for (let i=Object.keys(room.moderation!.receipts).length;i<MODERATION_MAX_RECEIPTS;i++) room.moderation!.receipts[`owner:${randomUUID()}`] = { hash: "old", result: { ok: true }, createdAt: now };
  const logCount = room.moderation!.log.length;
  await assert.rejects(service.act(room.id, "owner", { requestId: randomUUID(), action: "warn", userId: "peer", reason: "Please review the rules." }), /action limit/);
  assert.equal(room.moderation!.warnings.length, 0); assert.equal(room.moderation!.log.length, logCount);
  now += MODERATION_RECEIPT_TTL_MS;
  await service.act(room.id, "owner", { requestId: randomUUID(), action: "warn", userId: "peer", reason: "Please review the rules." });
  assert.equal(Object.keys(room.moderation!.receipts).length, 1);
  assert.ok(isRoomBanned(room, "listener", now)); assert.ok(room.moderation!.restrictions.some(item => item.id === restrictionId));
  assert.equal(room.moderation!.log.length, logCount + 1);
});

test("archived moderation reads retain current staff capabilities and pagination", async t => {
  const { store, room } = await fixture(t); let reads = 0;
  const service = new ModerationService(store, { readArchive: async (_room, _tab, _query, cursor) => { reads++; return { items: [{ id: "archived" }], cursor: cursor ? null : "1:archived" }; } });
  await assert.rejects(service.view(room.id, "listener", "log", "", "archive:"), /staff/);
  assert.equal(reads, 0);
  assert.equal((await service.view(room.id, "owner", "log", "", "archive:")).cursor, "archive:1:archived");
  await store.updateRoomSettings(room.id, "owner", { moderatorPermissions: { chatParticipants: false, djsPlayback: true, roomDetailsMusic: true, accessInvites: true } });
  await assert.rejects(service.view(room.id, "mod", "reports", "", "archive:"), /permission/);
  assert.equal(reads, 1);
});

test("ordinary submissions cannot consume the receipt reserve needed for staff intervention", async t => {
  const { store, room } = await fixture(t); const now = Date.now();
  for (let i=0;i<MODERATION_MAX_RECEIPTS-200;i++) room.moderation!.receipts[`listener:${randomUUID()}`] = { hash: "old", result: { ok: true }, createdAt: now };
  const service = new ModerationService(store, { now: () => now, isAdmitted: () => true });
  await assert.rejects(service.report(room.id, "listener", { requestId: randomUUID(), targetUserId: "peer", reason: "Report" }), /action limit/);
  await service.act(room.id, "owner", { requestId: randomUUID(), action: "ban", userId: "listener", durationMinutes: null });
  assert.ok(isRoomBanned(room, "listener", now));
  assert.equal(Object.keys(room.moderation!.receipts).length, MODERATION_MAX_RECEIPTS-199);
});

test("platform suspension while HTTP moderation waits in the room queue prevents writes, receipts and delivery", async t => {
  const { store, room } = await fixture(t); let active = true, broadcasts = 0, release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const service = new ModerationService(store, { authorizeActor: async () => { if (!active) throw new RoomCommandError("This account is restricted."); }, broadcast: () => { broadcasts++; } });
  const holding = store.withRoomOperation(room.id, async () => { started(); await waiting; });
  await entered;
  const pending = service.act(room.id, "owner", { requestId: randomUUID(), action: "warn", userId: "listener", reason: "Warning" });
  await Promise.resolve(); active = false; release(); await holding;
  await assert.rejects(pending, /account is restricted/);
  assert.deepEqual(room.moderation!.warnings, []); assert.deepEqual(room.moderation!.log, []); assert.equal(Object.keys(room.moderation!.receipts).length, 0); assert.equal(broadcasts, 0);
});

test("platform decisions are rechecked after privileged member awaits and before report message lookup", async t => {
  const { store, room } = await fixture(t); let active = true, messageReads = 0;
  const service = new ModerationService(store, { authorizeActor: async () => { if (!active) throw new RoomCommandError("This room is unavailable."); },
    memberPage: async () => { active = false; return { members: [], cursor: null }; },
    validateMessage: async () => { messageReads++; return { userId: "listener" }; }, isAdmitted: () => true });
  await assert.rejects(service.members(room.id, "owner"), /room is unavailable/);
  await assert.rejects(service.report(room.id, "listener", { requestId: randomUUID(), messageId: randomUUID(), reason: "Report" }), /room is unavailable/);
  assert.equal(messageReads, 0);
});
