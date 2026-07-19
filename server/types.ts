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
  featured_badge_key: string;
  signature_tracks: ProfileSignatureTrack[];
  xp: number;
  songs_liked: number;
  created_at: string;
  updated_at: string;
}

export type SignatureTrackSlot = "anthem" | "obsession" | "guilty-pleasure";

export interface ProfileSignatureTrack {
  slot: SignatureTrackSlot;
  provider: Provider;
  providerId: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  permalinkUrl?: string;
}

export interface SoundSpinProfileHighlights {
  rooms_played: number;
  favorite_track_title: string | null;
  favorite_track_artist: string | null;
  favorite_track_wins: number;
}

export interface SoundSpinUnlock {
  key: string;
  kind: "avatar" | "theme" | "badge";
  name: string;
  required_level: number;
  metadata: { glyph?: string; gradient?: string; imageUrl?: string; description?: string };
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
}

export interface ProviderTrackMapping {
  providerId: string;
  permalinkUrl?: string;
  artworkUrl?: string;
  storefront?: string;
}

export interface MusicProviderConnection {
  userId: string;
  provider: "spotify";
  refreshTokenCiphertext: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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

export interface RoomSettings {
  djAccess?: DjAccess;
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
  /** User currently on air. Normally matches playback.track.addedBy.id. */
  djUserId: string | null;
  /** Rotating lineup. The next candidate is at index 0. */
  djQueueUserIds: string[];
  /** Authoritative private queues. Server-only; never serialize this map. */
  djQueues: Record<string, Track[]>;
  /** Legacy shared queue, consumed once by normalizeRadioState. */
  queue?: Track[];
  history: Track[];
  playback: Playback;
  vibe: VibeState | null;
  createdAt: number;
}

export type RoomRole = "owner" | "moderator" | "dj" | "member";

export type SnapshotRoom = Omit<Room, "djQueues" | "queue"> & {
  /** The requesting listener's private queue. */
  queue: Track[];
};

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
}

export interface RoomSnapshot {
  /** Personalized room state; `room.queue` belongs to the recipient only. */
  room: SnapshotRoom;
  /** Users with a live socket. Used for presence/listener count. */
  users: User[];
  /** DJ identities, including disconnected DJs during their grace period. */
  djUsers: User[];
  serverTime: number;
}
