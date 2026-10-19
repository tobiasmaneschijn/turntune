import i18n from "./i18n";
export interface AppleDeveloperToken {
  developerToken: string;
  storefront?: string;
}

export function appleDeveloperTokenExpiresAt(token: string) {
  try {
    const payload = token.split(".")[1];
    const claims = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))) as { exp?: number };
    if (typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp > 0) return claims.exp * 1000;
  } catch { /* A malformed token must not become a permanent cached session. */ }
  throw new Error(i18n.t("music:apple.invalidExpiry"));
}

/** MusicKit v3 exposes a read-only developerToken. Renewal must configure a new
 * singleton, then the adapter restores current room intent without reauthorizing. */
export function createAppleMusicSession<T>(options: {
  requestToken: (accessToken: string, signal?: AbortSignal) => Promise<AppleDeveloperToken>;
  dispose?: (instance: T) => void | Promise<unknown>;
  configure: (token: AppleDeveloperToken) => Promise<T>;
  now?: () => number;
}) {
  const now = options.now || (() => Date.now());
  let cached: { instance: T; token: string; expiresAt: number } | null = null;
  let pending: Promise<T> | null = null;
  let generation = 0;
  let controller: AbortController | null = null;
  let configurations: Promise<unknown> = Promise.resolve();
  const refreshDue = () => !cached || cached.expiresAt <= now() + 60_000;
  return {
    current: () => cached?.instance,
    refreshDue,
    reset(): Promise<void> {
      generation++;
      controller?.abort(); controller = null;
      const previous = cached?.instance;
      cached = null; pending = null;
      const teardown = configurations.then(() => previous ? options.dispose?.(previous) : undefined);
      configurations = teardown.catch(() => undefined);
      return teardown.then(() => undefined);
    },
    get(accessToken: string): Promise<T> {
      if (!refreshDue() && cached) return Promise.resolve(cached.instance);
      if (pending) return pending;
      const expected = generation, request = new AbortController();
      controller = request;
      const current = () => expected === generation && !request.signal.aborted;
      const operation = (async () => {
        const token = await options.requestToken(accessToken, request.signal);
        if (!current()) throw new Error(i18n.t("music:apple.sessionChanged"));
        const expiresAt = appleDeveloperTokenExpiresAt(token.developerToken);
        if (expiresAt <= now()) throw new Error(i18n.t("music:apple.expiredToken"));
        if (cached?.token === token.developerToken) return cached.instance;
        // MusicKit configuration cannot be cancelled. Serialize replacements and
        // dispose a completed old-account configuration before a new one starts.
        const configure = configurations.then(async () => {
          if (!current()) throw new Error(i18n.t("music:apple.sessionChanged"));
          const instance = await options.configure(token);
          if (!current()) {
            await options.dispose?.(instance);
            throw new Error(i18n.t("music:apple.sessionChanged"));
          }
          cached = { instance, token: token.developerToken, expiresAt };
          return instance;
        });
        configurations = configure.catch(() => undefined);
        return configure;
      })().finally(() => { if (pending === operation) pending = null; if (controller === request) controller = null; });
      pending = operation;
      return operation;
    }
  };
}
