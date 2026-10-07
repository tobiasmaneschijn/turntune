const key = "soundspin-auth-destination";
let fallback: string | null = null;

export function safeAuthDestination(path: unknown): string | null {
  return typeof path === "string" && (/^\/room\/[a-z0-9-]{3,48}\/?$/.test(path) ||
    /^\/profile\/[0-9a-f-]{36}$/i.test(path) || path === "/admin") ? path : null;
}

/** Keep an invite's destination while someone signs in or creates an account. */
export function rememberAuthDestination(path: string) {
  const safe = safeAuthDestination(path);
  if (!safe) return;
  fallback = safe;
  try { sessionStorage.setItem(key, safe); } catch { /* Private browsing may disable storage. */ }
}

export function takeAuthDestination(): string {
  let path: unknown = fallback;
  fallback = null;
  try { path = sessionStorage.getItem(key) || path; sessionStorage.removeItem(key); } catch { /* Use the in-memory destination. */ }
  return safeAuthDestination(path) || "/";
}
