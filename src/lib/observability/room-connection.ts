import { telemetry, type MetricOutcome, type MetricReason } from "../../../shared/observability";

const disconnectReason = (value: unknown): MetricReason => value === "io client disconnect" ? "client"
  : value === "io server disconnect" ? "server" : "network";

/** A connection is usable only after room admission and a fresh snapshot agree.
 * Deadlines affect diagnostics only; they never cancel transport or application work. */
export function createRoomConnectionMetrics(now: () => number = () => performance.now()) {
  type Finish = (outcome: MetricOutcome, reason?: MetricReason) => void;
  let join: Finish | undefined;
  let recovery: Finish | undefined;
  let reconnect: Finish | undefined;
  let disposed = false;
  const measure = (prefix: string, operation: string, timeoutMs: number): Finish => {
    const started = now();
    let settled = false;
    telemetry.metrics.count(`${prefix}.attempts`, 1, { attributes: { operation } });
    const timer = setTimeout(() => finish("timeout", "network"), timeoutMs);
    const finish: Finish = (outcome, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const attributes = { operation, outcome, ...(reason ? { reason } : {}) };
      telemetry.metrics.count(`${prefix}.results`, 1, { attributes });
      telemetry.metrics.distribution(`${prefix}.duration`, Math.max(0, now() - started), { unit: "millisecond", attributes });
    };
    return finish;
  };
  const finishJoin: Finish = (outcome, reason) => { join?.(outcome, reason); join = undefined; };
  const finishRecovery: Finish = (outcome, reason) => { recovery?.(outcome, reason); recovery = undefined; };
  const finishReconnect: Finish = (outcome, reason) => { reconnect?.(outcome, reason); reconnect = undefined; };
  const startRecovery = () => { recovery ??= measure("socket.recovery", "socket.recovery", 60_000); };
  return {
    joinStarted() {
      if (!disposed) join ??= measure("room.join", "room.join", 30_000);
    },
    ready() {
      if (disposed) return;
      finishJoin("success");
      finishRecovery("success");
    },
    joinFailed(outcome: MetricOutcome, reason?: MetricReason) {
      if (disposed) return;
      finishJoin(outcome, reason);
      finishRecovery(outcome, reason);
    },
    disconnected(value: unknown) {
      if (disposed) return;
      const reason = disconnectReason(value);
      telemetry.metrics.count("socket.disconnects", 1, { attributes: { operation: "socket.disconnect", reason } });
      finishJoin(reason === "client" ? "canceled" : "failure", reason);
      finishReconnect(reason === "client" ? "canceled" : "failure", reason);
      if (reason === "client") finishRecovery("canceled", reason);
      else startRecovery();
    },
    reconnectAttempt() {
      if (disposed) return;
      startRecovery();
      finishReconnect("failure", "network");
      reconnect = measure("socket.reconnect", "socket.reconnect", 30_000);
    },
    reconnectConnected() { if (!disposed) finishReconnect("success"); },
    connectError(terminal: boolean) {
      if (disposed) return;
      finishJoin(terminal ? "rejected" : "failure", terminal ? "server" : "network");
      finishReconnect("failure", "network");
      if (terminal) finishRecovery("failure", "server");
    },
    reconnectFailed() {
      if (disposed) return;
      finishJoin("failure", "network");
      finishReconnect("failure", "network");
      finishRecovery("failure", "network");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      finishJoin("canceled", "client");
      finishReconnect("canceled", "client");
      finishRecovery("canceled", "client");
    }
  };
}
