import { telemetry, type MetricOptions, type MetricOutcome } from "../../shared/observability.js";

type ActionMetric = "server.queue.command" | "server.library.write";

/** One attempt has one final outcome, even when an acknowledgement is repeated. */
export function beginActionMetric(name: ActionMetric, operation: string, now = () => performance.now()) {
  const started = now();
  let finished = false;
  telemetry.metrics.count(`${name}.attempts`, 1, { attributes: { operation } });
  return (outcome: MetricOutcome, context: NonNullable<MetricOptions["attributes"]> = {}) => {
    if (finished) return;
    finished = true;
    const options = { attributes: { ...context, operation, outcome } };
    telemetry.metrics.count(`${name}.results`, 1, options);
    telemetry.metrics.distribution(`${name}.duration`, Math.max(0, now() - started), { ...options, unit: "millisecond" });
  };
}

const queueOperations: Record<string, string> = {
  "queue:add": "queue.add", "queue:remove": "queue.remove", "queue:move": "queue.move",
  "queue:play-next": "queue.play_next", "queue:next": "queue.next", "queue:undo": "queue.undo",
  "queue:set-add": "queue.set_add", "queue:exception": "queue.exception", "queue:exception-request": "queue.exception_request"
};

/** Observe the actual command acknowledgement, never its payload or error text. */
export function observeQueueCommand(event: string, acknowledgement: unknown) {
  if (!Object.hasOwn(queueOperations, event)) return;
  const finish = beginActionMetric("server.queue.command", queueOperations[event]);
  return {
    finish,
    reply(result: { ok: boolean; [key: string]: unknown }) {
      finish(result.ok ? "success" : "failure");
      if (typeof acknowledgement === "function") acknowledgement(result);
    }
  };
}
