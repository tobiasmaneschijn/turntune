import type { Room, RoomPresence, User } from "./types.js";

/**
 * Presence is stored per socket so multiple tabs can reconnect independently,
 * but room UI and listener counts represent people. The newest socket value
 * wins so profile/avatar changes propagate without rendering duplicates.
 */
export function uniqueUsers(users: Iterable<User>): User[] {
  return [...new Map([...users].map((user) => [user.id, user])).values()];
}

/** Build the shared payload for a presence-only socket event. */
export function roomPresence(
  room: Room,
  users: Iterable<User>,
  djUsers: Iterable<User>,
  serverTime = Date.now()
): RoomPresence {
  return {
    roomId: room.id,
    users: uniqueUsers(users),
    djUsers: [...djUsers].filter((user) => room.djQueueUserIds.includes(user.id)),
    serverTime
  };
}
