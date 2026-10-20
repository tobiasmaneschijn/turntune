import assert from "node:assert/strict";
import test from "node:test";
import { configureTelemetry, type MetricOptions } from "../../../shared/observability";
import { requestSocketAction, type SocketReply } from "../../../src/lib/socket-request";

test("A listener retries a queue action after losing its acknowledgement without duplicate results or private metrics", () => {
  const metrics: Array<{ name: string; options: MetricOptions }> = [];
  const restore = configureTelemetry({ captureError() {}, log() {},
    metric(_type, name, _value, options) { metrics.push({ name, options }); }, async flush() {} });
  const pending: Array<(error: Error | null, result?: SocketReply) => void> = [];
  const socket = { connected: false,
    timeout() { return { emit(_event: string, _payload: unknown, reply: (error: Error | null, result?: SocketReply) => void) { pending.push(reply); } }; }
  };
  const replies: SocketReply[] = [];
  const payload = { trackId: "00000000-0000-4000-8000-000000000001" };
  try {
    requestSocketAction(socket, "queue:remove", payload, reply => replies.push(reply));
    assert.equal(pending.length, 0);
    assert.equal(replies[0].ok, false);
    socket.connected = true;
    requestSocketAction(socket, "queue:remove", payload, reply => replies.push(reply));
    pending[0](new Error("private access_token=secret"));
    pending[0](null, { ok: true });
    assert.equal(replies.length, 2);
    requestSocketAction(socket, "queue:remove", payload, reply => replies.push(reply));
    pending[1](null, { ok: true });
    assert.equal(replies[2].ok, true);
    assert.deepEqual(metrics.filter(metric => metric.name === "queue.command.results").map(metric => metric.options.attributes?.outcome),
      ["offline", "timeout", "success"]);
    assert.equal(metrics.filter(metric => metric.name === "queue.command.attempts").length, 3);
    assert.equal(metrics.filter(metric => metric.name === "queue.command.duration").length, 3);
    assert.doesNotMatch(JSON.stringify(metrics), /00000000|private|access_token|secret/);
  } finally { restore(); }
});
