import { configureTelemetry, type TelemetryAdapter } from "../../shared/observability.js";
import { observabilityConfig } from "./config.js";
import { consoleAdapter, telemetry, flushTelemetry, registerPerformanceShutdown } from "./index.js";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

export async function initializeObservability() {
  const config = observabilityConfig();
  if (config.provider === "none") return;
  const consoleSink = consoleAdapter();
  let traceExporter: SpanExporter | undefined;
  if (config.provider === "sentry") {
    if (config.dsn) {
      try {
        const { createSentryAdapter } = await import("./adapters/sentry.js");
        const sentry = createSentryAdapter(config);
        traceExporter = sentry.traceExporter;
        const composite: TelemetryAdapter = {
          captureError(error, context) { consoleSink.captureError(error, context); sentry.adapter.captureError(error, context); },
          log(level, event, context) { consoleSink.log(level, event, context); sentry.adapter.log(level, event, context); },
          metric(type, name, value, options) { sentry.adapter.metric?.(type, name, value, options); },
          async flush(timeoutMs) { await sentry.adapter.flush(timeoutMs); }
        };
        configureTelemetry(composite);
      } catch (error) { telemetry.captureError(error, { operation: "observability.initialize" }); }
    } else telemetry.log("warn", "observability.missing_dsn");
  }
  try {
    if (traceExporter || process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      const { startPerformance } = await import("./otel.js");
      const stop = startPerformance(config, traceExporter);
      if (stop) registerPerformanceShutdown(stop);
    }
  } catch (error) { telemetry.captureError(error, { operation: "observability.performance.initialize" }); }
}

/** Fatal errors still terminate the process. Bounded flushing cannot keep it alive. */
export function installFatalErrorReporting() {
  const fatal = (operation: string) => (error: unknown) => {
    telemetry.captureError(error, { operation });
    const deadline = setTimeout(() => process.exit(1), 2_500);
    deadline.unref();
    void flushTelemetry(2_000).finally(() => process.exit(1));
  };
  process.once("uncaughtException", fatal("server.uncaught_exception"));
  process.once("unhandledRejection", fatal("server.unhandled_rejection"));
}
