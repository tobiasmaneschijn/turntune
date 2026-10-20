import { serverT } from "../../lib/i18n.js";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { accessMode, hasRoomCapability, isRoomStaff } from "../../../shared/room-policy.js";
import { advanceRadio, removeDj, pruneUnauthorizedDjs } from "../rooms/radio.js";
import { RoomCommandError } from "../../realtime/socket-handler.js";
import { activeRestriction, appendModerationLog, canAccessRoom, canInviteRoom, ensureModeration, requireNotBanned, requireProtectedTarget, requireRoomCapability, roleInRoom } from "../rooms/room-access.js";
import type { Store, RoomChange } from "../../persistence/store.js";
import type { ModerationEvent, Room, RoomRestriction, User } from "../../types.js";

const id = z.string().min(1).max(100);
const uuid = z.string().uuid();
export const moderationActionSchema = z.object({
  requestId: uuid, action: z.enum(["timeout", "kick", "ban", "dj-remove", "dj-suspend", "revoke", "warn", "remove-message", "member-remove", "role", "report-resolve", "report-dismiss", "session", "session-end", "warning-read"]),
  userId: id.optional(), durationMinutes: z.number().int().min(1).max(525600).nullable().optional(), reason: z.string().trim().max(500).optional(),
  restrictionId: uuid.optional(), messageId: uuid.optional(), role: z.enum(["moderator", "dj", "member"]).optional(), enabled: z.boolean().optional(),
  reportId: uuid.optional(), mode: z.enum(["after-track", "skip"]).optional(), kind: z.enum(["slow-mode", "staff-chat", "dj-lock"]).optional(),
  value: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(30), z.literal(60)]).optional(), overrideId: uuid.optional(), warningId: uuid.optional()
}).strict();
export type ModerationAction = z.infer<typeof moderationActionSchema>;
export const roomReportSchema = z.object({ requestId: uuid, targetUserId: id.optional(), messageId: uuid.optional(), reason: z.string().trim().min(1).max(500), category: z.string().trim().min(1).max(48).default("other").refine(value => value !== "track-exception", serverT("this_report_category_is_reserved")) }).strict().refine(value => value.targetUserId || value.messageId, serverT("choose_a_message_or_participant_to_report"));
export const invitationActionSchema = z.object({ requestId: uuid, action: z.enum(["cancel", "create-link", "revoke-link"]), invitationId: uuid.optional(), linkId: uuid.optional(), durationDays: z.number().int().min(1).max(365).optional(), maxUses: z.number().int().min(1).max(1000).optional() }).strict();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (message: string): never => { throw new RoomCommandError(message); };
const target = (input: ModerationAction) => input.userId || fail("Choose a participant.");
export const MODERATION_RECEIPT_TTL_MS = 24 * 60 * 60_000;
export const MODERATION_MAX_RECEIPTS = 1000;
const page = <T>(items: T[], cursor?: string, limit = 50) => {
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) fail("Invalid page cursor.");
  return { items: items.slice(offset, offset + limit), cursor: offset + limit < items.length ? String(offset + limit) : null };
};

export interface ModerationServiceOptions {
  now?: () => number;
  broadcast?: (room: Room) => void;
  isAdmitted?: (roomId: string, userId: string) => boolean;
  onlineUsers?: (roomId: string) => User[];
  revokeAdmission?: (roomId: string, userId: string, reason: string) => void | Promise<void>;
  cancelDjEviction?: (roomId: string, userId: string) => void;
  forgetDj?: (roomId: string, userId: string) => void;
  removeMessage?: (roomId: string, actorId: string, messageId: string, requestId: string, reason: string) => Promise<unknown>;
  externalLog?: (roomId: string) => Promise<ModerationEvent[]>;
  validateMessage?: (roomId: string, messageId: string) => Promise<{ userId: string } | null>;
  /** Private indexed archive read, called only after current room staff/capability validation. */
  readArchive?: (roomId: string, tab: "reports" | "log" | "restrictions" | "warnings", query: string, cursor?: string) => Promise<{ items: Array<Record<string, unknown>>; cursor: string | null }>;
  memberPage?: (roomId: string, query: string, cursor?: string) => Promise<{ members: Array<{ user: User; role: "owner" | "moderator" | "dj" | "member"; joinedAt: number }>; cursor: string | null }>;
  /** Fresh platform account/room status, including commands that waited in the room queue. */
  authorizeActor?: (roomId: string, actorId: string) => Promise<void>;
}

