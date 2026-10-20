import assert from "node:assert/strict";
import test from "node:test";
import { createMetricBatch } from "../../shared/metric-batch.js";
import type { MetricOptions, MetricType } from "../../shared/observability.js";

interface Measurement { type: MetricType; name: string; value: number; options: MetricOptions }

test("busy provider traffic retains request totals and current capacity without flooding the metric sink", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: Measurement[] = [];
  const batch = createMetricBatch((type, name, value, options) => { sent.push({ type, name, value, options }); });
  const attributes = { operation: "provider.request", provider: "spotify" };
  for (let index = 0; index < 1_000; index++) {
    // Different property order must not create a second series.
    batch.record("count", "provider.request.attempts", 1, { attributes: index % 2 ? { provider: "spotify", operation: "provider.request" } : attributes });
    batch.record("count", "provider.request.results", 1, { attributes: { provider: "spotify", operation: "provider.request" } });
    batch.record("gauge", "server.sockets.connected", index, {});
  }
  assert.equal(sent.length, 0);
  t.mock.timers.tick(30_000);
  assert.deepEqual(sent.map(({ name, value }) => ({ name, value })), [
    { name: "provider.request.attempts", value: 1_000 },
    { name: "provider.request.results", value: 1_000 },
    { name: "server.sockets.connected", value: 999 }
  ]);
  t.mock.timers.tick(60_000);
  assert.equal(sent.length, 3);
  batch.record("count", "provider.request.attempts", 1, { attributes });
  batch.flush();
  t.mock.timers.tick(30_000);
  assert.equal(sent.length, 4);
  assert.equal(sent[3].value, 1);
});

test("a busy latency window keeps a bounded sample from across the whole burst and a failing sink leaves later metrics available", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // A deterministic random stream selects later values into the reservoir.
  t.mock.method(Math, "random", () => 0);
  const sent: Measurement[] = [];
  let failing = true;
  const batch = createMetricBatch((type, name, value, options) => {
    if (name === "unavailable.sink" && failing) throw new Error("offline");
    sent.push({ type, name, value, options });
  });
  batch.record("count", "unavailable.sink", 1, {});
  for (let value = 1; value <= 1_000; value++) batch.record("distribution", "provider.request.duration", value, { unit: "millisecond" });
  assert.doesNotThrow(() => batch.flush());
  assert.equal(sent.length, 16);
  assert.ok(sent.some(item => item.value === 1_000));
  assert.ok(sent.every(item => item.type === "distribution" && item.options.unit === "millisecond"));
  failing = false;
  batch.record("count", "unavailable.sink", 1, {});
  batch.record("count", "large.counter", 1e9, {});
  batch.record("count", "large.counter", 2, {});
  batch.flush();
  assert.equal(sent.filter(item => item.name === "large.counter").reduce((total, item) => total + item.value, 0), 1e9 + 2);
  assert.ok(sent.filter(item => item.name === "large.counter").every(item => item.value <= 1e9));
  assert.equal(sent.find(item => item.name === "unavailable.sink")?.value, 1);
  const afterFlush = sent.length;
  t.mock.timers.tick(60_000);
  assert.equal(sent.length, afterFlush);
});
