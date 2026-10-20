import type { TelemetryAdapter } from "../../../../shared/observability";

/** Core telemetry has already removed application data before reaching adapters. */
export function createConsoleAdapter(): TelemetryAdapter {
  return {
    captureError(error, context) {
      console.error(JSON.stringify({ level: "error", event: "application.error", ...context, error: { name: error.name, message: error.message, stack: error.stack } }));
    },
    log(level, event, context) {
      console[level](JSON.stringify({ level, event, ...context }));
    },
    async flush() {}
  };
}
