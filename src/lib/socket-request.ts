import i18n from "../i18n";
import type { SocketReply } from '../../shared/types.js';
import { validateRoomCommand } from '../../shared/room-protocol.js';
import { telemetry, type MetricOutcome, type MetricReason } from "../../shared/observability";
export type { SocketReply } from '../../shared/types.js';

export interface SocketActionOutcome { outcome: MetricOutcome; reason?: MetricReason }
const queueOperations: Record<string, string> = {
  "queue:add": "queue.add", "queue:remove": "queue.remove", "queue:move": "queue.move",
  "queue:play-next": "queue.play_next", "queue:next": "queue.next", "queue:exception": "queue.exception",
  "queue:exception-request": "queue.exception_request", "queue:undo": "queue.undo", "queue:set-add": "queue.set_add"
};

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
  reply: (result: SocketReply, outcome?: SocketActionOutcome) => void
) {
  // Only code-owned queue commands become metric dimensions; payloads stay local.
  const operation = Object.hasOwn(queueOperations, event) ? queueOperations[event] : undefined;
  const started = performance.now();
  let settled = false;
  if (operation) telemetry.metrics.count("queue.command.attempts", 1, { attributes: { operation } });
  const finish = (outcome: SocketActionOutcome) => {
    if (settled) return false;
    settled = true;
    if (operation) {
      const attributes = { operation, ...outcome };
      telemetry.metrics.count("queue.command.results", 1, { attributes });
      telemetry.metrics.distribution("queue.command.duration", Math.max(0, performance.now() - started), { unit: "millisecond", attributes });
    }
    return true;
  };
  const complete = (result: SocketReply, outcome: SocketActionOutcome) => {
    if (finish(outcome)) reply(result, outcome);
  };
  if (!socket.connected) {
    complete({ ok: false, error: i18n.t("common:socket_request_you_are_offline_reconnect_and_try_again") }, { outcome: "offline", reason: "network" });
    return;
  }
  if (!validateRoomCommand(event, payload)) {
    complete({ ok: false, error: i18n.t("common:socket_request_this_room_command_is_invalid_refresh_the_room_and_try_again") }, { outcome: "rejected", reason: "client" });
    return;
  }
  try {
    socket.timeout(15_000).emit(event, payload, (error, result) => {
      if (error) {
        complete({ ok: false, error: i18n.t("common:socket_request_the_request_timed_out_check_the_room_before_trying_again") }, { outcome: "timeout", reason: "network" });
      } else if (!result || typeof result.ok !== "boolean") {
        complete({ ok: false, error: i18n.t("common:socket_request_the_server_returned_an_invalid_response_try_again") }, { outcome: "failure", reason: "invalid_response" });
      } else {
        complete(result, result.ok ? { outcome: "success" } : { outcome: "rejected", reason: result.requiresPassword ? "unauthorized" : "server" });
      }
    });
  } catch (error) {
    finish({ outcome: "failure", reason: "network" });
    throw error;
  }
}
