import { createTransport, type NodeOptions } from "@sentry/node";

/** Unlike the SDK's default Node transport, every request has an abort deadline. */
export function createBoundedSentryTransport(options: Parameters<NonNullable<NodeOptions["transport"]>>[0]) {
  return createTransport(options, async request => {
    const response = await fetch(options.url, { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/x-sentry-envelope", ...options.headers },
      body: typeof request.body === "string" ? request.body : Buffer.from(request.body), signal: AbortSignal.timeout(2_000) });
    await response.body?.cancel();
    return { statusCode: response.status, headers: { "x-sentry-rate-limits": response.headers.get("x-sentry-rate-limits"), "retry-after": response.headers.get("retry-after") } };
  });
}
