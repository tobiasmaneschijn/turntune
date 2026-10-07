export type Provider = "youtube" | "spotify" | "apple" | "soundcloud";

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
  djAccess?: DjAccess;
  description?: string;
  [key: string]: unknown;
}

export interface Room {
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
  /** Only the signed-in listener's queue is included in snapshots. */
  queue: Track[];
  history: Track[];
  playback: Playback;
  vibe: VibeState | null;
  createdAt: number;
}

export type RoomRole = "owner" | "moderator" | "dj" | "member";

export interface RoomDirectoryEntry {
  slug: string;
  name: string;
  ownerId: string;
  isPublic: boolean;
  passwordProtected: boolean;
  isFavorite: boolean;
  role: RoomRole | null;
  listenerCount: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
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
