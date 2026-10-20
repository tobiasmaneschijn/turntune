import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, TraceIdRatioBasedSampler, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { observabilityConfig } from "./config.js";

function collectorEndpoint(value: string | undefined) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return;
    return url.href.replace(/\/$/, "");
  } catch { return; }
}
export function startPerformance(config: ReturnType<typeof observabilityConfig>, sentryExporter?: SpanExporter, env: NodeJS.ProcessEnv = process.env) {
  const endpoint = collectorEndpoint(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (config.provider === "none" || (!sentryExporter && !endpoint)) return;
  const headers: Record<string, string> = {};
  for (const entry of (env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",")) {
    const separator = entry.indexOf("=");
    if (separator > 0) {
      const name = entry.slice(0, separator).trim();
      if (/^[a-zA-Z0-9_-]+$/.test(name)) headers[name] = decodeURIComponent(entry.slice(separator + 1).trim());
    }
  }
  const exporters = [
    ...(sentryExporter ? [sentryExporter] : []),
    ...(endpoint ? [new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers, timeoutMillis: 2_000, concurrencyLimit: 2 })] : [])
  ];
  const sdk = new NodeSDK({
    autoDetectResources: false, resourceDetectors: [], instrumentations: [], textMapPropagator: null,
    logRecordProcessors: [],
    resource: resourceFromAttributes({ "service.name": "turntune", "service.version": config.release, "deployment.environment.name": config.environment }),
    sampler: new TraceIdRatioBasedSampler(config.tracesSampleRate),
    spanProcessors: exporters.map(exporter => new BatchSpanProcessor(exporter, { maxQueueSize: 128, maxExportBatchSize: 32, scheduledDelayMillis: 5_000, exportTimeoutMillis: 2_500 })),
    metricReaders: endpoint ? [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers, timeoutMillis: 2_000 }), exportIntervalMillis: 30_000, exportTimeoutMillis: 2_500 })] : []
  });
  sdk.start();
  return () => sdk.shutdown();
}
