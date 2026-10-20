import type { Provider } from "./provider-definitions.js";
export type { Provider } from "./provider-definitions.js";

export interface User {
  id: string;
  name: string;
  avatarSeed: string;
  avatarKey?: string;
  avatarUrl?: string;
  isAppAdmin?: boolean;
}

export interface SoundSpinProfile {
  user_id: string;
  display_name: string;
  is_app_admin: boolean;
  bio: string;
  avatar_key: string;
  avatar_url: string | null;
  avatar_path: string | null;
  theme_key: string;
  created_at: string;
  updated_at: string;
  handle?: string | null;
  status_text?: string;
  favorite_tracks?: ProfileTrack[];
}

/** Explicitly featured songs; never contains private queue or account data. */
export interface ProfileTrack {
  provider: Provider;
  providerId: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  permalinkUrl?: string;
  durationMs?: number;
}

export interface SoundSpinProfileOption {
  key: string;
  kind: "avatar" | "theme";
  name: string;
  metadata: { gradient?: string; imageUrl?: string; description?: string };
}

export interface Track {
  id: string;
  canonicalId?: string;
  isrc?: string;
  provider: Provider;
  providerId: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  permalinkUrl?: string;
  durationMs?: number;
  /** Set only by a provider lookup on the server. */
  durationVerified?: boolean;
  isLive?: boolean;
  mappings?: Partial<Record<Provider, ProviderTrackMapping>>;
  addedBy: User;
  addedAt: number;
  /** Actual server time the track began playing; absent on legacy history. */
  playedAt?: number;
}

export interface ProviderTrackMapping {
  providerId: string;
  permalinkUrl?: string;
  artworkUrl?: string;
  storefront?: string;
  matchMethod?: "source" | "isrc" | "exact-metadata" | "fuzzy";
}

export interface Playback {
  track: Track | null;
  playing: boolean;
  position: number;
  updatedAt: number;
  origin?: "dj" | "fallback";
  revision?: number;
}

export interface VibeState {
  trackId: string;
  votes: Record<string, -1 | 1>;
}

export type DjAccess = "everyone" | "roles";

export interface RoomAnnouncement {
  id: string;
  text: string;
  authorId: string;
  updatedAt: number;
  expiresAt: number | null;
}

export interface RoomSettings {
  /** Disabled unless an application administrator enables it for this room. */
  spotifyEnabled?: boolean;
  djAccess?: DjAccess;
  allowedProviders?: Provider[];
  description?: string;
  themePrompt?: string;
  accessMode?: "public" | "unlisted" | "members";
  moderatorPermissions?: ModeratorPermissions;
  invitePermission?: "default" | "owner" | "staff" | "members";
  rulesText?: string;
  rulesVersion?: number;
  requireRulesAcceptance?: boolean;
  chatMode?: "everyone" | "staff";
  slowModeSeconds?: 0 | 5 | 10 | 30 | 60;
  mediaPermission?: FeaturePermission;
  linksPermission?: FeaturePermission;
  pollsPermission?: FeaturePermission;
  djJoinLocked?: boolean;
  djCapacity?: number | null;
  maxTrackMinutes?: number | null;
  repeatWindowMinutes?: number | null;
  manualPlayback?: "current-dj" | "staff";
  songsPerTurn?: 1 | 2 | 3;
  skipVote?: { enabled: boolean; percent: number; minimum: number };
  tags?: string[];
  language?: string;
  themeSchedules?: ThemeSchedule[];
  sessionOverrides?: SessionOverride[];
  [key: string]: unknown;
}

export type FeaturePermission = "everyone" | "staff" | "nobody";
export interface ModeratorPermissions { chatParticipants: boolean; djsPlayback: boolean; roomDetailsMusic: boolean; accessInvites: boolean }
export type RoomCapability = keyof ModeratorPermissions;
export interface ThemeSchedule { id: string; theme: string; startsAt: number; endsAt: number; timeZone: string; note?: string }
export interface SessionOverride { id: string; kind: "slow-mode" | "staff-chat" | "dj-lock"; expiresAt: number; value?: number; authorId: string }
export interface RoomCapabilities extends ModeratorPermissions { owner: boolean; staff: boolean; invite: boolean; chat: boolean; media: boolean; links: boolean; polls: boolean; joinDj: boolean; playback: boolean }
export interface OwnRoomStatus { chatTimeoutUntil?: number | null; djSuspendedUntil?: number | null; rulesAccepted?: boolean; warnings?: Array<{id:string;text:string;createdAt:number}>; openReports?: number }
export interface RadioSummary { stopped: boolean; stopAfterTrackId: string | null; fallbackEnabled: boolean; fallbackCount: number; turn?: {used:number;limit:number}; skipVote: { trackId: string | null; count: number; required: number; voted: boolean }; ineligibleTracks: Record<string,string> }

export interface RoomBase {
  id: string;
  name: string;
  ownerUserId: string;
  moderatorUserIds: string[];
  djRoleUserIds: string[];
  isPublic: boolean;
  passwordProtected: boolean;
  settings: RoomSettings;
  announcement?: RoomAnnouncement | null;
  /** User on air; having a DJ role or joining the lineup does not imply this. */
  djUserId: string | null;
  /** Rotation order, with the next candidate at index 0. */
  djQueueUserIds: string[];
  history: Track[];
  playback: Playback;
  vibe: VibeState | null;
  createdAt: number;
  policyRevision?: number;
  capabilities?: RoomCapabilities;
  ownStatus?: OwnRoomStatus;
  radio?: RadioSummary;
  sessionNote?: { id: string; text: string; expiresAt: number } | null;
  activeTheme?: string;
}

/** Public listener state never carries the server's private queue map. */
export interface Room extends RoomBase { queue: Track[] }

export type RoomRole = "owner" | "moderator" | "dj" | "member";

export interface RoomDirectoryEntry {
  slug: string;
  name: string;
  ownerId: string;
  isPublic: boolean;
  accessMode?: "public" | "unlisted" | "members";
  passwordProtected: boolean;
  isFavorite: boolean;
  role: RoomRole | null;
  listenerCount: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
  tags?: string[];
  language?: string;
  /** Bounded, public/unprotected room preview; never a private DJ queue. */
  preview?: { title: string; artist?: string; artworkUrl?: string; provider?: Provider; playing: boolean; observedAt: number };
}

export interface RoomSnapshot {
  /** Personalized by the server: room.queue contains this recipient's tracks. */
  room: Room;
  /** Currently connected listeners. */
  users: User[];
  /** Joined DJ identities, retained during the one-minute disconnect grace. */
  djUsers: User[];
  serverTime: number;
}

export interface RoomPresence {
  roomId: string;
  users: User[];
  djUsers: User[];
  serverTime: number;
}

export interface SocketReply {
  ok: boolean;
  error?: string;
  requiresPassword?: boolean;
  started?: boolean;
  position?: number;
  undo?: { token: string; expiresAt: number; title: string };
  added?: number;
  skipped?: Array<{ title: string; reason: string }>;
}
