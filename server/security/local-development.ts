/** The local launcher binds loopback by default. Public listeners and the
 * production entrypoint must always keep request throttling enabled. */
export function localRateLimitsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" && ["127.0.0.1", "::1", "[::1]"].includes(env.HOST ?? "");
}
