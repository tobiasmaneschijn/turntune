import { telemetry } from "../../shared/observability.js";

export interface ServerCapacity {
  activeRooms: number;
  connectedListeners: number;
  connectedSockets: number;
  pendingRoomCommands: number;
}

/** Read process-local counts periodically; sampling never performs database work. */
export function startCapacityMetrics(read: () => ServerCapacity): () => void {
  const sample = () => {
    try {
      const capacity = read();
      if (!Object.values(capacity).every(value => Number.isSafeInteger(value) && value >= 0)) return;
      telemetry.metrics.gauge("server.rooms.active", capacity.activeRooms);
      telemetry.metrics.gauge("server.listeners.connected", capacity.connectedListeners);
      telemetry.metrics.gauge("server.sockets.connected", capacity.connectedSockets);
      telemetry.metrics.gauge("server.room_commands.pending", capacity.pendingRoomCommands);
    } catch { /* Observability cannot interrupt the server or prevent shutdown. */ }
  };
  sample();
  const timer = setInterval(sample, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
