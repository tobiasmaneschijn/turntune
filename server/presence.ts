import type { User } from "./types.js";

/**
 * Presence is stored per socket so multiple tabs can reconnect independently,
 * but room UI and listener counts represent people. The newest socket value
 * wins so profile/avatar changes propagate without rendering duplicates.
 */
export function uniqueUsers(users: Iterable<User>): User[] {
  return [...new Map([...users].map((user) => [user.id, user])).values()];
}
