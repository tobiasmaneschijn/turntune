export const HTTP_REQUEST_TIMEOUT_MS = 15_000;

interface JsonRequestOptions<T> extends RequestInit {
  accessToken?: string;
  errorMessage?: string;
  timeoutMs?: number;
  validate?: (payload: unknown) => payload is T;
}

/** One bounded request policy for browser API adapters; callers own their response schema. */
export async function requestJson<T>(path: string, options: JsonRequestOptions<T> = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const { accessToken, errorMessage = "The request could not be completed. Try again.", timeoutMs = HTTP_REQUEST_TIMEOUT_MS, validate, signal, ...init } = options;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const deadline = AbortSignal.timeout(timeoutMs);
  const expire = () => controller.abort(deadline.reason);
  if (deadline.aborted) expire();
  else deadline.addEventListener("abort", expire, { once: true });
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  try {
    const response = await fetchImpl(path, { ...init, headers, signal: controller.signal });
    let payload: unknown;
    try { payload = await response.json(); }
    catch {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new Error(response.ok ? "The server returned an invalid response. Try again." : errorMessage);
    }
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
      throw new Error(typeof error === "string" && error.length <= 1000 ? error : errorMessage);
    }
    if (validate ? !validate(payload) : payload === null || typeof payload !== "object") throw new Error("The server returned an invalid response. Try again.");
    return payload as T;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason?.name === "TimeoutError") throw new Error("The request timed out. Try again.");
    throw error;
  } finally {
    deadline.removeEventListener("abort", expire);
    signal?.removeEventListener("abort", cancel);
  }
}
