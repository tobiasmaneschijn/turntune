import assert from "node:assert/strict";
import test from "node:test";
import { configureTelemetry, type MetricOptions, type MetricType } from "../../shared/observability.js";
import { safeSocketHandler } from "../realtime/socket-handler.js";
import { observeQueueCommand } from "./actions.js";

test("a rejected queue command and its successful retry each have one measured outcome without private payload data", async t => {
  const measurements: Array<{ type: MetricType; name: string; value: number; options: MetricOptions }> = [];
  const restore = configureTelemetry({ captureError() {}, log() {}, async flush() {},
    metric(type, name, value, options) { measurements.push({ type, name, value, options }); } });
  t.after(restore);
  const replies: boolean[] = [];
  const rejected = observeQueueCommand("queue:add", (result: { ok: boolean }) => replies.push(result.ok))!;
  rejected.finish("rejected", { reason: "rate_limit" });
  rejected.reply({ ok: false, error: "private rejection message", retryAfter: 60 });
  rejected.finish("failure");
  const retried = observeQueueCommand("queue:add", (result: { ok: boolean }) => replies.push(result.ok))!;
  const save = safeSocketHandler(async (_payload, reply) => { reply?.({ ok: true }); });
  await save({ roomId: "private-room", title: "private recording" }, retried.reply);
  retried.finish("failure", { reason: "invalid_response" });
  assert.deepEqual(replies, [false, true]);
  assert.equal(measurements.filter(item => item.name === "server.queue.command.attempts").length, 2);
  const results = measurements.filter(item => item.name === "server.queue.command.results");
  assert.deepEqual(results.map(item => item.options.attributes), [
    { operation: "queue.add", outcome: "rejected", reason: "rate_limit" },
    { operation: "queue.add", outcome: "success" }
  ]);
  assert.ok(measurements.filter(item => item.type === "distribution").every(item => item.value >= 0 && item.options.unit === "millisecond"));
  assert.doesNotMatch(JSON.stringify(measurements), /private|roomId|recording|retryAfter/);
  assert.equal(observeQueueCommand("queue:private-room", undefined), undefined);
  assert.equal(measurements.length, 6);
});
