import { SignupAttemptLimiter } from "./invite-signup.js";
import crypto from "node:crypto";
import type { Express, Request } from "express";
import type { SpotifyAccounts } from "./spotify-accounts.js";

const FLOW_TTL_MS = 10 * 60_000;
const COOKIE_PREFIX = "soundspin_spotify_";
const COOKIE_PATH = "/api/spotify/callback";
const cookieName = (state: string, secure: boolean) => `${secure ? '__Host-' : ''}${COOKIE_PREFIX}${state}`;
const cookiePath = (secure: boolean) => secure ? '/' : COOKIE_PATH;

/** Normalize as a browser does before accepting a same-origin relative destination. */
export function spotifyReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/";
  const base = "https://soundspin.invalid";
  try {
    const destination = new URL(value, base);
    if (destination.origin !== base) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch { return "/"; }
}

function withOutcome(path: string, outcome: string) {
  const destination = new URL(path, "https://soundspin.invalid");
  destination.searchParams.set("spotify", outcome);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
function readCookie(request: Request, name: string) {
  const values = (request.get("cookie") || "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  // Ambiguous cookies cannot establish browser ownership of a flow.
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}
const digest = (value: string) => crypto.createHash("sha256").update(value).digest();

export interface SpotifyOAuthRouteOptions {
  getUserId: (request: Request) => Promise<string | null>;
  isAccountActive?: (userId: string) => Promise<boolean>;
  accounts: Pick<SpotifyAccounts, "configured" | "connect">;
  authorizationUrl: (redirectUri: string, state: string) => string;
  redirectUri: (request: Request) => string;
  now?: () => number;
}

/** A valid state proves the flow; the HttpOnly nonce proves the initiating browser. */
export function mountSpotifyOAuthRoutes(app: Express, options: SpotifyOAuthRouteOptions) {
  const now = options.now || Date.now;
  const attempts = new SignupAttemptLimiter(10, FLOW_TTL_MS);
  const ipAttempts = new SignupAttemptLimiter(30, FLOW_TTL_MS);
  const states = new Map<string, { userId: string; returnTo: string; redirectUri: string; nonceDigest: Buffer; expiresAt: number; secure: boolean }>();
  const prune = () => {
    for (const [state, flow] of states) if (flow.expiresAt <= now()) states.delete(state);
  };
  app.get("/api/spotify/connect", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const userId = await options.getUserId(request);
    if (!userId) return response.status(401).json({ error: "Authentication required." });
    if (!options.accounts.configured) return response.status(503).json({ error: "Spotify OAuth or provider-token encryption is not configured yet." });
    prune();
    if ([...states.values()].filter(flow => flow.userId === userId).length >= 3 ||
      !attempts.consume(userId, now()) || !ipAttempts.consume(request.ip || request.socket.remoteAddress || "unknown", now()) || states.size >= 10_000) return response.status(429).json({ error: "Too many Spotify connection attempts. Try again shortly." });
    const state = crypto.randomBytes(24).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const redirectUri = options.redirectUri(request);
    const secure = new URL(redirectUri).protocol === "https:";
    states.set(state, { userId, returnTo: spotifyReturnPath(request.query.returnTo), redirectUri, nonceDigest: digest(nonce), expiresAt: now() + FLOW_TTL_MS, secure });
    response.cookie(cookieName(state, secure), nonce, { httpOnly: true, sameSite: "lax", secure, path: cookiePath(secure), maxAge: FLOW_TTL_MS });
    response.json({ url: options.authorizationUrl(redirectUri, state) });
  });
  app.get("/api/spotify/callback", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const state = typeof request.query.state === "string" && /^[A-Za-z0-9_-]{32}$/.test(request.query.state) ? request.query.state : null;
    const flow = state ? states.get(state) : undefined;
    const nonce = state && flow ? readCookie(request, cookieName(state, flow.secure)) : null;
    if (!state || !flow || flow.expiresAt <= now() || !nonce || !crypto.timingSafeEqual(digest(nonce), flow.nonceDigest)) {
      prune();
      return response.status(400).send("Spotify authorization expired or belongs to another browser. Return to Lydman and try again.");
    }
    // Consume only after browser proof: a forwarded URL cannot cancel the legitimate flow.
    states.delete(state);
    response.clearCookie(cookieName(state, flow.secure), { httpOnly: true, sameSite: "lax", secure: flow.secure, path: cookiePath(flow.secure) });
    const code = typeof request.query.code === "string" && request.query.code.length > 0 && request.query.code.length <= 4096 ? request.query.code : null;
    if (!code) return response.redirect(withOutcome(flow.returnTo, "denied"));
    try {
      const authorize = async () => {
        if (options.isAccountActive && !await options.isAccountActive(flow.userId)) throw new Error("Account access is unavailable.");
      };
      await authorize();
      await options.accounts.connect(flow.userId, code, flow.redirectUri, authorize);
      return response.redirect(withOutcome(flow.returnTo, "connected"));
    } catch {
      return response.redirect(withOutcome(flow.returnTo, "error"));
    }
  });
}
