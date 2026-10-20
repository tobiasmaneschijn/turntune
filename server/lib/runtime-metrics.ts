import { AsyncLocalStorage } from "node:async_hooks";
import { measureOperation, observeOperation } from "../observability/performance.js";
import { telemetry } from "../../shared/observability.js";

type Operation = "room_save" | "room_command" | "provider_request" | "chat_message" | "chat_reaction" | "chat_typing";
type DatabaseOperation = "read" | "write" | "rpc" | "auth" | "storage" | "other";
interface Observation { count: number; failures: number; totalMs: number; maxMs: number }
interface DatabaseWork { requests: number; totalMs: number }

/** Fixed operation names keep diagnostics bounded and free of account/room data. */
export class RuntimeMetrics {
  private observations = new Map<Operation, Observation>();
  private database = new Map<DatabaseOperation, Observation>();
  private workflows = new Map<Operation, { count: number; requests: number; maxRequests: number; totalMs: number }>();
  private readonly work = new AsyncLocalStorage<DatabaseWork>();
  pendingRoomCommands = 0;
  observe(operation: Operation, elapsedMs: number, failed = false, recordSpan = true) {
    observeOperation(operation, elapsedMs, failed, "workflow", recordSpan);
    const options = { attributes: { operation, outcome: failed ? "failure" as const : "success" as const } };
    telemetry.metrics.count("server.operation.results", 1, options);
    telemetry.metrics.distribution("server.operation.duration", Math.max(0, elapsedMs), { ...options, unit: "millisecond" });
    const value = this.observations.get(operation) || { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    value.count++;
    value.failures += Number(failed);
    value.totalMs += elapsedMs;
    value.maxMs = Math.max(value.maxMs, elapsedMs);
    this.observations.set(operation, value);
  }
  async measure<T>(operation: Operation, run: () => Promise<T>, isFailure?: (result: T) => boolean): Promise<T> {
    const started = performance.now();
    const work = { requests: 0, totalMs: 0 };
    let failed = true;
    try {
      const result = await measureOperation(operation, () => this.work.run(work, run), result => {
        failed = isFailure?.(result) ?? false;
        return failed;
      });
      return result;
    } finally {
      this.observe(operation, performance.now() - started, failed, false);
      const value = this.workflows.get(operation) || { count: 0, requests: 0, maxRequests: 0, totalMs: 0 };
      value.count++;
      value.requests += work.requests;
      value.maxRequests = Math.max(value.maxRequests, work.requests);
      value.totalMs += work.totalMs;
      this.workflows.set(operation, value);
    }
  }
  observeDatabase(operation: DatabaseOperation, elapsedMs: number, failed: boolean) {
    observeOperation(operation, elapsedMs, failed, "database");
    const value = this.database.get(operation) || { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    value.count++;
    value.failures += Number(failed);
    value.totalMs += elapsedMs;
    value.maxMs = Math.max(value.maxMs, elapsedMs);
    this.database.set(operation, value);
    const work = this.work.getStore();
    if (work) { work.requests++; work.totalMs += elapsedMs; }
  }
  snapshot() {
    return { pendingRoomCommands: this.pendingRoomCommands, operations: Object.fromEntries(
      [...this.observations].map(([name, value]) => [name, { count: value.count, failures: value.failures,
        averageMs: value.count ? Math.round(value.totalMs / value.count) : 0, maxMs: Math.round(value.maxMs) }])
    ), database: Object.fromEntries([...this.database].map(([name, value]) => [name, {
      count: value.count, failures: value.failures,
      averageMs: value.count ? Math.round(value.totalMs / value.count) : 0, maxMs: Math.round(value.maxMs)
    }])), workflows: Object.fromEntries([...this.workflows].map(([name, value]) => [name, {
      count: value.count, requests: value.requests, averageRequests: value.requests / value.count,
      maxRequests: value.maxRequests, averageDatabaseMs: Math.round(value.totalMs / value.count)
    }])) };
  }
}

export const runtimeMetrics = new RuntimeMetrics();
