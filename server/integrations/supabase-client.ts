import { serverT } from "../lib/i18n.js";
import { createAdminClient } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CONCURRENT = 64;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const DEADLINE_MS = 15_000;
// Store and route clients share the same process-wide admission/stream budget.
let activeRequests = 0;
let bufferedBytes = 0;

interface FetchLimits { timeoutMs?: number; maxResponseBytes?: number; maxConcurrent?: number; maxBufferedBytes?: number }
function limit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(serverT("invalid_bounded_supabase_fetch_limit"));
  return value;
}
function withAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(value => { signal.removeEventListener("abort", aborted); resolve(value); }, error => { signal.removeEventListener("abort", aborted); reject(error); });
    if (signal.aborted) aborted();
  });
}
function cancel(body: ReadableStream<Uint8Array> | null) {
  // Never let a broken stream's cancellation promise extend the deadline.
  if (body && !body.locked) void body.cancel().catch(() => undefined);
}

/** Public SDK fetch hook; mocks may inject a fetcher and lower limits in tests. */
export function createBoundedSupabaseFetch(projectUrl: string, fetcher: typeof fetch = globalThis.fetch, limits: FetchLimits = {}): typeof fetch {
  let project: URL;
  try { project = new URL(projectUrl); } catch { throw new Error(serverT("supabase_requires_a_configured_project_origin")); }
  const localMode = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const localHttp = localMode && project.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(project.hostname);
  if ((project.protocol !== "https:" && !localHttp) || project.username || project.password || project.pathname !== "/" || project.search || project.hash) {
    throw new Error(serverT("supabase_requires_an_https_project_origin_local_http_is_supported_for_isolated_develo"));
  }
  const timeoutMs = limit(limits.timeoutMs, DEADLINE_MS);
  const maxBytes = limit(limits.maxResponseBytes, MAX_RESPONSE_BYTES);
  const maxConcurrent = limit(limits.maxConcurrent, MAX_CONCURRENT);
  const maxBufferedBytes = limit(limits.maxBufferedBytes, MAX_BUFFERED_BYTES);

  return async (input, init = {}) => {
    const source = input instanceof Request ? input : null;
    let target: URL;
    try { target = new URL(source ? source.url : String(input)); } catch { throw new Error(serverT("invalid_supabase_request_target")); }
    if (target.origin !== project.origin || target.username || target.password) throw new Error(serverT("supabase_request_target_is_outside_the_configured_project"));
    const callerSignals = [init.signal, source?.signal].filter((value): value is AbortSignal => Boolean(value));
    for (const signal of callerSignals) signal.throwIfAborted();
    if (activeRequests >= maxConcurrent) throw new Error(serverT("supabase_request_capacity_reached_try_again_shortly"));
    activeRequests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Supabase operation timed out.", "TimeoutError")), timeoutMs);
    const signal = callerSignals.length ? AbortSignal.any([...callerSignals, controller.signal]) : controller.signal;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let chargedBytes = 0;
    try {
      signal.throwIfAborted();
      const fetching = Promise.resolve(fetcher(input, { ...init, signal, redirect: "error" }));
      // Also close late responses from an uncooperative mock/transport after abort.
      void fetching.then(value => { if (signal.aborted) cancel(value.body); }, () => undefined);
      response = await withAbort(fetching, signal);
      signal.throwIfAborted();
      if (response.redirected || (response.url && new URL(response.url).origin !== project.origin) ||
        [301, 302, 303, 307, 308].includes(response.status)) throw new Error(serverT("supabase_redirects_are_not_permitted"));
      if (!response.body) return response;
      const announced = Number(response.headers.get("content-length"));
      if (Number.isFinite(announced) && announced > maxBytes) throw new Error(serverT("supabase_returned_an_oversized_response"));
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        signal.throwIfAborted();
        const chunk = await withAbort(reader.read(), signal);
        signal.throwIfAborted();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) throw new Error(serverT("supabase_returned_an_oversized_response"));
        if (bufferedBytes + chunk.value.byteLength > maxBufferedBytes) throw new Error(serverT("supabase_response_capacity_reached"));
        bufferedBytes += chunk.value.byteLength;
        chargedBytes += chunk.value.byteLength;
        chunks.push(chunk.value);
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const headers = new Headers(response.headers);
      // Native fetch decompresses the original bytes; preserve the logical body.
      headers.delete("content-encoding");
      headers.set("content-length", String(bytes));
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    } finally {
      clearTimeout(timer);
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      } else if (response) cancel(response.body);
      bufferedBytes -= chargedBytes;
      activeRequests--;
    }
  };
}

type AdminOptions = NonNullable<Parameters<typeof createAdminClient>[0]>;
export function createBoundedAdminClient(options: { env?: AdminOptions["env"]; fetcher?: typeof fetch } = {}): SupabaseClient {
  const projectUrl = options.env?.url ?? process.env.SUPABASE_URL ?? "";
  return createAdminClient({ env: options.env,
    supabaseOptions: { global: { fetch: createBoundedSupabaseFetch(projectUrl, options.fetcher) } }
  });
}
