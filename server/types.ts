import type { RoomBase, Track, Room as PublicRoom } from "../shared/types.js";
export * from "../shared/types.js";

/** Authoritative room state. Its private queues must never cross the snapshot boundary. */
export interface Room extends RoomBase {
  djQueues: Record<string, Track[]>;
  /** Legacy persisted shape, consumed by normalization. */
  queue?: Track[];
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
