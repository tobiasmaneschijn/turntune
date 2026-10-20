import { metrics, trace, SpanStatusCode } from "@opentelemetry/api";
import type { RequestHandler } from "express";
import { safeIdentifier } from "../../shared/observability.js";

const tracer = trace.getTracer("turntune");
function createInstruments() {
  const provider = metrics.getMeterProvider(), meter = provider.getMeter("turntune");
  return { provider,
    durations: meter.createHistogram("turntune.operation.duration", { unit: "ms", description: "Application operation duration" }),
    failures: meter.createCounter("turntune.operation.failures", { description: "Failed application operations" }) };
}
let instruments: ReturnType<typeof createInstruments> | undefined;
export const traceHttpRequest: RequestHandler = (request, response, next) => {
  if (request.path === "/api/health" || request.path === "/api/ready") return next();
  tracer.startActiveSpan("http.request", span => {
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(request.method) ? request.method : "OTHER";
      // Express's declared route template is code-owned; the request URL is never recorded.
      const route = typeof request.route?.path === "string" && /^\/[a-zA-Z0-9_/:.*{}-]{0,120}$/.test(request.route.path) ? request.route.path : undefined;
      span.setAttribute("http.request.method", method);
      span.setAttribute("http.response.status_code", response.statusCode);
      if (route) { span.setAttribute("http.route", route); span.updateName(`${method} ${route}`); }
      span.setStatus({ code: response.statusCode >= 500 || !response.writableFinished ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      span.end();
    };
    response.once("finish", finish);
    response.once("close", finish);
    next();
  });
};
export function observeOperation(operation: string, durationMs: number, failed: boolean, kind: "workflow" | "database" = "workflow", recordSpan = true) {
  try {
    const attributes = { operation: safeIdentifier(operation), kind };
    if (!instruments || instruments.provider !== metrics.getMeterProvider()) instruments = createInstruments();
    instruments.durations.record(Math.max(0, durationMs), attributes);
    if (failed) instruments.failures.add(1, attributes);
    if (recordSpan) {
      const ended = Date.now(), elapsed = Math.max(0, Math.min(1e9, durationMs));
      const span = tracer.startSpan(safeIdentifier(operation), { startTime: ended - elapsed, attributes: { "operation.kind": kind } });
      span.setStatus({ code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      span.end(ended);
    }
  } catch { /* Diagnostics cannot break application work. */ }
}
/** No payloads, URLs, SQL statements, error messages or remote baggage enter spans. */
export async function measureOperation<T>(operation: string, run: () => Promise<T>, isFailure?: (result: T) => boolean): Promise<T> {
  return tracer.startActiveSpan(safeIdentifier(operation), async span => {
    try {
      const result = await run();
      span.setStatus({ code: isFailure?.(result) ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally { span.end(); }
  });
}
