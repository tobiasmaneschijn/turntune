/** The application owns this contract. Provider SDKs belong in adapters only. */
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface ObservabilityContext {
  operation: string;
  requestId?: string;
  provider?: string;
  status?: number;
  durationMs?: number;
  count?: number;
}
export interface TelemetryAdapter {
  captureError(error: Error, context: ObservabilityContext): void;
  log(level: LogLevel, event: string, context: ObservabilityContext): void;
  flush(timeoutMs: number): Promise<void>;
}

const identifier = /^[a-z][a-z0-9_.-]{0,79}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providers = new Set(["youtube", "spotify", "soundcloud", "mixcloud", "apple", "appleMusic", "apple-music", "apple_music", "giphy"]);
export function safeIdentifier(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && identifier.test(value) ? value : fallback;
}
export function sanitizeContext(value: ObservabilityContext): ObservabilityContext {
  const result: ObservabilityContext = { operation: safeIdentifier(value.operation) };
  if (typeof value.requestId === "string" && uuid.test(value.requestId)) result.requestId = value.requestId;
  if (typeof value.provider === "string" && providers.has(value.provider)) result.provider = value.provider;
  for (const key of ["status", "durationMs", "count"] as const) {
    const item = value[key];
    if (typeof item === "number" && Number.isFinite(item)) result[key] = Math.max(0, Math.min(1e9, item));
  }
  return result;
}

/** Keep code locations, never arbitrary URL paths, queries, local usernames or source context. */
export function sanitizeFilename(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const path = value.replaceAll("\\", "/").split(/[?#]/, 1)[0];
  const match = path.match(/(?:^|\/)((?:src|server|shared|node_modules|assets|dist-server|dist)\/[a-zA-Z0-9_./@+-]+\.(?:[cm]?js|tsx?))$/);
  if (!match || match[1].includes("..")) return;
  return match[1].slice(0, 300);
}
function safeFunction(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z_$][a-zA-Z0-9_.$<> ]{0,119}$/.test(value) ? value : undefined;
}
/** Error messages and causes often contain response bodies, user input or signed URLs.
 * Send a stable operation message and code frames instead of trying to redact arbitrary text. */
export function sanitizeError(error: unknown, operation: string): Error {
  const result = new Error(`Unexpected failure in ${safeIdentifier(operation)}`);
  result.name = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : error instanceof SyntaxError ? "SyntaxError" : "Error";
  const frames: string[] = [];
  if (error instanceof Error && typeof error.stack === "string") {
    for (const line of error.stack.split("\n").slice(1, 41)) {
      const location = line.match(/(?:at\s+(?:(.*?)\s+\()?|^(.*?)@)(.*?):(\d+):(\d+)\)?$/);
      if (!location) continue;
      const filename = sanitizeFilename(location[3]);
      if (!filename) continue;
      const name = safeFunction(location[1] ?? location[2]);
      frames.push(`    at ${name ? `${name} (` : ""}${filename}:${location[4]}:${location[5]}${name ? ")" : ""}`);
    }
  }
  result.stack = `${result.name}: ${result.message}${frames.length ? `\n${frames.join("\n")}` : ""}`;
  return result;
}

export function createTelemetry(initialAdapter?: TelemetryAdapter) {
  let adapter = initialAdapter;
  const seen = new WeakSet<object>();
  const windows = new Map<string, { start: number; count: number }>();
  let total = { start: 0, count: 0 };
  function allowed(key: string) {
    const now = Date.now();
    if (now - total.start >= 60_000) { total = { start: now, count: 0 }; windows.clear(); }
    if (total.count >= 600) return false;
    let window = windows.get(key);
    if (!window) {
      if (windows.size >= 128) return false;
      window = { start: now, count: 0 }; windows.set(key, window);
    }
    if (window.count >= 60) return false;
    window.count++; total.count++;
    return true;
  }
  const api = {
    captureError(error: unknown, context: ObservabilityContext) {
      try {
        if (!adapter) return;
        if (error && typeof error === "object" && seen.has(error)) return;
        const safe = sanitizeContext(context);
        if (!allowed(`error:${safe.operation}`)) return;
        if (error && typeof error === "object") seen.add(error);
        adapter.captureError(sanitizeError(error, safe.operation), safe);
      } catch { /* Observability must never change the result of an application action. */ }
    },
    log(level: LogLevel, event: string, context: ObservabilityContext = { operation: event }) {
      try {
        if (!adapter || !["debug", "info", "warn", "error"].includes(level)) return;
        const safe = sanitizeContext(context), name = safeIdentifier(event);
        if (allowed(`log:${name}`)) adapter.log(level, name, safe);
      } catch { /* A broken sink must not interrupt the application. */ }
    }
  };
  return {
    ...api,
    configure(next?: TelemetryAdapter) {
      const previous = adapter; adapter = next;
      return () => { if (adapter === next) adapter = previous; };
    },
    async flush(timeoutMs = 2_000) {
      const limit = Math.max(1, Math.min(5_000, Number.isFinite(timeoutMs) ? timeoutMs : 2_000));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.resolve().then(() => adapter?.flush(limit)), new Promise<void>(resolve => { timer = setTimeout(resolve, limit); })]);
      } catch { /* Best effort within the caller's shutdown deadline. */ }
      finally { clearTimeout(timer); }
    }
  };
}

