type Operation = "room_save" | "room_command" | "provider_request";
interface Observation { count: number; failures: number; totalMs: number; maxMs: number }

/** Fixed operation names keep diagnostics bounded and free of account/room data. */
export class RuntimeMetrics {
  private observations = new Map<Operation, Observation>();
  pendingRoomCommands = 0;
  observe(operation: Operation, elapsedMs: number, failed = false) {
    const value = this.observations.get(operation) || { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    value.count++;
    value.failures += Number(failed);
    value.totalMs += elapsedMs;
    value.maxMs = Math.max(value.maxMs, elapsedMs);
    this.observations.set(operation, value);
  }
  snapshot() {
    return { pendingRoomCommands: this.pendingRoomCommands, operations: Object.fromEntries(
      [...this.observations].map(([name, value]) => [name, { count: value.count, failures: value.failures,
        averageMs: value.count ? Math.round(value.totalMs / value.count) : 0, maxMs: Math.round(value.maxMs) }])
    ) };
  }
}

export const runtimeMetrics = new RuntimeMetrics();
