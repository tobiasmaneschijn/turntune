/** Only construct from claims returned by credential verification, never decoded client JSON. */
export function createSocketCredentialLease(userId: string, expiresAtSeconds: unknown, now = Date.now) {
  if (!userId || typeof expiresAtSeconds !== "number" || !Number.isFinite(expiresAtSeconds)) throw new Error("Your session has expired. Sign in again.");
  const expiresAt = expiresAtSeconds * 1000;
  const assertActive = () => {
    if (now() >= expiresAt) throw new Error("Your session has expired. Reconnect with a refreshed session.");
  };
  assertActive();
  return {
    userId,
    expiresAt,
    assertActive,
    scheduleExpiry(onExpired: () => void) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;
      const check = () => {
        if (disposed) return;
        const remaining = expiresAt - now();
        if (remaining <= 0) { onExpired(); return; }
        timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
        timer.unref();
      };
      check();
      return () => { disposed = true; if (timer) clearTimeout(timer); };
    }
  };
}
export type SocketCredentialLease = ReturnType<typeof createSocketCredentialLease>;
