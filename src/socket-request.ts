import i18n from "./i18n";
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
    reply({ ok: false, error: i18n.t("common:socket_request_you_are_offline_reconnect_and_try_again") });
    return;
  }
  if (!validateRoomCommand(event, payload)) {
    reply({ ok: false, error: i18n.t("common:socket_request_this_room_command_is_invalid_refresh_the_room_and_try_again") });
    return;
  }
  socket.timeout(15_000).emit(event, payload, (error, result) => {
    if (error) {
      reply({ ok: false, error: i18n.t("common:socket_request_the_request_timed_out_check_the_room_before_trying_again") });
    } else if (!result || typeof result.ok !== "boolean") {
      reply({ ok: false, error: i18n.t("common:socket_request_the_server_returned_an_invalid_response_try_again") });
    } else {
      reply(result);
    }
  });
}
