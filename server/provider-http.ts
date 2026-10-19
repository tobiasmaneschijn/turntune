import { serverT } from "./i18n.js";
/** Fixed provider names keep both admission state and metrics cardinality bounded. */
export type ProviderService = "spotify" | "apple" | "soundcloud" | "mixcloud" | "youtube" | "giphy";

const active = new Map<ProviderService, number>();
const windows = new Map<ProviderService, { count: number; resetAt: number }>();
let totalActive = 0;
function configuredLimit(name: string, fallback: number, maximum: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  return value;
}
const catalogRequestsPerMinute = configuredLimit("PROVIDER_REQUESTS_PER_MINUTE", 300, 10_000);
const spotifyRequestsPerMinute = configuredLimit("SPOTIFY_REQUESTS_PER_MINUTE", 1_200, 10_000);
const providerConcurrent = configuredLimit("PROVIDER_MAX_CONCURRENT", 12, 32);
const globalConcurrent = configuredLimit("PROVIDER_GLOBAL_MAX_CONCURRENT", 48, 96);

export function providerHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}

export function providerDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 86_400_000 ? Math.floor(value) : undefined;
}

export function providerSignal(signal?: AbortSignal | null, timeoutMs = 10_000) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

export async function readBoundedJson<T = unknown>(response: Response, maxBytes = 1_048_576, signal?: AbortSignal): Promise<T> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error(serverT("provider_returned_an_oversized_response"));
  }
  if (!response.body) throw new Error(serverT("provider_returned_an_empty_response"));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(serverT("provider_returned_an_oversized_response"));
      }
      chunks.push(next.value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(combined)) as T; }
    catch {
      if (!response.ok) return {} as T;
      throw new Error(serverT("provider_returned_an_invalid_response"));
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    // A malformed, canceled or failed read must not retain an upstream stream.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Admission remains held until fetch and body consumption finish, including aborts. */
export async function providerJson<T>(provider: ProviderService, fetcher: typeof fetch, url: string, init: RequestInit = {}, options: { maxBytes?: number; timeoutMs?: number; allowedRedirectOrigins?: readonly string[] } = {}) {
  const signal = providerSignal(init.signal, options.timeoutMs);
  signal.throwIfAborted();
  const now = Date.now();
  // Spotify includes the app's 1.5-second per-listener playback polling. Catalog
  // providers do not need that throughput; each keeps a lower spend ceiling.
  const maximumRequests = provider === "spotify" ? spotifyRequestsPerMinute : catalogRequestsPerMinute;
  const window = windows.get(provider);
  const budget = !window || window.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : window;
  if ((active.get(provider) || 0) >= providerConcurrent || totalActive >= globalConcurrent || budget.count >= maximumRequests) {
    throw new Error(serverT("provider_request_capacity_reached_try_again_shortly"));
  }
  budget.count++;
  windows.set(provider, budget);
  active.set(provider, (active.get(provider) || 0) + 1);
  totalActive++;
  try {
    let response = await fetcher(url, { ...init, redirect: options.allowedRedirectOrigins ? "manual" : "error", signal });
    // SoundCloud's resolver may redirect to its canonical track endpoint. Only
    // an explicitly trusted HTTPS origin can receive the authorization header.
    if (options.allowedRedirectOrigins && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      const target = location ? new URL(location, url) : null;
      if (!target || target.protocol !== "https:" || target.username || target.password || !options.allowedRedirectOrigins.includes(target.origin) || budget.count >= maximumRequests) {
        throw new Error(serverT("provider_returned_an_unsafe_redirect"));
      }
      budget.count++;
      response = await fetcher(target.href, { ...init, redirect: "error", signal });
    }
    if (signal.aborted) await response.body?.cancel();
    signal.throwIfAborted();
    if (response.status === 204) return { response, payload: null as T };
    const payload = await readBoundedJson<T>(response, options.maxBytes, signal);
    return { response, payload };
  } finally {
    active.set(provider, (active.get(provider) || 1) - 1);
    totalActive--;
  }
}
