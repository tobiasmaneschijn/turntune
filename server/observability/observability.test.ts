import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createTelemetry, sanitizeSentryEnvelope, sanitizeSentryEvent, type TelemetryAdapter } from "../../shared/observability.js";
import { configureTelemetry } from "../../shared/observability.js";
import { telemetry } from "./index.js";
import { securityRequestContext } from "../security/security-events.js";
import { browserObservabilityConfig } from "./config.js";

test("a failed operation reports once with code locations and safe context, and reporting cannot interrupt recovery", async () => {
  const reports: Array<{ error: Error; context: unknown }> = [];
  const adapter: TelemetryAdapter = { captureError(error, context) { reports.push({ error, context }); }, log() {}, async flush() {} };
  const reporter = createTelemetry(adapter);
  const failure = new TypeError("private chat, bearer credentials, https://storage.invalid/file?token=private");
  failure.stack = "TypeError: private\n    at save (C:/Users/private-user/project/server/persistence/store.ts:12:3)\n    at fetch (https://provider.invalid/api/private?token=secret:11:2)";
  const context = { operation: "room.save", requestId: "c1c14747-7193-40f0-a3a3-9e111b8ec264", token: "private", status: 500 };
  reporter.captureError(failure, context);
  reporter.captureError(failure, context);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].error.name, "TypeError");
  assert.match(reports[0].error.stack!, /server\/persistence\/store.ts:12:3/);
  assert.doesNotMatch(JSON.stringify(reports, (_key, value) => value instanceof Error ? { message: value.message, stack: value.stack } : value), /private|bearer|token|provider\.invalid/);
  reporter.configure({ captureError() { throw new Error("sink offline"); }, log() { throw new Error("sink offline"); }, flush() { return Promise.reject(new Error("offline")); } });
  assert.doesNotThrow(() => reporter.captureError(new Error("retry failed"), context));
  assert.doesNotThrow(() => reporter.log("warn", "retry.pending", context));
  await reporter.flush(20);
  reporter.configure(adapter);
  reporter.captureError(new Error("recovery failure"), context);
  assert.equal(reports.length, 2);
  reporter.configure({ ...adapter, flush: () => new Promise(() => {}) });
  await reporter.flush(10);
});

test("concurrent requests keep their own server-created correlation IDs and public configuration exposes only the browser DSN", async t => {
  const captured: string[] = [];
  const restore = configureTelemetry({ captureError() {}, log(_level, _event, context) { captured.push(context.requestId!); }, async flush() {} });
  t.after(restore);
  const app = express();
  app.use(securityRequestContext);
  let waiting = 0, release!: () => void;
  const both = new Promise<void>(resolve => { release = resolve; });
  app.get("/work", async (_request, response) => {
    if (++waiting === 2) release();
    await both;
    telemetry.log("info", "work.completed");
    response.json({ requestId: response.locals.requestId });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const responses = await Promise.all([1, 2].map(() => fetch(`http://127.0.0.1:${address.port}/work`, { headers: { "X-Request-ID": "attacker" } }).then(response => response.json())));
  assert.equal(new Set(captured).size, 2);
  assert.deepEqual(new Set(captured), new Set(responses.map(response => response.requestId)));
  assert.ok(captured.every(id => id !== "attacker"));
  const config = browserObservabilityConfig({ NODE_ENV: "production", OBSERVABILITY_PROVIDER: "sentry", OBSERVABILITY_ENVIRONMENT: "staging",
    SENTRY_DSN: "https://serverkey@monitoring.invalid/1", SENTRY_BROWSER_DSN: "https://browserkey@monitoring.invalid/2", SENTRY_AUTH_TOKEN: "private-upload-token", OTEL_EXPORTER_OTLP_HEADERS: "authorization=private" });
  assert.equal(config.dsn, "https://browserkey@monitoring.invalid/2");
  assert.equal(config.environment, "staging");
  assert.doesNotMatch(JSON.stringify(config), /serverkey|private|authorization/);
  assert.equal(browserObservabilityConfig({ NODE_ENV: "test", OBSERVABILITY_PROVIDER: "sentry", SENTRY_BROWSER_DSN: config.dsn }).provider, "none");
});

test("SDK enrichment cannot export private request, user, breadcrumb or source-context data", () => {
  const event = sanitizeSentryEvent({ event_id: "test", exception: { values: [{ type: "Error", value: "private",
    stacktrace: { frames: [{ filename: "https://app.invalid/assets/main.js?token=private", function: "save", lineno: 12, vars: { token: "private" }, pre_context: ["private"] }] } }] },
    user: { email: "private" }, request: { headers: { Authorization: "private" }, data: "private" }, breadcrumbs: [{ message: "private" }],
    tags: { operation: "room.save", private: "private" }, extra: { operation: "room.save", body: "private" },
    contexts: { runtime: { private: "private" }, trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), data: { private: "private" } } } });
  assert.ok(event);
  assert.doesNotMatch(JSON.stringify(event), /private|token|Authorization|user|request|vars|pre_context/);
  assert.match(JSON.stringify(event), /assets\/main.js/);
  const envelope = sanitizeSentryEnvelope<[unknown, Array<[unknown, Record<string, unknown>]>]>([{}, [[{ type: "event" }, { ...event, user: { email: "private", ip_address: "198.51.100.42", geo: { city: "private" } } }]]], { environment: "test", release: "test" });
  assert.ok(envelope);
  assert.deepEqual(envelope[1][0][1].user, { ip_address: "0.0.0.0", geo: {} });
  assert.doesNotMatch(JSON.stringify(envelope), /private|198\.51\.100\.42/);
  const noSafeFrames = sanitizeSentryEvent({ exception: { values: [{ stacktrace: { frames: [{ filename: "/tmp/private-work/check.js" }] } }] } });
  assert.ok(noSafeFrames);
  assert.equal(Object.hasOwn(noSafeFrames.exception.values[0], "stacktrace"), false);
  assert.equal(sanitizeSentryEvent({ type: "transaction", request: "private" }), null);
});
