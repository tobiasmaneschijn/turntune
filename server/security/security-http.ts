import { serverT } from "../lib/i18n.js";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type express from "express";
import proxyaddr from "proxy-addr";
import { REMOTE_IMAGE_HOSTS, REMOTE_IMAGE_SUFFIXES } from "../../shared/remote-images.js";
import { browserObservabilityConfig, validSentryDsn } from "../observability/config.js";

type TrustProxy = (address: string, index: number) => boolean;
const peerAddresses = new WeakMap<IncomingMessage, string>();

function canonicalIp(address: string | undefined): string {
  if (!address) return "unknown";
  // Give HTTP, polling and WebSocket budgets the same identity for mapped IPv4.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped && isIP(mapped) === 4) return mapped;
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6) {
    try {
      const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
      const mappedHex = normalized.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/i);
      if (mappedHex) {
        const high = Number.parseInt(mappedHex[1], 16), low = Number.parseInt(mappedHex[2], 16);
        return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
      }
      return normalized;
    } catch { return "unknown"; }
  }
  return "unknown";
}

/** Only addresses derived through the configured proxy boundary are accepted. */
export function trustedClientIp(request: IncomingMessage): string {
  return peerAddresses.get(request) ?? canonicalIp(request.socket.remoteAddress);
}

export function trustedSocketPeer(socket: { request: IncomingMessage }): string {
  return trustedClientIp(socket.request);
}

function proxyTrust(env: NodeJS.ProcessEnv): TrustProxy {
  const entries = (env.TRUSTED_PROXY_CIDRS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  for (const entry of entries) {
    const [address, prefix, ...extra] = entry.split("/");
    const family = isIP(address);
    const bits = family === 4 ? 32 : 128;
    // Refuse catch-all networks, aliases/hop counts and ambiguous mapped CIDRs.
    // proxy-addr >= 2.0.8 also fixes GHSA-jqcg-44mw-7w3h.
    if (!family || extra.length || (family === 6 && isIP(canonicalIp(address)) === 4) ||
      (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > bits))) {
      throw new Error(serverT("trusted_proxy_cidrs_must_contain_explicit_ip_addresses_or_nonzero_cidrs_mapped_ipv6_c"));
    }
  }
  return entries.length ? proxyaddr.compile(entries) : () => false;
}

function appOrigin(env: NodeJS.ProcessEnv): URL | null {
  const raw = env.APP_ORIGIN?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error(serverT("production_requires_app_origin_set_to_the_public_https_origin"));
    return null;
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(serverT("app_origin_must_be_a_valid_http_s_origin")); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.hostname.includes("*")) {
    throw new Error(serverT("app_origin_must_contain_only_scheme_hostname_and_optional_port"));
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(serverT("production_app_origin_must_use_https"));
  }
  return url;
}

function additionalAppOrigins(env: NodeJS.ProcessEnv): URL[] {
  return (env.APP_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean).map(value => {
    try { return appOrigin({ ...env, APP_ORIGIN: value })!; }
    catch { throw new Error(serverT("app_origins_must_contain_valid_exact_origins")); }
  });
}

function contentSecurityPolicy(env: NodeJS.ProcessEnv, publicOrigins: URL[]): string {
  let supabase = "";
  let supabaseImages = "";
  const browserMonitoring = browserObservabilityConfig(env);
  const sentryDsn = browserMonitoring.provider === "sentry" && validSentryDsn(browserMonitoring.dsn);
  const sentryOrigin = sentryDsn ? new URL(sentryDsn).origin : "";
  const appSocketOrigin = [...new Set(publicOrigins.map(url => url.origin.replace(/^http/, "ws")))].join(" ");
  try {
    const url = new URL(env.SUPABASE_URL ?? "");
    if (url.protocol === "https:" || (env.NODE_ENV !== "production" && url.protocol === "http:")) {
      supabase = `${url.origin} ${url.origin.replace(/^http/, "ws")}`;
      supabaseImages = `${url.origin}/storage/v1/object/ ${url.origin}/storage/v1/render/image/`;
    }
  } catch { /* Configuration validation supplies a clearer startup error. */ }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com https://w.soundcloud.com https://sdk.scdn.co https://js-cdn.music.apple.com https://widget.mixcloud.com",
    // The existing React/player UI sets styles dynamically. Scripts remain restricted.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${supabaseImages} https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/ ${REMOTE_IMAGE_HOSTS.map(host => `https://${host}`).join(" ")} ${REMOTE_IMAGE_SUFFIXES.flatMap(host => [`https://${host}`, `https://*.${host}`]).join(" ")}`,
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://w.soundcloud.com https://open.spotify.com https://music.apple.com https://authorize.music.apple.com https://www.mixcloud.com",
    `connect-src 'self' ${appSocketOrigin} ${supabase} ${sentryOrigin} https://www.youtube.com https://api.spotify.com https://*.spotify.com wss://*.spotify.com https://*.scdn.co https://*.music.apple.com https://*.mzstatic.com https://*.apple.com`,
    "media-src 'self' blob: https://*.scdn.co https://*.spotify.com https://*.music.apple.com https://*.mzstatic.com https://*.apple.com https://api.audius.co https://*.audius.co",
    "worker-src 'self' blob:",
    env.NODE_ENV === "production" ? "upgrade-insecure-requests" : ""
  ].filter(Boolean).join("; ");
}

