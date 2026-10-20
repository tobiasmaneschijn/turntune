import i18n from "../../i18n";
import type { RoomRole, User } from "../../types";
import { requestJson } from "../../lib/authenticated-http";

export interface RoomRestriction { id: string; userId: string; kind: "chat-timeout" | "room-ban" | "dj-suspension"; createdAt: number; expiresAt: number | null; revokedAt: number | null; reason?: string; actorId?: string }
export interface RoomMember { user: User; role: RoomRole; online: boolean; restrictions: RoomRestriction[] }
export interface ModerationItem { id: string; action?: string; kind?: string; category?: string; status?: string; userId?: string; targetUserId?: string; actorId?: string; reporterId?: string; messageId?: string; trackId?: string; reason?: string; text?: string; createdAt: number; expiresAt?: number | null; revokedAt?: number | null; context?: { content?: string; user?: User }; target?: User; actor?: User }
export interface RoomInvitation { id: string; recipientId?: string; recipientName?: string; senderId?: string; state?: string; createdAt?: number }
export interface RoomInviteLink { id: string; expiresAt: number | null; maxUses: number | null; uses: number; revokedAt?: number | null }
export type ModerationAction = "timeout" | "kick" | "ban" | "dj-remove" | "dj-suspend" | "revoke" | "warn" | "remove-message" | "member-remove" | "role" | "report-resolve" | "report-dismiss" | "session" | "session-end";
export interface RoomAction { action: ModerationAction; userId?: string; durationMinutes?: number | null; reason?: string; restrictionId?: string; messageId?: string; role?: "moderator" | "dj" | "member"; enabled?: boolean; reportId?: string; mode?: "after-track" | "skip"; kind?: "slow-mode" | "staff-chat" | "dj-lock"; value?: number; overrideId?: string }
export function roomManagementRequest<T>(roomId: string, path: string, accessToken: string, options?: RequestInit) { return requestJson<T>(`/api/rooms/${encodeURIComponent(roomId)}/${path}`, { ...options, accessToken }); }
export function roomModerationAction(roomId: string, accessToken: string, action: RoomAction, requestId: string = crypto.randomUUID(), signal?: AbortSignal) { return roomManagementRequest<{ ok: boolean }>(roomId, "moderation/actions", accessToken, { method: "POST", body: JSON.stringify({ requestId, ...action }), signal }); }
export function formatRoomTime(timestamp: number | null | undefined) { return timestamp == null ? i18n.t("common:permanent") : new Date(timestamp).toLocaleString(i18n.resolvedLanguage); }