/** One room queue orders policy, participant and radio effects; only committed state is published. */
export class ModerationService {
  private readonly now: () => number;
  private readonly reportBudgets = new Map<string, { expiresAt: number; requests: Map<string, string> }>();
  constructor(readonly store: Store, private readonly options: ModerationServiceOptions = {}) { this.now = options.now || Date.now; }
  ownStatus(room: Room, userId: string) {
    const openReports = isRoomStaff(room, userId) ? Math.min(999, (room.moderation?.reports || []).filter(report => report.status === "open" && (hasRoomCapability(room, userId, "chatParticipants") || (report.category === "track-exception" && hasRoomCapability(room, userId, "djsPlayback")))).length) : undefined;
    return { chatTimeoutUntil: activeRestriction(room, userId, "chat-timeout", this.now())?.expiresAt,
      djSuspendedUntil: activeRestriction(room, userId, "dj-suspension", this.now())?.expiresAt,
      rulesAccepted: !room.settings.requireRulesAcceptance || room.moderation?.rulesAcceptance?.[userId] === (room.settings.rulesVersion ?? 1),
      warnings: (room.moderation?.warnings || []).filter(warning => warning.userId === userId && warning.readAt === null).map(({ id, text, createdAt }) => ({ id, text, createdAt })), openReports };
  }
  private async room(roomId: string) { return await this.store.loadRoom(roomId) || fail(serverT("room_not_found")); }
  private async actor(room: Room, actorId: string) {
    await this.options.authorizeActor?.(room.id, actorId);
    const access = await this.store.getRoomAccess(room.id, actorId);
    await this.options.authorizeActor?.(room.id, actorId);
    if (access.banned) fail("You are banned from this room.");
    requireNotBanned(room, actorId, this.now());
    return access;
  }
  private async reader(room: Room, actorId: string) {
    const access = await this.actor(room, actorId);
    if (!access.exists || (!access.isPublic && !access.role)) fail("You no longer have access to this room.");
    return access;
  }
  private async staff(room: Room, actorId: string) {
    const access = await this.actor(room, actorId);
    if (access.role !== "owner" && access.role !== "moderator") fail("Only room staff can use this tool.");
    if (!Object.keys({ chatParticipants: true, djsPlayback: true, roomDetailsMusic: true, accessInvites: true }).some(key => hasRoomCapability(room, actorId, key as "chatParticipants" | "djsPlayback" | "roomDetailsMusic" | "accessInvites"))) fail("You do not have permission to use this room tool.");
  }
  private receipt(room: Room, actorId: string, requestId: string, value: unknown) {
    const state = ensureModeration(room), key = `${actorId}:${requestId}`, hash = digest(JSON.stringify(value));
    const candidate = Object.hasOwn(state.receipts, key) ? state.receipts[key] : undefined;
    const previous = candidate && Number.isFinite(candidate.createdAt) && candidate.createdAt + MODERATION_RECEIPT_TTL_MS > this.now() ? candidate : undefined;
    if (previous && previous.hash !== hash) fail("This request ID already belongs to another action.");
    return { previous, commit: (result: Record<string, unknown>) => {
      for (const [key, item] of Object.entries(state.receipts)) if (!Number.isFinite(item.createdAt) || item.createdAt + MODERATION_RECEIPT_TTL_MS <= this.now()) delete state.receipts[key];
      // Ordinary report/invite traffic cannot spend the staff's intervention reserve.
      const maximum = isRoomStaff(room, actorId) ? MODERATION_MAX_RECEIPTS : MODERATION_MAX_RECEIPTS - 200;
      if (Object.keys(state.receipts).length >= maximum) fail("Room action limit reached. Try again later.");
      Object.defineProperty(state.receipts, key, { value: { hash, result, createdAt: this.now() }, writable: true, configurable: true, enumerable: true });
      this.retainRecent(room);
    } };
  }
  private reportSubmission(actorId: string, requestId: string, input: unknown) {
    const now = this.now(), hash = digest(JSON.stringify(input));
    for (const [key, value] of this.reportBudgets) if (value.expiresAt <= now) this.reportBudgets.delete(key);
    const budget = this.reportBudgets.get(actorId) || { expiresAt: now + 3600000, requests: new Map<string, string>() };
    const previous = budget.requests.get(requestId);
    if (previous) { if (previous !== hash) fail("This request ID already belongs to another action."); return; }
    if (budget.requests.size >= 5) fail("Report limit reached. Try again in an hour.");
    if (!this.reportBudgets.has(actorId) && this.reportBudgets.size >= 10_000) fail("Reports are temporarily unavailable. Try again shortly.");
    budget.requests.set(requestId, hash); this.reportBudgets.set(actorId, budget);
  }
  /** SQL archives evicted evidence transactionally; local development never drops evidence. */
  private retainRecent(room: Room) {
    if (!this.store.usesSupabase) return;
    const state = ensureModeration(room), now = this.now();
    const retain = <T>(items: T[], isInactive: (item: T) => boolean, date: (item: T) => number) => {
      const recent = items.filter(isInactive).sort((a, b) => date(b) - date(a)).slice(0, 500);
      const retained = new Set(recent);
      return items.filter(item => !isInactive(item) || retained.has(item));
    };
    state.log = state.log.slice(-500);
    state.reports = retain(state.reports, item => item.status !== "open", item => item.resolvedAt || item.createdAt);
    state.restrictions = retain(state.restrictions, item => item.revokedAt !== null || (item.expiresAt !== null && item.expiresAt <= now), item => item.revokedAt || item.expiresAt || item.createdAt);
    state.warnings = retain(state.warnings, item => item.readAt !== null, item => item.readAt || item.createdAt);
    state.inviteLinks = retain(state.inviteLinks, item => item.revokedAt !== null || item.expiresAt <= now, item => item.revokedAt || item.expiresAt);
    state.cancelledInvitations = state.cancelledInvitations.slice(-500);
  }
  async members(roomId: string, actorId: string, query = "", cursor?: string) {
    const room = await this.room(roomId); await this.staff(room, actorId);
    if (this.options.memberPage) {
      const result = await this.options.memberPage(roomId, query, cursor);
      await this.staff(room, actorId);
      const online = new Map((this.options.onlineUsers?.(roomId) || []).map(user => [user.id, user]));
      return { ...result, members: result.members.map(member => ({ ...member, user: online.get(member.user.id) || member.user, online: online.has(member.user.id),
        restrictions: (room.moderation?.restrictions || []).filter(item => item.userId === member.user.id && item.revokedAt === null && (item.expiresAt === null || item.expiresAt > this.now()) &&
          (hasRoomCapability(room, actorId, "chatParticipants") || (item.kind === "dj-suspension" && hasRoomCapability(room, actorId, "djsPlayback")))) })) };
    }
    const all = await this.store.listRoomMembers(roomId), online = new Map((this.options.onlineUsers?.(roomId) || []).map(user => [user.id, user]));
    const restrictions = room.moderation?.restrictions || [];
    const items = all.filter(member => member.user.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.user.name.localeCompare(b.user.name) || a.user.id.localeCompare(b.user.id)).map(member => ({ ...member, user: online.get(member.user.id) || member.user, online: online.has(member.user.id), restrictions: restrictions.filter(item => item.userId === member.user.id && item.revokedAt === null && (item.expiresAt === null || item.expiresAt > this.now()) && (hasRoomCapability(room, actorId, "chatParticipants") || (item.kind === "dj-suspension" && hasRoomCapability(room, actorId, "djsPlayback")))) }));
    const result = page(items, cursor); return { members: result.items, cursor: result.cursor };
  }
  async view(roomId: string, actorId: string, tab: "reports" | "log" | "restrictions" | "warnings", query = "", cursor?: string) {
    const room = await this.room(roomId); await this.staff(room, actorId);
    if (tab === "warnings") requireRoomCapability(room, actorId, "chatParticipants", this.now());
    if (cursor?.startsWith("archive:")) {
      // Staff with playback-only powers cannot browse archived personal reports/restrictions.
      if (tab !== "log") requireRoomCapability(room, actorId, "chatParticipants", this.now());
      if (!this.options.readArchive) return { items: [], cursor: null };
      const result = await this.options.readArchive(roomId, tab, query, cursor.slice(8) || undefined);
      await this.staff(room, actorId);
      if (tab !== "log") requireRoomCapability(room, actorId, "chatParticipants", this.now());
      return { ...result, cursor: result.cursor ? `archive:${result.cursor}` : null };
    }
    const state = ensureModeration(structuredClone(room));
    let items: Array<ModerationEvent | RoomRestriction | typeof state.reports[number] | typeof state.warnings[number]>;
    if (tab === "log") items = [...state.log, ...await this.options.externalLog?.(roomId) || []];
    else if (tab === "restrictions") items = state.restrictions.filter(item => item.revokedAt === null && (item.expiresAt === null || item.expiresAt > this.now()));
    else if (tab === "reports") items = state.reports.filter(item => hasRoomCapability(room, actorId, "chatParticipants") || (item.category === "track-exception" && hasRoomCapability(room, actorId, "djsPlayback")));
    else { requireRoomCapability(room, actorId, "chatParticipants", this.now()); items = state.warnings; }
    if (tab === "restrictions" && !hasRoomCapability(room, actorId, "chatParticipants")) items = items.filter(item => "kind" in item && item.kind === "dj-suspension" && hasRoomCapability(room, actorId, "djsPlayback"));
    const needle = query.trim().toLocaleLowerCase();
    const result = page(items.filter(item => !needle || JSON.stringify(item).toLocaleLowerCase().includes(needle)).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)), cursor);
    return { ...result, cursor: result.cursor || (this.options.readArchive && (tab === "log" || hasRoomCapability(room, actorId, "chatParticipants")) ? "archive:" : null) };
  }
  async act(roomId: string, actorId: string, value: unknown) {
    const input = moderationActionSchema.parse(value), room = await this.room(roomId);
    if (input.action === "remove-message") {
      await this.staff(room, actorId); requireRoomCapability(room, actorId, "chatParticipants", this.now());
      const messageId = input.messageId || fail("Choose a message."), removeMessage = this.options.removeMessage || fail("Message removal is unavailable.");
      const message = await this.options.validateMessage?.(roomId, messageId);
      if (message && room.ownerUserId !== actorId) requireProtectedTarget(room, actorId, message.userId);
      return { ok: true, result: await removeMessage(roomId, actorId, messageId, input.requestId, input.reason || "") };
    }
    const outcome = await this.store.changeRoom<Record<string, unknown>>(room, async draft => {
      const state = ensureModeration(draft), now = this.now();
      const access = input.action === "warning-read" ? await this.reader(draft, actorId) : (await this.staff(draft, actorId), await this.actor(draft, actorId));
      const receipt = this.receipt(draft, actorId, input.requestId, input);
      if (receipt.previous) return { result: { ...receipt.previous.result, replayed: true }, unchanged: true };
      let result: Record<string, unknown> = { ok: true };
      let member: RoomChange<unknown>["member"], memberDeletes: string[] | undefined;
      const reason = input.reason || "";
      if (["timeout", "ban", "kick", "warn", "member-remove", "dj-remove", "dj-suspend"].includes(input.action)) {
        const userId = target(input), group = input.action.startsWith("dj-") ? "djsPlayback" : input.action === "member-remove" ? "accessInvites" : "chatParticipants";
        requireRoomCapability(draft, actorId, group, now);
        const targetAccess = await this.store.getRoomAccess(roomId, userId);
        if (userId === draft.ownerUserId || (access.role !== "owner" && targetAccess.role === "moderator")) fail("Only the owner can moderate another moderator.");
        requireProtectedTarget(draft, actorId, userId);
        if (input.action === "warn") {
          if (!reason) fail("Write a warning.");
          if (state.warnings.filter(item => item.userId === userId && item.readAt === null).length >= 100 || state.warnings.filter(item => item.readAt === null).length >= 2000) fail("Unread warning limit reached.");
          const warning = { id: randomUUID(), userId, actorId, text: reason, createdAt: now, readAt: null }; state.warnings.push(warning); result.warning = warning;
        } else {
          if (["timeout", "ban", "dj-suspend"].includes(input.action)) {
            const kind: RoomRestriction["kind"] = input.action === "timeout" ? "chat-timeout" : input.action === "ban" ? "room-ban" : "dj-suspension";
            if (input.action === "timeout" && input.durationMinutes === null) fail("Chat timeouts need an expiry.");
            const duration = input.durationMinutes === undefined ? (input.action === "ban" ? null : 30) : input.durationMinutes;
            const previous = activeRestriction(draft, userId, kind, now);
            if (previous) { previous.revokedAt = now; previous.revokedBy = actorId; }
            const restriction: RoomRestriction = { id: randomUUID(), userId, kind, actorId, reason, createdAt: now, expiresAt: duration === null ? null : now + duration * 60000, revokedAt: null };
            if (input.action === "dj-suspend" && input.mode === "after-track" && draft.djUserId === userId && draft.playback.track) restriction.deferUntilTrackId = draft.playback.track.id;
            state.restrictions.push(restriction); result.restriction = restriction;
          }
          const eject = input.action === "kick" || input.action === "ban" || (input.action === "member-remove" && accessMode(draft) === "members");
          if (input.action === "member-remove") {
            delete state.members[userId]; delete state.rulesAcceptance[userId];
            draft.moderatorUserIds = draft.moderatorUserIds.filter(id => id !== userId); draft.djRoleUserIds = draft.djRoleUserIds.filter(id => id !== userId);
            memberDeletes = [userId];
            if (!eject) {
              const wasCurrent = draft.djUserId;
              pruneUnauthorizedDjs(draft);
              if (wasCurrent === userId && !draft.djQueueUserIds.includes(userId)) result.djRemovedUserId = userId;
            }
          }
          const removesDj = eject || input.action === "dj-remove" || input.action === "dj-suspend";
          if (removesDj) {
            if ((input.action === "dj-remove" || input.action === "dj-suspend") && input.mode === "after-track" && draft.djUserId === userId && draft.playback.track) {
              if (input.action === "dj-remove") state.restrictions.push({ id: randomUUID(), userId, kind: "dj-suspension", actorId, reason, createdAt: now, expiresAt: null, revokedAt: null, deferUntilTrackId: draft.playback.track.id, removeAfterTrackOnly: true });
              result.deferredTrackId = draft.playback.track.id;
            } else {
              const current = draft.djUserId === userId; removeDj(draft, userId); if (current) advanceRadio(draft);
              result.djRemovedUserId = userId;
            }
          }
          if (eject) result.ejectUserId = userId;
        }
        appendModerationLog(draft, { action: input.action, actorId, targetUserId: userId, reason, requestId: input.requestId, restrictionId: (result.restriction as RoomRestriction | undefined)?.id });
      } else if (input.action === "revoke") {
        const restriction = state.restrictions.find(item => item.id === input.restrictionId) || fail("Restriction not found.");
        requireRoomCapability(draft, actorId, restriction.kind === "dj-suspension" ? "djsPlayback" : "chatParticipants", now);
        if (access.role !== "owner" && (await this.store.getRoomAccess(roomId, restriction.userId)).role === "moderator") fail("Only the owner can moderate another moderator.");
        requireProtectedTarget(draft, actorId, restriction.userId);
        if (restriction.revokedAt !== null) return { result: { ok: true, replayed: true }, unchanged: true };
        if (restriction.revokedAt === null) { restriction.revokedAt = now; restriction.revokedBy = actorId; }
        appendModerationLog(draft, { action: "restriction-revoke", actorId, targetUserId: restriction.userId, restrictionId: restriction.id, reason, requestId: input.requestId });
      } else if (input.action === "role") {
        if (access.role !== "owner") fail("Only the owner can change room roles.");
        const userId = target(input); if (userId === draft.ownerUserId) fail("The owner already has full room access.");
        const role = input.enabled === false || input.role === "member" ? "member" : input.role || fail("Choose a room role.");
        if ((await this.store.getRoomAccess(roomId, userId)).role === role) return { result: { ok: true, replayed: true }, unchanged: true };
        draft.moderatorUserIds = draft.moderatorUserIds.filter(id => id !== userId); draft.djRoleUserIds = draft.djRoleUserIds.filter(id => id !== userId);
        if (role === "moderator") draft.moderatorUserIds.push(userId); if (role === "dj") draft.djRoleUserIds.push(userId);
        const current = state.members[userId]; Object.defineProperty(state.members, userId, { value: { user: current?.user || { id: userId, name: userId, avatarSeed: userId }, role, joinedAt: current?.joinedAt || now }, enumerable: true, writable: true, configurable: true });
        const wasCurrent = draft.djUserId; pruneUnauthorizedDjs(draft);
        if (wasCurrent && !draft.djQueueUserIds.includes(wasCurrent)) result.djRemovedUserId = wasCurrent;
        member = { user_id: userId, role };
        appendModerationLog(draft, { action: "role", actorId, targetUserId: userId, reason, details: { role }, requestId: input.requestId });
      } else if (input.action.startsWith("report-")) {
        const report = state.reports.find(item => item.id === input.reportId) || fail("Report not found.");
        requireRoomCapability(draft, actorId, report.category === "track-exception" ? "djsPlayback" : "chatParticipants", now);
        if (report.status !== "open") return { result: { ok: true, replayed: true }, unchanged: true };
        report.status = input.action === "report-resolve" ? "resolved" : "dismissed"; report.resolvedAt = now; report.resolvedBy = actorId;
        appendModerationLog(draft, { action: input.action, actorId, targetUserId: report.targetUserId, messageId: report.messageId, reason, requestId: input.requestId, details: { reportId: report.id } });
      } else if (input.action === "session" || input.action === "session-end") {
        const overrides = draft.settings.sessionOverrides || [];
        const old = overrides.find(item => item.id === input.overrideId);
        const kind = input.action === "session" ? input.kind || fail("Choose a session control.") : old?.kind || fail("Session control not found.");
        requireRoomCapability(draft, actorId, kind === "dj-lock" ? "djsPlayback" : "chatParticipants", now);
        draft.settings.sessionOverrides = overrides.filter(item => item.expiresAt > now && (input.action === "session-end" ? item.id !== input.overrideId : item.kind !== kind));
        if (input.action === "session") {
          if (input.durationMinutes === null) fail("Session controls need an expiry.");
          const override = { id: randomUUID(), kind, authorId: actorId, expiresAt: now + (input.durationMinutes || 30) * 60000, ...(kind === "slow-mode" ? { value: input.value ?? 10 } : {}) };
          draft.settings.sessionOverrides.push(override); result.override = override;
        }
        appendModerationLog(draft, { action: input.action, actorId, reason, requestId: input.requestId, details: { kind } });
      } else if (input.action === "warning-read") {
        const warning = state.warnings.find(item => item.id === input.warningId && item.userId === actorId) || fail("Warning not found.");
        if (warning.readAt !== null) return { result: { ok: true, replayed: true }, unchanged: true };
        warning.readAt = now;
      }
      receipt.commit(result);
      return { result, member, memberDeletes, ...(input.action === "session" || input.action === "session-end" ? { metadata: { settings: draft.settings } } : {}) };
    });
    if (!outcome.replayed) {
      const removed = outcome.djRemovedUserId as string | undefined;
      if (removed) { this.options.cancelDjEviction?.(roomId, removed); this.options.forgetDj?.(roomId, removed); }
      const ejected = outcome.ejectUserId as string | undefined;
      if (ejected) await this.options.revokeAdmission?.(roomId, ejected, input.action === "ban" ? "You are banned from this room." : "You were removed from this room.");
      this.options.broadcast?.(room);
    }
    return outcome;
  }
  async report(roomId: string, actorId: string, value: unknown) {
    const input = roomReportSchema.parse(value), room = await this.room(roomId);
    await this.reader(room, actorId);
    if (this.options.isAdmitted && !this.options.isAdmitted(roomId, actorId)) fail("Join this room before reporting a participant.");
    const message = input.messageId ? await this.options.validateMessage?.(roomId, input.messageId) : undefined;
    if (input.messageId && this.options.validateMessage && !message) fail("This message is unavailable.");
    if (message && input.targetUserId && message.userId !== input.targetUserId) fail("The reported participant does not match this message.");
    const targetUserId = message?.userId || input.targetUserId;
    const outcome = await this.store.changeRoom<Record<string, unknown>>(room, async draft => {
      await this.reader(draft, actorId);
      if (this.options.isAdmitted && !this.options.isAdmitted(roomId, actorId)) fail("Join this room before reporting a participant.");
      const receipt = this.receipt(draft, actorId, input.requestId, input), state = ensureModeration(draft);
      if (receipt.previous) return { result: { ...receipt.previous.result, replayed: true }, unchanged: true };
      this.reportSubmission(actorId, input.requestId, input);
      if (state.reports.filter(item => item.reporterId === actorId && item.createdAt > this.now() - 3600000).length >= 5) fail("Report limit reached. Try again in an hour.");
      const existing = state.reports.find(item => item.reporterId === actorId && item.status === "open" && item.messageId === input.messageId && item.targetUserId === targetUserId);
      if (existing) return { result: { ok: true, report: existing, replayed: true }, unchanged: true };
      if (state.reports.filter(item => item.status === "open").length >= 1000) fail("This room has too many unresolved reports. Contact support.");
      const report = { id: randomUUID(), reporterId: actorId, targetUserId, messageId: input.messageId, reason: input.reason, category: input.category, createdAt: this.now(), status: "open" as const };
      state.reports.push(report); const result = { ok: true, report }; receipt.commit(result); return { result };
    });
    if (!outcome.replayed) this.options.broadcast?.(room); return outcome;
  }
  async acceptRules(roomId: string, actorId: string, version: number) {
    const room = await this.room(roomId);
    const changed = await this.store.changeRoom(room, async draft => {
      await this.reader(draft, actorId);
      if (!draft.settings.rulesText || version !== (draft.settings.rulesVersion ?? 1)) fail("The room rules changed. Read the current version.");
      if (ensureModeration(draft).rulesAcceptance[actorId] === version) return { result: false, unchanged: true };
      Object.defineProperty(ensureModeration(draft).rulesAcceptance, actorId, { value: version, configurable: true, writable: true, enumerable: true });
      return { result: true };
    });
    if (changed) this.options.broadcast?.(room); return { ok: true };
  }
  async invitations(roomId: string, actorId: string, cursor?: string) {
    const room = await this.room(roomId); await this.staff(room, actorId); requireRoomCapability(room, actorId, "accessInvites", this.now());
    const live = (link: { revokedAt: number | null; expiresAt: number }) => link.revokedAt === null && link.expiresAt > this.now() ? 1 : 0;
    const links = page((room.moderation?.inviteLinks || []).map(({ tokenHash: _hash, uses, ...link }) => ({ ...link, uses: uses.length })).sort((a, b) => live(b) - live(a) || b.createdAt - a.createdAt), cursor);
    const invitations = page(await this.store.listRoomInvitations(roomId), cursor);
    return { invitations: invitations.items, links: links.items, cursor: invitations.cursor || links.cursor };
  }
  async invitationAction(roomId: string, actorId: string, value: unknown) {
    const input = invitationActionSchema.parse(value), room = await this.room(roomId);
    const invitations = input.action === "cancel" ? await this.store.listRoomInvitations(roomId) : [];
    const result = await this.store.changeRoom(room, async draft => {
      const access = await this.reader(draft, actorId), state = ensureModeration(draft), now = this.now();
      if (input.action === "create-link") {
        const policy = draft.settings.invitePermission || "default";
        const eligible = policy === "owner" ? actorId === draft.ownerUserId : policy === "staff" || (policy === "default" && accessMode(draft) === "members") ? hasRoomCapability(draft, actorId, "accessInvites") : Boolean(access.role);
        if (!eligible) fail("You cannot invite members to this room.");
      } else requireRoomCapability(draft, actorId, "accessInvites", now);
      const receipt = this.receipt(draft, actorId, input.requestId, input); if (receipt.previous) return { result: { ...receipt.previous.result, replayed: true }, unchanged: true };
      let result: Record<string, unknown> = { ok: true };
      if (input.action === "create-link") {
        if (state.inviteLinks.filter(item => !item.revokedAt && item.expiresAt > now).length >= 50) fail("This room has too many active invite links.");
        const token = randomBytes(32).toString("base64url"), link = { id: randomUUID(), tokenHash: digest(token), createdBy: actorId, createdAt: now, expiresAt: now + (input.durationDays || 7) * 86400000, maxUses: input.maxUses || 10, uses: [] as string[], revokedAt: null };
        state.inviteLinks.push(link); const { tokenHash: _hash, uses, ...safe } = link; result = { ok: true, token, link: { ...safe, uses: uses.length } };
      } else if (input.action === "revoke-link") {
        const link = state.inviteLinks.find(item => item.id === input.linkId) || fail("Invite link not found.");
        if (link.revokedAt !== null) return { result: { ok: true, replayed: true }, unchanged: true };
        link.revokedAt = now;
      } else {
        const invitationId = input.invitationId || fail("Choose an invitation.");
        if (!invitations.some(item => item.id === invitationId)) fail("Invitation not found.");
        if (state.cancelledInvitations.includes(invitationId)) return { result: { ok: true, replayed: true }, unchanged: true };
        state.cancelledInvitations.push(invitationId);
      }
      appendModerationLog(draft, { action: input.action, actorId, reason: "", requestId: input.requestId });
      // A lost creation response can recover the link identity, but its bearer
      // token is intentionally never retained in a durable receipt.
      receipt.commit(input.action === "create-link" ? { ok: true, link: result.link, tokenUnavailable: true } : result);
      return { result };
    });
    if (!result.replayed) this.options.broadcast?.(room); return result;
  }
  async redeemLink(roomId: string, actorId: string, token: string, requestId: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !uuid.safeParse(requestId).success) fail("Invalid invite link.");
    const room = await this.room(roomId);
    return this.store.changeRoom(room, async draft => {
      await this.actor(draft, actorId);
      const state = ensureModeration(draft), hash = digest(token), now = this.now();
      const link = state.inviteLinks.find(item => item.tokenHash.length === hash.length && timingSafeEqual(Buffer.from(item.tokenHash), Buffer.from(hash))) || fail("Invite link not found.");
      if (link.revokedAt !== null || link.expiresAt <= now) fail("This invite link has expired or was revoked.");
      const creator = await this.store.getRoomAccess(roomId, link.createdBy), policy = draft.settings.invitePermission || "default";
      if (creator.banned || !creator.role || (policy === "owner" && link.createdBy !== draft.ownerUserId) || ((policy === "staff" || (policy === "default" && accessMode(draft) === "members")) && !hasRoomCapability(draft, link.createdBy, "accessInvites"))) fail("This invite can no longer grant room access.");
      const receipt = this.receipt(draft, actorId, requestId, { tokenHash: hash }); if (receipt.previous) return { result: receipt.previous.result, unchanged: true };
      const access = await this.store.getRoomAccess(roomId, actorId);
      if (link.uses.includes(actorId) && accessMode(draft) === "members" && !access.role) fail("Your room access was removed.");
      if (link.uses.includes(actorId) && access.role) return { result: { ok: true, roomSlug: roomId, passwordRequired: draft.passwordProtected }, unchanged: true };
      if (!link.uses.includes(actorId)) { if (link.uses.length >= link.maxUses) fail("This invite link has reached its use limit."); link.uses.push(actorId); }
      const role = access.role || "member", previous = state.members[actorId];
      Object.defineProperty(state.members, actorId, { value: { user: previous?.user || { id: actorId, name: "Listener", avatarSeed: actorId }, role, joinedAt: previous?.joinedAt || now }, enumerable: true, writable: true, configurable: true });
      const result = { ok: true, roomSlug: roomId, passwordRequired: draft.passwordProtected };
      receipt.commit(result); appendModerationLog(draft, { action: "invite-redeem", actorId, reason: "", requestId });
      return { result, member: { user_id: actorId, role } };
    });
  }
  async expire(room: Room) {
    const now = this.now();
    if (!(room.moderation?.restrictions.some(item => item.revokedAt === null && item.expiresAt !== null && item.expiresAt <= now) || room.settings.sessionOverrides?.some(item => item.expiresAt <= now))) return false;
    await this.store.changeRoom(room, draft => {
      const state = ensureModeration(draft);
      for (const item of state.restrictions) if (item.revokedAt === null && item.expiresAt !== null && item.expiresAt <= now) { item.revokedAt = now; item.revokedBy = "system"; appendModerationLog(draft, { action: "restriction-expired", actorId: "system", targetUserId: item.userId, restrictionId: item.id, reason: "" }, now); }
      const expired = draft.settings.sessionOverrides?.filter(item => item.expiresAt <= now) || [];
      draft.settings.sessionOverrides = draft.settings.sessionOverrides?.filter(item => item.expiresAt > now);
      for (const item of expired) appendModerationLog(draft, { action: "session-expired", actorId: "system", reason: "", details: { kind: item.kind } }, now);
      return { result: undefined, ...(expired.length ? { metadata: { settings: draft.settings } } : {}) };
    });
    this.options.broadcast?.(room); return true;
  }
}
