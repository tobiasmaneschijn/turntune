export type Provider = "youtube" | "spotify" | "apple";

export interface User {
  id: string;
  name: string;
  avatarSeed: string;
  avatarKey?: string;
}

export interface SoundSpinProfile {
  user_id: string;
  display_name: string;
  bio: string;
  avatar_key: string;
  xp: number;
  songs_liked: number;
  created_at: string;
  updated_at: string;
}

export interface SoundSpinUnlock {
  key: string;
  kind: "avatar";
  name: string;
  required_level: number;
  metadata: { glyph?: string; gradient?: string };
}

export interface Track {
  id: string;
  provider: Provider;
  providerId: string;
  title: string;
  addedBy: User;
  addedAt: number;
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
  djUserId: string | null;
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
}

export interface RoomSnapshot {
  room: Room;
  users: User[];
  djUsers: User[];
  serverTime: number;
}
