import type { Store, RoomChange } from "./store.js";
import type { Room } from "./types.js";

/** Commands operate on a private draft; only a durable commit becomes visible. */
export class RoomCommandService {
  constructor(private readonly store: Store, private readonly broadcast: (room: Room) => void) {}
  async execute<T>(room: Room, change: (draft: Room) => RoomChange<T> | Promise<RoomChange<T>>) {
    let changed = false;
    const result = await this.store.changeRoom(room, async draft => {
      const outcome = await change(draft), committed = outcome.committed;
      outcome.committed = () => { changed = !outcome.unchanged; committed?.(); };
      return outcome;
    });
    if (changed) this.broadcast(room);
    return result;
  }
}