export const telemetry = createTelemetry();
export const configureTelemetry = telemetry.configure;

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
function safeTrace(value: unknown) {
  const trace = record(value);
  return typeof trace.trace_id === "string" && /^[a-f0-9]{32}$/i.test(trace.trace_id) && typeof trace.span_id === "string" && /^[a-f0-9]{16}$/i.test(trace.span_id)
    ? { trace_id: trace.trace_id, span_id: trace.span_id } : undefined;
}
function safeFrame(value: unknown) {
  const frame = record(value), filename = sanitizeFilename(frame.filename ?? frame.abs_path);
  if (!filename) return;
  return { filename, function: safeFunction(frame.function), lineno: typeof frame.lineno === "number" ? frame.lineno : undefined,
    colno: typeof frame.colno === "number" ? frame.colno : undefined, in_app: frame.in_app === true };
}
/** Debug-ID lookup uses original bundle locations. Normalize before exporting. */
export function attachSentryDebugIds<T>(input: T, parseStack: (stack: string) => Array<{ filename?: string }>, maps: Array<Record<string, string> | undefined>): T {
  const event = record(input), values = record(event.exception).values;
  if (!Array.isArray(values)) return input;
  const filenames = new Set(values.flatMap(item => {
    const frames = record(record(item).stacktrace).frames;
    return Array.isArray(frames) ? frames.map(frame => sanitizeFilename(record(frame).filename)).filter(Boolean) : [];
  }));
  const existing = record(event.debug_meta).images;
  const images = Array.isArray(existing) ? [...existing] : [];
  for (const map of maps) for (const [stack, id] of Object.entries(map ?? {}).slice(0, 500)) {
    if (!uuid.test(id)) continue;
    const code_file = [...parseStack(stack)].reverse().map(frame => sanitizeFilename(frame.filename)).find(Boolean);
    if (code_file && filenames.has(code_file) && !images.some(item => record(item).code_file === code_file)) images.push({ type: "sourcemap", code_file, debug_id: id });
  }
  return images.length ? { ...event, debug_meta: { images } } as T : input;
}
/** Final allowlist covers SDK enrichment as well as our explicit capture calls. */
export function sanitizeSentryEvent<T>(input: T): T | null {
  try {
    const event = record(input);
    if (event.type) return null; // Only explicitly captured errors use this pipeline.
    const tags = record(event.tags), extra = record(event.extra);
    const context = sanitizeContext({ ...extra, operation: tags.operation ?? extra.operation } as ObservabilityContext);
    const values = record(event.exception).values;
    if (!Array.isArray(values)) return null;
    const result: RecordValue = {
      event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
      environment: typeof event.environment === "string" ? safeIdentifier(event.environment) : undefined,
      release: typeof event.release === "string" && /^[a-zA-Z0-9_.@+-]{1,100}$/.test(event.release) ? event.release : undefined,
      level: "error", tags: { operation: context.operation, provider: context.provider }, extra: context,
      exception: { values: values.slice(0, 1).map(item => {
        const value = record(item), frames = record(value.stacktrace).frames;
        const safeFrames = Array.isArray(frames) ? frames.slice(-40).map(safeFrame).filter(Boolean) : [];
        return { type: ["Error", "TypeError", "SyntaxError", "RangeError"].includes(String(value.type)) ? value.type : "Error",
          value: `Unexpected failure in ${context.operation}`,
          ...(safeFrames.length ? { stacktrace: { frames: safeFrames } } : {}),
          mechanism: { type: "generic", handled: true } };
      }) }
    };
    const trace = safeTrace(record(event.contexts).trace);
    if (trace) result.contexts = { trace };
    const images = record(event.debug_meta).images;
    if (Array.isArray(images)) result.debug_meta = { images: images.slice(0, 40).flatMap(item => {
      const image = record(item), code_file = sanitizeFilename(image.code_file);
      return code_file && typeof image.debug_id === "string" && uuid.test(image.debug_id)
        ? [{ type: "sourcemap", code_file, debug_id: image.debug_id }] : [];
    }) };
    return result as T;
  } catch { return null; }
}

