import { readFileSync } from "node:fs";
import { safeIdentifier } from "../../shared/observability.js";

export type ObservabilityProvider = "none" | "console" | "sentry";
export function validSentryDsn(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^[a-zA-Z0-9]+$/.test(url.username) || url.password || url.search || url.hash || !/\/\d+$/.test(url.pathname)) return;
    return url.href;
  } catch { return; }
}
export function buildRelease(env: NodeJS.ProcessEnv = process.env): string {
  let value: unknown;
  try { value = JSON.parse(readFileSync(new URL("../../build-release.json", import.meta.url), "utf8")).revision; } catch { /* Source/dev launch. */ }
  value ??= env.BUILD_REVISION;
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) ? value : "unknown";
}
export function observabilityConfig(env: NodeJS.ProcessEnv = process.env) {
  const disabled = env.NODE_ENV === "test";
  const provider: ObservabilityProvider = disabled ? "none" : env.OBSERVABILITY_PROVIDER === "none" || env.OBSERVABILITY_PROVIDER === "sentry" ? env.OBSERVABILITY_PROVIDER : "console";
  const rawRate = env.OBSERVABILITY_TRACES_SAMPLE_RATE === undefined ? 0.1 : Number(env.OBSERVABILITY_TRACES_SAMPLE_RATE);
  const tracesSampleRate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 1 ? rawRate : 0;
  return { provider, environment: safeIdentifier(env.OBSERVABILITY_ENVIRONMENT ?? env.NODE_ENV ?? "development"),
    release: buildRelease(env), tracesSampleRate,
    dsn: provider === "sentry" ? validSentryDsn(env.SENTRY_DSN) : undefined,
    browserDsn: provider === "sentry" ? validSentryDsn(env.SENTRY_BROWSER_DSN) : undefined };
}
export function browserObservabilityConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = observabilityConfig(env);
  return { provider: config.provider === "sentry" && !config.browserDsn ? "none" as const : config.provider,
    dsn: config.browserDsn, environment: config.environment, release: config.release, tracesSampleRate: config.tracesSampleRate };
}
