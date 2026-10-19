import type { RoomBase, Track, Room as PublicRoom } from "../shared/types.js";
export * from "../shared/types.js";

/** Authoritative room state. Its private queues must never cross the snapshot boundary. */
export interface Room extends RoomBase {
  djQueues: Record<string, Track[]>;
  /** Private staff records. Never serialize as public room state. */
  moderation?: RoomModerationState;
  radioState?: import("./radio-policy.js").RadioState;
  /** Legacy persisted shape, consumed by normalization. */
  queue?: Track[];
}
export interface RoomRestriction {
  id: string; userId: string; kind: "chat-timeout" | "room-ban" | "dj-suspension";
  actorId: string; reason: string; createdAt: number; expiresAt: number | null;
  revokedAt: number | null; revokedBy?: string; deferUntilTrackId?: string; removeAfterTrackOnly?: boolean;
}
export interface ModerationEvent {
  id: string; action: string; actorId: string; createdAt: number; reason: string;
  targetUserId?: string; messageId?: string; restrictionId?: string; requestId?: string;
  details?: Record<string, unknown>;
}
export interface RoomReport {
  id: string; reporterId: string; targetUserId?: string; messageId?: string; trackId?: string;
  category: string; reason: string; createdAt: number;
  status: "open" | "resolved" | "dismissed"; resolvedAt?: number; resolvedBy?: string;
}
export interface RoomWarning { id: string; userId: string; actorId: string; text: string; createdAt: number; readAt: number | null }
export interface RoomMemberRecord { user: import("../shared/types.js").User; role: import("../shared/types.js").RoomRole; joinedAt: number }
export interface RoomInviteLink {
  id: string; tokenHash: string; createdBy: string; createdAt: number; expiresAt: number;
  maxUses: number; uses: string[]; revokedAt: number | null;
}
export interface RoomModerationState {
  restrictions: RoomRestriction[]; log: ModerationEvent[]; reports: RoomReport[]; warnings: RoomWarning[];
  members: Record<string, RoomMemberRecord>; receipts: Record<string, { hash: string; result: Record<string, unknown>; createdAt: number }>;
  inviteLinks: RoomInviteLink[]; rulesAcceptance: Record<string, number>; cancelledInvitations: string[];
}
export type SnapshotRoom = PublicRoom;
export interface MusicProviderConnection {
  userId: string;
  provider: "spotify";
  refreshTokenCiphertext: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
