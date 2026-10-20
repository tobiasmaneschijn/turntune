import * as Sentry from "@sentry/react";
import { attachSentryDebugIds, sanitizeSentryEnvelope, sanitizeSentryEvent, sanitizeSentryLog, type TelemetryAdapter } from "../../../../shared/observability";
import type { BrowserObservabilityConfig } from "../config";

/** Sanitizing the stack removes its origin before Sentry can match injected
 * Debug IDs. Match only the sanitized code filename, keeping raw URLs local. */
function attachDebugIds(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const globals = globalThis as typeof globalThis & { _sentryDebugIds?: Record<string, string>; _debugIds?: Record<string, string> };
  return attachSentryDebugIds(event, Sentry.defaultStackParser, [globals._sentryDebugIds, globals._debugIds]);
}

export function createSentryAdapter(config: BrowserObservabilityConfig): TelemetryAdapter {
  const client = Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    defaultIntegrations: false,
    integrations: [],
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0
    },
    sendClientReports: false,
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    traceLifecycle: "static",
    tracePropagationTargets: [],
    beforeSend: event => sanitizeSentryEvent(attachDebugIds(event)),
    beforeSendTransaction: () => null,
    beforeSendLog: log => sanitizeSentryLog(log),
    transportOptions: {
      bufferSize: 20,
      fetchOptions: { credentials: "omit", referrerPolicy: "no-referrer" }
    },
    transport: options => {
      const destination = Sentry.makeFetchTransport(options);
      return { ...destination, send(envelope) {
        const safe = sanitizeSentryEnvelope(envelope, config);
        return safe ? destination.send(safe) : Promise.resolve({ statusCode: 200 });
      } };
    }
  });
  return {
    captureError(error, context) {
      Sentry.captureException(error, { tags: { operation: context.operation }, extra: { ...context } });
    },
    log(level, event, context) {
      Sentry.logger[level](event, { ...context });
    },
    async flush(timeoutMs) { await client?.flush(timeoutMs); }
  };
}
