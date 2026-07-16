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

export interface ChatMessage {
  id: string;
  user: User;
  text: string;
  sentAt: number;
}

export interface Room {
  id: string;
  name: string;
  ownerUserId: string;
  djUserId: string | null;
  queue: Track[];
  playback: Playback;
  messages: ChatMessage[];
  createdAt: number;
}

export interface RoomSnapshot {
  room: Room;
  users: User[];
  serverTime: number;
}
