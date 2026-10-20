import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import { telemetry as core, configureTelemetry, type LogLevel, type ObservabilityContext, type TelemetryAdapter } from "../../shared/observability.js";
import { observabilityConfig } from "./config.js";

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const metadata = observabilityConfig();
export function consoleAdapter(): TelemetryAdapter {
  const emit = (level: LogLevel, event: string, context: ObservabilityContext, error?: Error) => {
    const row = JSON.stringify({ type: "application", time: new Date().toISOString(), level, event,
      environment: metadata.environment, release: metadata.release, ...context,
      ...(error ? { error: { name: error.name, message: error.message, stack: error.stack } } : {}) });
    if (level === "error") console.error(row); else console.log(row);
  };
  return { captureError: (error, context) => emit("error", "operation.failed", context, error), log: emit, async flush() {} };
}
if (metadata.provider !== "none") configureTelemetry(consoleAdapter());
export const telemetry = {
  captureError(error: unknown, context: ObservabilityContext) { core.captureError(error, { ...requestContext.getStore(), ...context }); },
  log(level: LogLevel, event: string, context: ObservabilityContext = { operation: event }) { core.log(level, event, { ...requestContext.getStore(), ...context }); }
};

/** Preserve the existing server-created request ID; never accept one from a client header. */
export const requestObservability: RequestHandler = (_request, response, next) => {
  requestContext.run({ requestId: response.locals.requestId }, next);
};
let stopPerformance: (() => Promise<void>) | undefined;
export function registerPerformanceShutdown(shutdown: () => Promise<void>) { stopPerformance = shutdown; }
let flushing: Promise<void> | undefined;
export function flushTelemetry(timeoutMs = 2_000): Promise<void> {
  if (!flushing) flushing = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.allSettled([core.flush(timeoutMs), Promise.resolve().then(() => stopPerformance?.())]),
        new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(1, Math.min(5_000, timeoutMs))); })]);
    } finally { clearTimeout(timer); }
  })();
  return flushing;
}
