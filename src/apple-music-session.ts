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
  throw new Error("Apple Music returned a developer token without a valid expiry.");
}

/** MusicKit v3 exposes a read-only developerToken. Renewal must configure a new
 * singleton, then the adapter restores current room intent without reauthorizing. */
export function createAppleMusicSession<T>(options: {
  requestToken: (accessToken: string) => Promise<AppleDeveloperToken>;
  configure: (token: AppleDeveloperToken) => Promise<T>;
  now?: () => number;
}) {
  const now = options.now || (() => Date.now());
  let cached: { instance: T; token: string; expiresAt: number } | null = null;
  let pending: Promise<T> | null = null;
  const refreshDue = () => !cached || cached.expiresAt <= now() + 60_000;
  return {
    current: () => cached?.instance,
    refreshDue,
    get(accessToken: string): Promise<T> {
      if (!refreshDue() && cached) return Promise.resolve(cached.instance);
      if (pending) return pending;
      pending = (async () => {
        const token = await options.requestToken(accessToken);
        const expiresAt = appleDeveloperTokenExpiresAt(token.developerToken);
        if (expiresAt <= now()) throw new Error("Apple Music returned an expired developer token.");
        // Clock skew may fetch the still-valid server token a little early.
        // Reconfiguring the same token would unnecessarily stop healthy audio.
        if (cached?.token === token.developerToken) return cached.instance;
        const instance = await options.configure(token);
        cached = { instance, token: token.developerToken, expiresAt };
        return instance;
      })().finally(() => { pending = null; });
      return pending;
    }
  };
}
