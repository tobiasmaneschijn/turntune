import assert from "node:assert/strict";
import test from "node:test";
import { telemetry, type MetricOptions, type MetricType, type TelemetryAdapter } from "../../../shared/observability.js";
import { parseBrowserObservabilityConfig } from "../../../src/lib/observability/config.js";
import { initializeBrowserObservability } from "../../../src/lib/observability/runtime.js";

const configuration = {
  observability: {
    provider: "sentry", dsn: "https://publickey@monitoring.example/42",
    environment: "staging", release: "abcdef123456", tracesSampleRate: 0.1
  }
};

test("Report an early screen crash once after monitoring loads, without private application data", async () => {
  const target = new EventTarget();
  let resolveConfiguration!: (value: unknown) => void;
  const loaded = new Promise<unknown>(resolve => { resolveConfiguration = resolve; });
  const captured: Array<{ error: Error; operation: string }> = [];
  const metrics: Array<{ type: MetricType; name: string; value: number; options: MetricOptions }> = [];
  let loadDurationMs = 0;
  const serializedErrors = () => JSON.stringify(captured.map(({ error, operation }) => ({ operation, message: error.message, stack: error.stack })));
  const destination: TelemetryAdapter = {
    captureError(error, context) { captured.push({ error, operation: context.operation }); },
    metric(type, name, value, options) { metrics.push({ type, name, value, options }); },
    log() {}, async flush() {}
  };
  const monitoring = initializeBrowserObservability({ target, loadConfiguration: () => loaded,
    loadSentryAdapter: async () => destination,
    pageLoad: { completed: false, durationMs: () => loadDurationMs }
  });
  try {
    const error = new Error("private-chat-message session=secret-token");
    telemetry.captureError(error, { operation: "browser.render.app" });
    target.dispatchEvent(Object.assign(new Event("error"), { error }));
    telemetry.metrics.gauge("browser.active", 1);
    target.dispatchEvent(new Event("load"));
    loadDurationMs = 240;
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(captured.length, 0);
    assert.equal(metrics.length, 0);
    resolveConfiguration(configuration);
    await monitoring.ready;
    assert.equal(captured.length, 1);
    assert.equal(captured[0].operation, "browser.render.app");
    assert.doesNotMatch(serializedErrors(), /private-chat-message|secret-token/);
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("private rejection") }));
    assert.equal(captured.length, 2);
    assert.equal(captured[1].operation, "browser.unhandled.rejection");
    assert.doesNotMatch(serializedErrors(), /private rejection/);
    assert.deepEqual(metrics.map(({ type, name, value }) => ({ type, name, value })), [
      { type: "count", name: "browser.app.started", value: 1 },
      { type: "gauge", name: "browser.active", value: 1 },
      { type: "distribution", name: "browser.page.load", value: 240 }
    ]);
    assert.equal(metrics[2].options.unit, "millisecond");
    target.dispatchEvent(new Event("load"));
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(metrics.length, 3);
  } finally { monitoring.dispose(); }
});

test("Continue application startup when monitoring is unavailable and keep test sessions offline", async () => {
  const target = new EventTarget();
  let loads = 0;
  let sentryLoads = 0;
  let navigationReads = 0;
  const monitoring = initializeBrowserObservability({
    target,
    loadConfiguration: async () => { loads++; throw new Error("offline"); },
    loadSentryAdapter: async () => { sentryLoads++; throw new Error("SDK must not load"); }
  });
  telemetry.captureError(new Error("startup error"), { operation: "browser.render.app" });
  telemetry.metrics.count("browser.offline");
  await assert.doesNotReject(monitoring.ready);
  assert.equal(loads, 1);
  assert.equal(sentryLoads, 0);
  monitoring.dispose();
  const isolated = initializeBrowserObservability({
    target, testMode: true,
    pageLoad: { completed: true, durationMs: () => { navigationReads++; return 120; } },
    loadConfiguration: async () => { loads++; return configuration; },
    loadSentryAdapter: async () => { sentryLoads++; throw new Error("SDK must not load"); }
  });
  await isolated.ready;
  isolated.dispose();
  assert.equal(loads, 1);
  assert.equal(sentryLoads, 0);
  assert.equal(navigationReads, 0);
});

test("Leaving a loading page discards queued metrics and cancels its pending navigation report", async () => {
  const target = new EventTarget();
  let resolveConfiguration!: (value: unknown) => void;
  const loaded = new Promise<unknown>(resolve => { resolveConfiguration = resolve; });
  let reports = 0, navigationReads = 0;
  const destination: TelemetryAdapter = {
    captureError() {}, log() {}, metric() { reports++; }, async flush() {}
  };
  const monitoring = initializeBrowserObservability({ target, loadConfiguration: () => loaded,
    loadSentryAdapter: async () => destination,
    pageLoad: { completed: true, durationMs: () => { navigationReads++; return 120; } }
  });
  telemetry.metrics.count("browser.pending");
  monitoring.dispose();
  resolveConfiguration(configuration);
  await monitoring.ready;
  target.dispatchEvent(new Event("load"));
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(reports, 0);
  assert.equal(navigationReads, 0);
});

test("Enable remote reporting only for a valid public HTTPS monitoring configuration", () => {
  assert.deepEqual(parseBrowserObservabilityConfig(configuration), configuration.observability);
  for (const dsn of [
    "http://key@monitoring.example/42", "https://key:private@monitoring.example/42",
    "https://monitoring.example/42", "https://key@monitoring.example/42?token=secret",
    "https://key@monitoring.example/42#secret", "https://key@monitoring.example/missing-project", "https://invalid-key@monitoring.example/42"
  ]) {
    assert.equal(parseBrowserObservabilityConfig({ observability: { ...configuration.observability, dsn } }), null);
  }
  assert.equal(parseBrowserObservabilityConfig({ observability: { ...configuration.observability, tracesSampleRate: 2 } }), null);
  assert.equal(parseBrowserObservabilityConfig({ observability: { ...configuration.observability, release: "private release text" } }), null);
  assert.equal(parseBrowserObservabilityConfig({ supabase: null }), null);
});
