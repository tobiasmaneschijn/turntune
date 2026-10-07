import type { SocketReply } from '../shared/types.js';
import { validateRoomCommand } from '../shared/room-protocol.js';
export type { SocketReply } from '../shared/types.js';

interface RequestSocket {
  connected: boolean;
  timeout(ms: number): {
    emit(event: string, payload: unknown, reply: (error: Error | null, result?: SocketReply) => void): unknown;
  };
}

/** Never buffer actions while offline or leave a busy button waiting indefinitely. */
export function requestSocketAction(
  socket: RequestSocket,
  event: string,
  payload: unknown,
  reply: (result: SocketReply) => void
) {
  if (!socket.connected) {
    reply({ ok: false, error: "You are offline. Reconnect and try again." });
    return;
  }
  if (!validateRoomCommand(event, payload)) {
    reply({ ok: false, error: "This room command is invalid. Refresh the room and try again." });
    return;
  }
  socket.timeout(15_000).emit(event, payload, (error, result) => {
    if (error) {
      reply({ ok: false, error: "The request timed out. Check the room before trying again." });
    } else if (!result || typeof result.ok !== "boolean") {
      reply({ ok: false, error: "The server returned an invalid response. Try again." });
    } else {
      reply(result);
    }
  });
}
