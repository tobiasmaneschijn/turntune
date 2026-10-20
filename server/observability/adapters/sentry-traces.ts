import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";

type ExportCallback = Parameters<SpanExporter["export"]>[1];
interface SentryTraceEndpoint { url: string; headers: Record<string, string> }

/** Sentry transport stays separate from collector exporters, which inherit OTEL_* headers. */
export function createSentryTraceExporter(endpoint: SentryTraceEndpoint, fetchImpl: typeof fetch = fetch): SpanExporter {
  const auth = Object.entries(endpoint.headers).find(([name]) => name.toLowerCase() === "x-sentry-auth")?.[1];
  const headers = { "Content-Type": "application/json", ...(auth ? { "X-Sentry-Auth": auth } : {}) };
  const pending = new Set<Promise<void>>();
  let closed = false;
  function report(callback: ExportCallback, success: boolean) {
    try { callback(success ? { code: 0 } : { code: 1, error: new Error("Sentry trace export failed.") }); }
    catch { /* Export callbacks cannot interrupt application work. */ }
  }
  return {
    export(spans: ReadableSpan[], callback: ExportCallback) {
      if (closed || pending.size >= 2) { report(callback, false); return; }
      const work = Promise.resolve().then(async () => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Relay prefixes OTLP resource attributes with "resource.". Its
          // searchable release therefore needs the canonical span attribute.
          // Copy only for this destination; other exporters keep neutral spans.
          const sentrySpans = spans.map(span => {
            const release = span.resource.attributes["service.version"];
            if (typeof release !== "string" || !/^(?:unknown|[a-f0-9]{40})$/i.test(release)) return span;
            return Object.create(span, { attributes: { value: { ...span.attributes, "sentry.release": release } } }) as ReadableSpan;
          });
          const serialized = JsonTraceSerializer.serializeRequest(sentrySpans);
          if (!serialized || serialized.byteLength > 512 * 1024) { report(callback, false); return; }
          const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error("Sentry trace export timed out.")); }, 2_000);
          });
          const response = await Promise.race([fetchImpl(endpoint.url, {
            method: "POST", headers, body: new Uint8Array(serialized).buffer,
            signal: controller.signal, redirect: "error"
          }), deadline]);
          // Responses can contain arbitrary remote content. Never read or log it.
          void response.body?.cancel().catch(() => undefined);
          report(callback, response.ok);
        } catch { report(callback, false); }
        finally { clearTimeout(timer); controller.abort(); }
      }).finally(() => { pending.delete(work); });
      pending.add(work);
    },
    async forceFlush() { await Promise.allSettled([...pending]); },
    async shutdown() { closed = true; await Promise.allSettled([...pending]); }
  };
}
