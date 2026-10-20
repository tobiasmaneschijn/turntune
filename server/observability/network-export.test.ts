import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createTelemetry } from "../../shared/observability.js";
import { observabilityConfig } from "./config.js";
import { createSentryAdapter } from "./adapters/sentry.js";
import { startPerformance } from "./otel.js";
import { RuntimeMetrics } from "../lib/runtime-metrics.js";
import { createSentryTraceExporter } from "./adapters/sentry-traces.js";
import { getCurrentScope } from "@sentry/node";

test("Sentry receives useful code locations and logs without private content or automatic SDK context", async () => {
  const envelopes: unknown[] = [];
  const config = observabilityConfig({ NODE_ENV: "production", OBSERVABILITY_PROVIDER: "sentry", OBSERVABILITY_ENVIRONMENT: "staging", SENTRY_DSN: "https://publickey@monitoring.invalid/1" });
  const { adapter, traceExporter } = createSentryAdapter(config, () => ({
    send(envelope) { envelopes.push(envelope); return Promise.resolve({ statusCode: 200 }); },
    flush() { return Promise.resolve(true); }
  }));
  assert.ok(traceExporter);
  const reporter = createTelemetry(adapter), error = new Error("private message, access-token, response body");
  error.stack = "Error: private\n    at save (/app/dist-server/server/persistence/store.js:15:3)";
  const globals = globalThis as typeof globalThis & { _sentryDebugIds?: Record<string, string> };
  const previous = globals._sentryDebugIds;
  globals._sentryDebugIds = { "Error\n    at /app/dist-server/server/persistence/store.js:1:1": "23be68dc-a350-4237-a978-a318ad734c88" };
  try {
    getCurrentScope().setAttribute("private_scope_attribute", "private-scoped-secret");
    reporter.captureError(error, { operation: "room.save", status: 500, requestId: "c1c14747-7193-40f0-a3a3-9e111b8ec264" });
    reporter.log("warn", "provider.unavailable", { operation: "provider.request", provider: "spotify" });
    await reporter.flush(2_000);
    const items = (envelopes as Array<[unknown, Array<[{ type: string }, Record<string, unknown>]>]>).flatMap(envelope => envelope[1]);
    const event = items.find(([header]) => header.type === "event")?.[1];
    const logs = items.filter(([header]) => header.type === "log");
    assert.ok(event); assert.ok(logs.length);
    const encoded = JSON.stringify(items);
    assert.match(encoded, /Unexpected failure in room.save/);
    assert.match(encoded, /server\/persistence\/store.js/);
    assert.match(encoded, /23be68dc-a350-4237-a978-a318ad734c88/);
    assert.match(encoded, /provider.unavailable/);
    assert.doesNotMatch(encoded, /private|access-token|response body|\/app\/|cookies|request.headers|breadcrumbs/);
    assert.match(JSON.stringify(logs), /sentry.environment.*staging/);
    assert.match(JSON.stringify(logs), /sentry.release.*unknown/);
    assert.equal(event.environment, "staging");
    assert.deepEqual(event.user, { ip_address: "0.0.0.0", geo: {} });
  } finally { globals._sentryDebugIds = previous; }
});

test("operations export traces without leaking collector credentials to Sentry and bounded exporters preserve application results", async t => {
  const batches: Array<{ sink: string; path: string; body: string; headers: Record<string, unknown> }> = [];
  const sink = async (name: string) => {
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      batches.push({ sink: name, path: request.url!, body: Buffer.concat(chunks).toString(), headers: request.headers });
      response.setHeader("Content-Type", "application/json");
      response.end('{"private":"remote response content"}');
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address(); assert.ok(address && typeof address === "object");
    return `http://127.0.0.1:${address.port}`;
  };
  const collector = await sink("collector"), sentry = await sink("sentry");
  const previousHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS, previousTraceHeaders = process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Bearer%20process-collector-secret,x-process-extra=process-extra-secret";
  process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "x-process-trace=process-trace-secret";
  t.after(() => {
    if (previousHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_HEADERS; else process.env.OTEL_EXPORTER_OTLP_HEADERS = previousHeaders;
    if (previousTraceHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS; else process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = previousTraceHeaders;
  });
  const sentryExporter = createSentryTraceExporter({ url: `${sentry}/api/1/integration/otlp/v1/traces/`, headers: { "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=publickey" } });
  const performanceConfig = observabilityConfig({ NODE_ENV: "development", OBSERVABILITY_PROVIDER: "console", OBSERVABILITY_ENVIRONMENT: "staging", OBSERVABILITY_TRACES_SAMPLE_RATE: "1", BUILD_REVISION: "a".repeat(40) });
  const stop = startPerformance(performanceConfig, sentryExporter,
    { OTEL_EXPORTER_OTLP_ENDPOINT: collector, OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20configured-collector-secret,x-configured-extra=configured-extra-secret" });
  assert.ok(stop);
  const metrics = new RuntimeMetrics();
  const saved = await metrics.measure("room_save", async () => ({ saved: true }));
  assert.equal(saved.saved, true);
  await assert.rejects(metrics.measure("room_command", async () => { throw new Error("private provider response"); }), /private provider response/);
  metrics.observeDatabase("read", 12, false);
  await stop();
  assert.ok(batches.some(batch => batch.sink === "collector" && batch.path === "/v1/traces"));
  assert.ok(batches.some(batch => batch.sink === "collector" && batch.path === "/v1/metrics"));
  for (const batch of batches.filter(batch => batch.sink === "collector")) {
    assert.equal(batch.headers.authorization, "Bearer configured-collector-secret");
    assert.equal(batch.headers["x-configured-extra"], "configured-extra-secret");
    assert.doesNotMatch(batch.body, /sentry\.release/);
  }
  const sentryBatches = batches.filter(batch => batch.sink === "sentry");
  assert.ok(sentryBatches.length);
  for (const batch of sentryBatches) {
    assert.equal(batch.headers["x-sentry-auth"], "Sentry sentry_version=7, sentry_key=publickey");
    assert.equal(batch.headers["content-type"], "application/json");
    assert.equal(batch.headers.authorization, undefined);
    assert.doesNotMatch(JSON.stringify(batch), /collector-secret|extra-secret|trace-secret|x-configured-extra|x-process-extra|x-process-trace/);
    const data = JSON.parse(batch.body) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ attributes: Array<{ key: string; value: { stringValue?: string } }> }> }> }> };
    const spans = data.resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans));
    assert.ok(spans.length);
    for (const span of spans) assert.equal(span.attributes.find(attribute => attribute.key === "sentry.release")?.value.stringValue, performanceConfig.release);
  }
  const encoded = batches.map(batch => batch.body).join("\n");
  assert.match(encoded, /room_save/); assert.match(encoded, /turntune.operation.duration/);
  assert.doesNotMatch(encoded, /private|remote response content|process.command|host.name|db.statement|authorization/);
  // Shutdown exporters and continued use both leave the application result intact.
  assert.equal(await metrics.measure("room_save", async () => "saved"), "saved");
  // A broken transport that ignores cancellation cannot keep exporter shutdown pending.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const unavailable = createSentryTraceExporter({ url: `${sentry}/unavailable`, headers: {} }, () => new Promise(() => {}));
  let exportCode: number | undefined;
  unavailable.export([], result => { exportCode = result.code; });
  const stopped = unavailable.shutdown();
  await Promise.resolve();
  t.mock.timers.tick(2_000);
  await stopped;
  assert.equal(exportCode, 1);
  assert.equal(await metrics.measure("room_save", async () => "saved"), "saved");
});
