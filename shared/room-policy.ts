import type { RoomBase, RoomSettings, RoomCapability, FeaturePermission, ModeratorPermissions, RoomCapabilities } from "./types.js";

export const DEFAULT_MODERATOR_PERMISSIONS: ModeratorPermissions = { chatParticipants: true, djsPlayback: true, roomDetailsMusic: true, accessInvites: true };
export function accessMode(room: Pick<RoomBase,"settings"|"isPublic">) { return room.settings.accessMode ?? (room.isPublic ? "public" : "members"); }
export function isRoomStaff(room: Pick<RoomBase,"ownerUserId"|"moderatorUserIds">, userId: string) { return room.ownerUserId === userId || room.moderatorUserIds.includes(userId); }
export function hasRoomCapability(room: Pick<RoomBase,"ownerUserId"|"moderatorUserIds"|"settings">, userId: string, group: RoomCapability) {
  return room.ownerUserId === userId || (room.moderatorUserIds.includes(userId) && (room.settings.moderatorPermissions?.[group] ?? true));
}
export function effectiveRoomPolicy(room: Pick<RoomBase,"settings">, now = Date.now()): RoomSettings {
  const settings = { ...room.settings };
  for (const override of room.settings.sessionOverrides ?? []) {
    if (override.expiresAt <= now) continue;
    if (override.kind === "slow-mode") settings.slowModeSeconds = override.value as RoomSettings["slowModeSeconds"];
    if (override.kind === "staff-chat") settings.chatMode = "staff";
    if (override.kind === "dj-lock") settings.djJoinLocked = true;
  }
  return settings;
}
export function featureAllowed(permission: FeaturePermission | undefined, staff: boolean) { return permission !== "nobody" && (permission !== "staff" || staff); }
interface RestrictedRoom extends RoomBase { moderation?: {restrictions?: Array<{userId:string;kind:string;expiresAt:number|null;revokedAt:number|null}>;rulesAcceptance?:Record<string,number>} }
export function chatParticipationError(room: RestrictedRoom, userId: string, kind: "message"|"media"|"links"|"poll"|"reaction"|"typing", now = Date.now()) {
  const restriction = room.moderation?.restrictions?.find(r => r.userId === userId && r.revokedAt === null && (r.expiresAt === null || r.expiresAt > now) && (r.kind === "room-ban" || r.kind === "chat-timeout"));
  if (restriction) return restriction.kind === "room-ban" ? "You are banned from this room." : "Your chat timeout is still active.";
  if (room.settings.requireRulesAcceptance && room.moderation?.rulesAcceptance?.[userId] !== (room.settings.rulesVersion ?? 1)) return "Read and accept the room rules before participating.";
  const policy = effectiveRoomPolicy(room, now), staff = isRoomStaff(room,userId);
  if (policy.chatMode === "staff" && !staff) return "Chat is limited to room staff.";
  const permission = kind === "media" ? policy.mediaPermission : kind === "links" ? policy.linksPermission : kind === "poll" ? policy.pollsPermission : undefined;
  if (!featureAllowed(permission,staff)) return `This room does not allow you to ${kind === "media" ? "send media" : kind === "links" ? "send links" : "create polls"}.`;
  return null;
}
export function roomCapabilities(room: RestrictedRoom,userId:string,now=Date.now()):RoomCapabilities {
  const policy=effectiveRoomPolicy(room,now), staff=isRoomStaff(room,userId), owner=room.ownerUserId===userId;
  const djRestricted=room.moderation?.restrictions?.some(r=>r.userId===userId&&(r.kind==="room-ban"||r.kind==="dj-suspension")&&r.revokedAt===null&&(r.expiresAt===null||r.expiresAt>now));
  const rulesAccepted=!room.settings.requireRulesAcceptance||room.moderation?.rulesAcceptance?.[userId]===(room.settings.rulesVersion??1);
  const invite=policy.invitePermission === "owner" ? owner : policy.invitePermission === "staff" ? hasRoomCapability(room,userId,"accessInvites") : policy.invitePermission === "members" ? true : accessMode(room)==="members" ? hasRoomCapability(room,userId,"accessInvites") : true;
  return {owner,staff,chatParticipants:hasRoomCapability(room,userId,"chatParticipants"),djsPlayback:hasRoomCapability(room,userId,"djsPlayback"),roomDetailsMusic:hasRoomCapability(room,userId,"roomDetailsMusic"),accessInvites:hasRoomCapability(room,userId,"accessInvites"),invite,chat:!chatParticipationError(room,userId,"message",now),media:!chatParticipationError(room,userId,"media",now),links:!chatParticipationError(room,userId,"links",now),polls:!chatParticipationError(room,userId,"poll",now),joinDj:rulesAccepted&&!djRestricted&&!policy.djJoinLocked&&(!policy.djCapacity||room.djQueueUserIds.includes(userId)||room.djQueueUserIds.length<policy.djCapacity)&&(policy.djAccess!=="roles"||staff||room.djRoleUserIds.includes(userId)),playback:rulesAccepted&&(hasRoomCapability(room,userId,"djsPlayback")||(policy.manualPlayback!=="staff"&&room.djUserId===userId))};
}