function isLoopbackHealth(request: IncomingMessage): boolean {
  const peer = canonicalIp(request.socket.remoteAddress);
  const path = request.url?.split("?", 1)[0];
  return (peer === "127.0.0.1" || peer === "::1") && !request.headers.origin &&
    request.method === "GET" && (path === "/api/health" || path === "/api/ready") &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host ?? "");
}

/** Call before routes/body parsers. These checks also cover Engine.IO upgrades. */
export function configureHttpSecurity(app: express.Express, env: NodeJS.ProcessEnv): {
  origin: string[];
  allowRequest: (request: IncomingMessage, callback: (error: string | null, success: boolean) => void) => void;
} {
  const production = env.NODE_ENV === "production";
  const origin = appOrigin(env);
  const publicOrigins = [...(origin ? [origin] : []), ...additionalAppOrigins(env)];
  const publicHosts = new Set(publicOrigins.map(url => url.host.toLowerCase()));
  const trust = proxyTrust(env);
  const origins = [...new Set([
    ...publicOrigins.map(url => url.origin),
    ...(!production ? ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:3000", "http://localhost:3000"] : [])
  ])];
  if (env.CSP_MODE && !["enforce", "report-only"].includes(env.CSP_MODE)) {
    throw new Error(serverT("csp_mode_must_be_enforce_or_report_only"));
  }
  app.disable("x-powered-by");
  app.set("trust proxy", trust);

  function requestError(request: IncomingMessage): string | null {
    const peer = canonicalIp(proxyaddr(request, trust));
    peerAddresses.set(request, peer);
    if (peer === "unknown") return serverT("client_address_unavailable");
    const requestOrigin = request.headers.origin;
    if (requestOrigin !== undefined && (!origins.includes(requestOrigin) || requestOrigin === "null")) {
      return serverT("origin_not_allowed");
    }
    if (!production || isLoopbackHealth(request)) return null;
    if (!publicHosts.has((request.headers.host ?? "").toLowerCase())) return serverT("host_not_allowed");
    const encrypted = Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted);
    // Forwarded protocol is authoritative only when the direct peer is trusted.
    const forwardedProto = request.headers["x-forwarded-proto"];
    // Traefik reports secure WebSocket upgrades as wss instead of https.
    const websocketUpgrade = request.method === "GET" && request.headers.upgrade?.toLowerCase() === "websocket" &&
      request.headers.connection?.split(",").some(token => token.trim().toLowerCase() === "upgrade");
    const forwardedSecure = forwardedProto === "https" || (forwardedProto === "wss" && websocketUpgrade);
    const https = encrypted || (trust(request.socket.remoteAddress ?? "", 0) && forwardedSecure);
    return https ? null : serverT("https_required");
  }

  const csp = contentSecurityPolicy(env, publicOrigins);
  app.use((request, response, next) => {
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), autoplay=(self \"https://www.youtube.com\" \"https://w.soundcloud.com\" \"https://open.spotify.com\" \"https://music.apple.com\" \"https://www.mixcloud.com\"), encrypted-media=(self \"https://open.spotify.com\" \"https://music.apple.com\")");
    response.setHeader(env.CSP_MODE === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", csp);
    // Anti-framing stays enforced while validating a report-only provider policy.
    if (env.CSP_MODE === "report-only") response.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    const error = requestError(request);
    if (error) { response.status(403).json({ error }); return; }
    next();
  });
  return {
    origin: origins,
    allowRequest(request, callback) {
      const error = requestError(request);
      callback(error, error === null);
    }
  };
}
