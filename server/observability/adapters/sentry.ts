import * as Sentry from "@sentry/node";
import { createMetricBatch } from "../../../shared/metric-batch.js";
import { attachSentryDebugIds, sanitizeSentryEnvelope, sanitizeSentryEvent, sanitizeSentryLog, sanitizeSentryMetric, type TelemetryAdapter } from "../../../shared/observability.js";
import type { observabilityConfig } from "../config.js";
import { createBoundedSentryTransport } from "./sentry-transport.js";
import { createSentryTraceExporter } from "./sentry-traces.js";

export function createSentryAdapter(config: ReturnType<typeof observabilityConfig>, transport?: Sentry.NodeOptions["transport"]) {
  const client = Sentry.init({
    dsn: config.dsn, environment: config.environment, release: config.release,
    defaultIntegrations: false, integrations: [Sentry.openTelemetryIntegration()],
    enableOpenTelemetrySetup: false, enableRuntimeChannelInjection: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 },
    sendClientReports: false, maxBreadcrumbs: 0, tracesSampleRate: 0, traceLifecycle: "static",
    beforeSend: event => {
      const globals = globalThis as typeof globalThis & { _sentryDebugIds?: Record<string, string>; _debugIds?: Record<string, string> };
      return sanitizeSentryEvent(attachSentryDebugIds(event, Sentry.defaultStackParser, [globals._sentryDebugIds, globals._debugIds]));
    }, beforeSendLog: log => sanitizeSentryLog(log),
    beforeSendMetric: metric => sanitizeSentryMetric(metric),
    beforeSendTransaction: () => null, transportOptions: { bufferSize: 30 },
    transport: options => {
      const destination = (transport ?? createBoundedSentryTransport)(options);
      return { ...destination, send(envelope) {
        const safe = sanitizeSentryEnvelope(envelope, config);
        return safe ? destination.send(safe) : Promise.resolve({ statusCode: 200 });
      } };
    }
  });
  const metrics = createMetricBatch((type, name, value, options) => Sentry.metrics[type](name, value, options));
  const adapter: TelemetryAdapter = {
    captureError(error, context) { Sentry.captureException(error, { tags: { operation: context.operation }, extra: { ...context } }); },
    log(level, event, context) { Sentry.logger[level](event, { ...context }); },
    metric(type, name, value, options) { metrics.record(type, name, value, options); },
    async flush(timeoutMs) { metrics.flush(); await client?.flush(timeoutMs); }
  };
  const endpoint = config.dsn ? Sentry.getOtlpTracesEndpoint(config.dsn) : undefined;
  return { adapter, traceExporter: endpoint ? createSentryTraceExporter(endpoint) : undefined };
}
