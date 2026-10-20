import type { Room } from "../../types.js";

export interface AccountRestrictionCleanup {
  cachedRooms: () => readonly Room[];
  blockAccount: (userId: string) => void;
  restrictOwnedRoom: (roomId: string) => Promise<void>;
  removeDjFromRoom: (room: Room, userId: string) => Promise<void>;
  disconnectAccount: (userId: string) => void;
}

/** A platform restriction must not take the ordinary disconnect grace path.
 * Snapshot durable-backed cached rooms before presence disappears, block the
 * actor synchronously, and finish ordered DJ cleanup before disconnecting. */
export async function cleanupRestrictedAccount(userId: string, options: AccountRestrictionCleanup): Promise<void> {
  const rooms = [...options.cachedRooms()].map(room => ({
    room,
    owned: room.ownerUserId === userId,
    dj: room.djUserId === userId || room.djQueueUserIds.includes(userId)
  }));
  options.blockAccount(userId);
  for (const { room, owned } of rooms) if (owned) await options.restrictOwnedRoom(room.id);
  for (const { room, owned, dj } of rooms) if (!owned && dj) await options.removeDjFromRoom(room, userId);
  // A failed cleanup leaves the actor blocked. Retrying can finish durable
  // removal without creating a new grace timer from a partial disconnect.
  options.disconnectAccount(userId);
}