export function sanitizeSentryLog<T>(input: T): T | null {
  try {
    const log = record(input), attributes = record(log.attributes);
    const message = safeIdentifier(log.message, "");
    if (!message) return null;
    const safe = sanitizeContext({ ...attributes, operation: attributes.operation ?? message } as ObservabilityContext);
    return { level: log.level, message, timestamp: log.timestamp, traceId: typeof log.traceId === "string" && /^[a-f0-9]{32}$/i.test(log.traceId) ? log.traceId : undefined,
      spanId: typeof log.spanId === "string" && /^[a-f0-9]{16}$/i.test(log.spanId) ? log.spanId : undefined, attributes: safe } as T;
  } catch { return null; }
}

/** SDK scopes can enrich logs after beforeSendLog. Filter the final wire envelope too. */
export function sanitizeSentryEnvelope<T>(input: T, metadata: { environment: string; release: string }): T | null {
  try {
    if (!Array.isArray(input) || !Array.isArray(input[1])) return null;
    const originalHeaders = record(input[0]), sdk = record(originalHeaders.sdk);
    const headers = { event_id: originalHeaders.event_id, sent_at: originalHeaders.sent_at,
      sdk: { name: safeIdentifier(sdk.name), version: typeof sdk.version === "string" && /^[0-9.a-z-]{1,30}$/i.test(sdk.version) ? sdk.version : undefined } };
    const items = input[1].flatMap<unknown>((item: unknown) => {
      if (!Array.isArray(item)) return [];
      const header = record(item[0]), payload = record(item[1]);
      if (header.type === "event") {
        const event = sanitizeSentryEvent(payload);
        if (!event) return [];
        const eventSdk = record(payload.sdk);
        return [[{ type: "event" }, { ...event,
          // Relay geolocates the connection even when infer_ip is disabled. An empty
          // geo blocks that lookup; the unspecified IP survives intermediate Relays
          // which can omit empty geo objects when forwarding the event.
          user: { ip_address: "0.0.0.0", geo: {} },
          sdk: { name: safeIdentifier(eventSdk.name), version: typeof eventSdk.version === "string" && /^[0-9.a-z-]{1,30}$/i.test(eventSdk.version) ? eventSdk.version : undefined,
            settings: { infer_ip: "never", infer_user_agent: "never" } } }]];
      }
      if (header.type !== "log" || !Array.isArray(payload.items)) return [];
      const logs = payload.items.slice(0, 100).flatMap((item: unknown) => {
        const log = record(item), attributes = record(log.attributes), raw: RecordValue = {};
        for (const key of ["operation", "provider", "requestId", "status", "durationMs", "count"]) raw[key] = record(attributes[key]).value;
        const safe = sanitizeContext({ ...raw, operation: raw.operation ?? log.body } as ObservabilityContext);
        const message = safeIdentifier(log.body, "");
        if (!message || !["debug", "info", "warn", "error"].includes(String(log.level))) return [];
        const serialized = Object.fromEntries(Object.entries({ ...safe, "sentry.environment": metadata.environment, "sentry.release": metadata.release })
          .filter(([, value]) => value !== undefined).map(([key, value]) => [key, { type: typeof value === "number" ? "double" : "string", value }]));
        return [{ timestamp: typeof log.timestamp === "number" ? log.timestamp : undefined, level: log.level, body: message,
          trace_id: typeof log.trace_id === "string" && /^[a-f0-9]{32}$/i.test(log.trace_id) ? log.trace_id : undefined, attributes: serialized }];
      });
      return logs.length ? [[{ type: "log", item_count: logs.length, content_type: "application/vnd.sentry.items.log+json" },
        { version: 2, ingest_settings: { infer_ip: "never", infer_user_agent: "never" }, items: logs }]] : [];
    });
    return items.length ? [headers, items] as T : null;
  } catch { return null; }
}
