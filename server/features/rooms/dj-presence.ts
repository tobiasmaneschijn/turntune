import type { Room, User } from "../../types.js";

interface DjPresenceEffects {
  onlineUsers: Iterable<User>;
  remember: (roomId: string, user: User) => void;
  scheduleEviction: (room: Room, user: User) => void;
  cancelEviction: (roomId: string, userId: string) => void;
}

/** Reconcile a committed DJ entry with current presence after a yielded save. */
export function reconcileDjPresence(room: Room, user: User, effects: DjPresenceEffects) {
  if (!room.djQueueUserIds.includes(user.id)) return;
  effects.remember(room.id, user);
  if ([...effects.onlineUsers].some(online => online.id === user.id)) {
    effects.cancelEviction(room.id, user.id);
  } else {
    effects.scheduleEviction(room, user);
  }
}
