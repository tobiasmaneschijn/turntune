import { serverT } from "./i18n.js";
import { accessMode, hasRoomCapability, isRoomStaff } from "../shared/room-policy.js";
import type { RoomCapability, RoomRole } from "../shared/types.js";
import { RoomCommandError } from "./socket-handler.js";
import type { Room, RoomRestriction, RoomModerationState } from "./types.js";
import type { ModerationEvent } from "./types.js";
import { randomUUID } from "node:crypto";

export function emptyModeration(): RoomModerationState {
  return { restrictions: [], log: [], reports: [], warnings: [], members: Object.create(null), receipts: Object.create(null), inviteLinks: [], rulesAcceptance: Object.create(null), cancelledInvitations: [] };
}
export function ensureModeration(room: Room): RoomModerationState {
  const current = room.moderation ?? (room.moderation = emptyModeration());
  // Keep references stable throughout one room command: receipts, memberships,
  // and the audit entry must all land in the same document.
  current.restrictions ??= []; current.log ??= []; current.reports ??= [];
  current.warnings ??= []; current.inviteLinks ??= []; current.cancelledInvitations ??= [];
  for (const key of ["members", "receipts", "rulesAcceptance"] as const) {
    if (!current[key] || Object.getPrototypeOf(current[key]) !== null) current[key] = Object.assign(Object.create(null), current[key]);
  }
  return current;
}
export function appendModerationLog(room: Room, entry: Omit<ModerationEvent, "id" | "createdAt"> & Partial<Pick<ModerationEvent, "id" | "createdAt">>, now = Date.now()) {
  const event: ModerationEvent = { ...entry, id: entry.id ?? randomUUID(), createdAt: entry.createdAt ?? now };
  ensureModeration(room).log.push(event);
  return event;
}
export function activeRestriction(room: Room, userId: string, kind: RoomRestriction["kind"], now = Date.now()) {
  return room.moderation?.restrictions.find(item => item.userId === userId && item.kind === kind && item.revokedAt === null && (item.expiresAt === null || item.expiresAt > now));
}
export function isRoomBanned(room: Room, userId: string, now = Date.now()) { return Boolean(activeRestriction(room, userId, "room-ban", now)); }
export function requireNotBanned(room: Room, userId: string, now = Date.now()) {
  if (isRoomBanned(room, userId, now)) throw new RoomCommandError(serverT("you_are_banned_from_this_room"));
}
export function requireRoomCapability(room: Room, userId: string, capability: RoomCapability, now = Date.now()) {
  requireNotBanned(room, userId, now);
  if (!hasRoomCapability(room, userId, capability)) throw new RoomCommandError(serverT("you_do_not_have_permission_to_use_this_room_tool"));
}
export function roleInRoom(room: Room, userId: string): RoomRole | null {
  return room.ownerUserId === userId ? "owner" : room.moderatorUserIds.includes(userId) ? "moderator" : room.djRoleUserIds.includes(userId) ? "dj" : room.moderation?.members && Object.hasOwn(room.moderation.members, userId) ? room.moderation.members[userId].role : null;
}
export function canAccessRoom(room: Room, userId: string, role = roleInRoom(room, userId), now = Date.now()) {
  return !isRoomBanned(room, userId, now) && (accessMode(room) !== "members" || Boolean(role));
}
export function requireProtectedTarget(room: Room, actorId: string, targetId: string) {
  if (targetId === room.ownerUserId) throw new RoomCommandError(serverT("the_room_owner_cannot_be_the_target_of_this_action"));
  if (room.ownerUserId !== actorId && isRoomStaff(room, targetId)) throw new RoomCommandError(serverT("only_the_owner_can_moderate_another_moderator"));
}
export function canInviteRoom(room: Room, userId: string, now = Date.now(), role: RoomRole | null = roleInRoom(room, userId)) {
  if (!canAccessRoom(room, userId, role, now) || !role) return false;
  const policy = room.settings.invitePermission ?? "default";
  if (policy === "owner") return room.ownerUserId === userId;
  if (policy === "staff" || (policy === "default" && accessMode(room) === "members")) return hasRoomCapability(room, userId, "accessInvites") && !isRoomBanned(room, userId, now);
  return true;
}
