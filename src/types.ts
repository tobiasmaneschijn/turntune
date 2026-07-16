export type Provider = "youtube" | "spotify" | "apple";

export interface User {
  id: string;
  name: string;
  avatarSeed: string;
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

export interface Room {
  id: string;
  name: string;
  ownerUserId: string;
  djUserId: string | null;
  queue: Track[];
  history: Track[];
  playback: Playback;
  vibe: VibeState | null;
  createdAt: number;
}

export interface RoomSnapshot {
  room: Room;
  users: User[];
  serverTime: number;
}
