import { configureTelemetry, telemetry, type TelemetryAdapter } from "../../../shared/observability";
import { createConsoleAdapter } from "./adapters/console";
import { parseBrowserObservabilityConfig, type BrowserObservabilityConfig } from "./config";

const disabledAdapter: TelemetryAdapter = { captureError() {}, log() {}, async flush() {} };
const STARTUP_BUFFER_LIMIT = 20;

interface BrowserObservabilityOptions {
  target: EventTarget;
  loadConfiguration(): Promise<unknown>;
  loadSentryAdapter?(config: BrowserObservabilityConfig): Promise<TelemetryAdapter>;
  pageLoad?: { completed: boolean; durationMs(): number | undefined };
  testMode?: boolean;
}

/** Install reporting synchronously; configuration and SDK loading never delay rendering. */
export function initializeBrowserObservability(options: BrowserObservabilityOptions): { ready: Promise<void>; dispose(): void } {
  if (options.testMode) return { ready: Promise.resolve(), dispose() {} };
  let disposed = false;
  let pageLoadTimer: ReturnType<typeof setTimeout> | undefined;
  let pageLoadRecorded = false;
  let adapter: TelemetryAdapter = disabledAdapter;
  const pending: Array<(destination: TelemetryAdapter) => void> = [];
  const buffer = (send: (destination: TelemetryAdapter) => void) => {
    if (pending.length < STARTUP_BUFFER_LIMIT) pending.push(send);
  };
  let restore = configureTelemetry({
    captureError(error, context) { buffer(destination => destination.captureError(error, context)); },
    log(level, event, context) { buffer(destination => destination.log(level, event, context)); },
    metric(type, name, value, options) { buffer(destination => destination.metric?.(type, name, value, options)); },
    async flush() {}
  });

  const onError = (event: Event) => {
    const error = (event as ErrorEvent).error;
    // Resource failures have no exception and are handled by their owning feature.
    if (error instanceof Error) telemetry.captureError(error, { operation: "browser.unhandled.error" });
  };
  const onRejection = (event: Event) => telemetry.captureError((event as PromiseRejectionEvent).reason, { operation: "browser.unhandled.rejection" });
  const onPageHide = () => { void telemetry.flush(1_500); };
  const onLoad = () => {
    if (pageLoadRecorded || pageLoadTimer !== undefined) return;
    // loadEventEnd is populated only after the browser finishes load handlers.
    pageLoadTimer = setTimeout(() => {
      pageLoadTimer = undefined;
      if (disposed || pageLoadRecorded) return;
      try {
        const durationMs = options.pageLoad?.durationMs();
        if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) return;
        pageLoadRecorded = true;
        telemetry.metrics.distribution("browser.page.load", durationMs, { unit: "millisecond" });
      } catch { /* Navigation timing can be unavailable in embedded browsers. */ }
    }, 0);
  };
  options.target.addEventListener("error", onError);
  options.target.addEventListener("unhandledrejection", onRejection);
  options.target.addEventListener("pagehide", onPageHide);
  if (options.pageLoad) {
    options.target.addEventListener("load", onLoad);
    if (options.pageLoad.completed) onLoad();
  }
  telemetry.metrics.count("browser.app.started");

  const ready = Promise.resolve().then(options.loadConfiguration).then(async value => {
    const config = parseBrowserObservabilityConfig(value);
    if (!config || disposed) return disabledAdapter;
    if (config.provider === "console") return createConsoleAdapter();
    if (config.provider === "sentry") return options.loadSentryAdapter
      ? options.loadSentryAdapter(config)
      : import("./adapters/sentry").then(module => module.createSentryAdapter(config));
    return disabledAdapter;
  }).catch(() => disabledAdapter).then(destination => {
    if (disposed) { pending.length = 0; return; }
    adapter = destination;
    restore();
    restore = configureTelemetry(adapter);
    // Buffered values have already passed the shared privacy filter. Dispatching
    // directly also preserves the original core's duplicate-error suppression.
    for (const send of pending.splice(0)) {
      try { send(adapter); } catch { /* Monitoring cannot interrupt application startup. */ }
    }
  });

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      options.target.removeEventListener("error", onError);
      options.target.removeEventListener("unhandledrejection", onRejection);
      options.target.removeEventListener("pagehide", onPageHide);
      options.target.removeEventListener("load", onLoad);
      clearTimeout(pageLoadTimer);
      pending.length = 0;
      restore();
      void Promise.resolve().then(() => adapter.flush(1_500)).catch(() => undefined);
    }
  };
}
