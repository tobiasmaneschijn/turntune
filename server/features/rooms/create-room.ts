import type { Room } from "../../types.js";

export function createRoom(id: string, ownerUserId: string, name?: string): Room {
  return {
    id,
    name: name || id.replaceAll("-", " "),
    ownerUserId,
    moderatorUserIds: [],
    djRoleUserIds: [],
    isPublic: true,
    passwordProtected: false,
    settings: { djAccess: "everyone" },
    djUserId: null,
    djQueueUserIds: [],
    djQueues: {},
    history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: Date.now() },
    vibe: null,
    createdAt: Date.now()
  };
}
