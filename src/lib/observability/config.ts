export interface BrowserObservabilityConfig {
  provider: "sentry" | "console" | "none";
  dsn?: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
}

/** DSNs are public configuration, but may not carry a private key or URL data. */
function validDsn(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-zA-Z0-9_]{1,128}$/.test(url.username) &&
      !url.password && !!url.hostname && !url.search && !url.hash &&
      /^\/(?:[a-zA-Z0-9._~-]+\/)*[1-9]\d*$/.test(url.pathname);
  } catch { return false; }
}

export function parseBrowserObservabilityConfig(value: unknown): BrowserObservabilityConfig | null {
  if (!value || typeof value !== "object") return null;
  const configuration = (value as Record<string, unknown>).observability;
  if (!configuration || typeof configuration !== "object") return null;
  const { provider, dsn, environment, release, tracesSampleRate } = configuration as Record<string, unknown>;
  if (provider !== "sentry" && provider !== "console" && provider !== "none") return null;
  if (typeof environment !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(environment) ||
    typeof release !== "string" || !/^[a-zA-Z0-9_@./+-]{1,200}$/.test(release) ||
    typeof tracesSampleRate !== "number" || !Number.isFinite(tracesSampleRate) ||
    tracesSampleRate < 0 || tracesSampleRate > 1 || (provider === "sentry" && !validDsn(dsn))) return null;
  return { provider, ...(provider === "sentry" ? { dsn: dsn as string } : {}), environment, release, tracesSampleRate };
}
