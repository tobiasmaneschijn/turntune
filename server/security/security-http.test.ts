import assert from "node:assert/strict";
import { createServer, get, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import express from "express";
import { Server } from "socket.io";
import { io as clientSocket } from "socket.io-client";
import { configureHttpSecurity, trustedClientIp, trustedSocketPeer } from "./security-http.js";

const production = { NODE_ENV: "production", APP_ORIGIN: "https://soundspin.test", SUPABASE_URL: "https://project.supabase.co" };

function request(address: string, headers: Record<string, string> = {}, url = "/socket.io/?EIO=4&transport=websocket"): IncomingMessage {
  return { socket: { remoteAddress: address }, headers, method: "GET", url } as IncomingMessage;
}
function allowed(policy: ReturnType<typeof configureHttpSecurity>, req: IncomingMessage) {
  let result: { error: string | null; success: boolean } | undefined;
  policy.allowRequest(req, (error, success) => { result = { error, success }; });
  assert.ok(result);
  return result;
}

test("production security configuration fails without a public HTTPS origin or explicit valid proxies", () => {
  assert.throws(() => configureHttpSecurity(express(), { NODE_ENV: "production" }), /APP_ORIGIN/);
  assert.throws(() => configureHttpSecurity(express(), { NODE_ENV: "production", APP_ORIGINS: "https://legacy.test" }), /APP_ORIGIN/);
  for (const value of ["http://soundspin.test", "https://user:pass@soundspin.test", "https://soundspin.test/path", "https://soundspin.test/?token=x", "https://*.soundspin.test"]) {
    assert.throws(() => configureHttpSecurity(express(), { ...production, APP_ORIGIN: value }), /APP_ORIGIN/);
  }
  for (const value of ["http://legacy.test", "https://user:pass@legacy.test", "https://legacy.test/path", "https://legacy.test/?token=x", "https://legacy.test/#fragment", "https://*.legacy.test", "null", "https://legacy.test,https://other.test/path"]) {
    assert.throws(() => configureHttpSecurity(express(), { ...production, APP_ORIGINS: value }), /APP_ORIGINS/);
  }
  assert.deepEqual(configureHttpSecurity(express(), { ...production, APP_ORIGINS: " https://legacy.test,https://legacy.test,https://other.test:8443 " }).origin,
    [production.APP_ORIGIN, "https://legacy.test", "https://other.test:8443"]);
  assert.ok(configureHttpSecurity(express(), { NODE_ENV: "development", APP_ORIGINS: "http://127.0.0.1:4189" }).origin.includes("http://127.0.0.1:4189"));
  for (const value of ["true", "1", "loopback", "0.0.0.0/0", "::/0", "::ffff:10.0.0.0/8", "0:0:0:0:0:ffff:a00:0/8", "10.0.0.0/-1", "10.0.0.0/33"]) {
    assert.throws(() => configureHttpSecurity(express(), { ...production, TRUSTED_PROXY_CIDRS: value }), /TRUSTED_PROXY_CIDRS/);
  }
});

test("untrusted forwarded headers cannot select protocol, host or limiter identity", () => {
  const policy = configureHttpSecurity(express(), production);
  const req = request("203.0.113.8", { host: "soundspin.test", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.42" });
  assert.equal(allowed(policy, req).error, "HTTPS required.");
  assert.equal(trustedClientIp(req), "203.0.113.8");
  assert.equal(trustedSocketPeer({ request: req }), "203.0.113.8");
});

test("trusted wss requires a WebSocket upgrade and preserves the origin, host and proxy boundary", () => {
  const policy = configureHttpSecurity(express(), { ...production, TRUSTED_PROXY_CIDRS: "10.0.0.2/32" });
  const headers = { host: "soundspin.test", origin: "https://soundspin.test", "x-forwarded-proto": "wss",
    upgrade: "WebSocket", connection: "keep-alive, Upgrade" };
  assert.equal(allowed(policy, request("10.0.0.2", headers)).success, true);
  assert.equal(allowed(policy, request("203.0.113.8", headers)).error, "HTTPS required.");
  assert.equal(allowed(policy, request("10.0.0.2", { ...headers, origin: "https://evil.test" })).error, "Origin not allowed.");
  assert.equal(allowed(policy, request("10.0.0.2", { ...headers, host: "evil.test" })).error, "Host not allowed.");
  for (const invalid of [{ upgrade: "" }, { connection: "keep-alive" }, { connection: "not-upgrade" }]) {
    assert.equal(allowed(policy, request("10.0.0.2", { ...headers, ...invalid })).error, "HTTPS required.");
  }
  const post = request("10.0.0.2", headers);
  post.method = "POST";
  assert.equal(allowed(policy, post).error, "HTTPS required.");
  for (const protocol of ["ws", "wss,https", "https,wss", "WSS", " wss", "wss "]) {
    assert.equal(allowed(policy, request("10.0.0.2", { ...headers, "x-forwarded-proto": protocol })).error, "HTTPS required.");
  }
  const multipleProtocols = request("10.0.0.2", headers);
  multipleProtocols.headers["x-forwarded-proto"] = ["wss", "https"];
  assert.equal(allowed(policy, multipleProtocols).error, "HTTPS required.");
});

test("HTTP and socket peers follow the trusted chain and normalize mapped IPv4", () => {
  const policy = configureHttpSecurity(express(), { ...production, TRUSTED_PROXY_CIDRS: "10.0.0.0/8" });
  const req = request("::ffff:10.0.0.2", { host: "soundspin.test", origin: "https://soundspin.test", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.99, 203.0.113.7" });
  assert.equal(allowed(policy, req).success, true);
  // The untrusted rightmost hop bounds the chain; an attacker-supplied leftmost value is ignored.
  assert.equal(trustedClientIp(req), "203.0.113.7");
  assert.equal(trustedSocketPeer({ request: req }), "203.0.113.7");
  assert.equal(trustedClientIp(request("::ffff:203.0.113.7")), "203.0.113.7");
  assert.equal(trustedClientIp(request("0:0:0:0:0:ffff:cb00:7107")), "203.0.113.7");
  assert.equal(trustedClientIp(request("2001:0DB8:0:0:0:0:0:0001")), "2001:db8::1");
});

test("hostile and opaque origins, wrong host and ambiguous forwarded protocols are denied on upgrades", () => {
  const policy = configureHttpSecurity(express(), { ...production, TRUSTED_PROXY_CIDRS: "10.0.0.2/32" });
  const headers = { host: "soundspin.test", "x-forwarded-proto": "https" };
  assert.equal(allowed(policy, request("10.0.0.2", headers)).success, true, "Bearer-authenticated native clients may omit Origin.");
  for (const origin of ["https://evil.test", "null", "https://soundspin.test.evil.test"]) {
    assert.equal(allowed(policy, request("10.0.0.2", { ...headers, origin })).success, false);
  }
  assert.equal(allowed(policy, request("10.0.0.2", { ...headers, host: "evil.test", "x-forwarded-host": "soundspin.test" })).error, "Host not allowed.");
  assert.equal(allowed(policy, request("10.0.0.2", { ...headers, "x-forwarded-proto": "https,http" })).error, "HTTPS required.");
  assert.equal(allowed(policy, request("10.0.0.2", { ...headers, "x-forwarded-for": "not-an-ip" })).error, "Client address unavailable.");
  assert.equal(allowed(policy, request("127.0.0.1", { host: "127.0.0.1:3000" }, "/api/ready")).success, true);
  assert.equal(allowed(policy, request("203.0.113.8", { host: "127.0.0.1:3000" }, "/api/ready")).success, false);
});

test("approved legacy domains serve HTTP while headers protect success and rejection", async (t) => {
  const app = express();
  configureHttpSecurity(app, { ...production, APP_ORIGINS: "https://lydman.test,https://legacy.test:8443", TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128", CSP_MODE: "report-only",
    OBSERVABILITY_PROVIDER: "sentry", SENTRY_DSN: "https://serverkey@server-monitoring.invalid/1", SENTRY_BROWSER_DSN: "https://browserkey@browser-monitoring.invalid/2" });
  app.get("/", (req, res) => res.json({ ip: trustedClientIp(req) }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const read = (headers: Record<string, string>) => new Promise<{ response: IncomingMessage; body: string }>((resolve, reject) => {
    get(url, { headers }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ response, body }));
    }).on("error", reject);
  });
  const { response, body } = await read({ host: "soundspin.test", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.2" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(body), { ip: "198.51.100.2" });
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.headers["content-security-policy"] as string, /frame-ancestors 'none'/);
  assert.match(response.headers["content-security-policy-report-only"] as string, /project\.supabase\.co wss:\/\/project\.supabase\.co/);
  const connectionPolicy = (response.headers["content-security-policy-report-only"] as string).split(";").find(value => value.trim().startsWith("connect-src"))!;
  const mediaPolicy = (response.headers["content-security-policy-report-only"] as string).split(";").find(value => value.trim().startsWith("media-src"))!;
  assert.match(mediaPolicy, /https:\/\/api\.audius\.co/);
  assert.match(mediaPolicy, /https:\/\/\*\.audius\.co/);
  assert.ok(mediaPolicy.split(/\s+/).includes("https://validator.eeba4a6ca56a0d87af802270217c2a51.r2.cloudflarestorage.com"));
  assert.doesNotMatch(mediaPolicy, /https:\/\/\*\.r2\.cloudflarestorage\.com/);
  assert.doesNotMatch(mediaPolicy, /(?:^|\s)https:(?:\s|$)/);
  const scriptPolicy = (response.headers["content-security-policy-report-only"] as string).split(";").find(value => value.trim().startsWith("script-src"))!;
  assert.doesNotMatch(scriptPolicy, /cloudflarestorage\.com|'unsafe-inline'/);
  assert.doesNotMatch(connectionPolicy, /cloudflarestorage\.com/);
  assert.match(connectionPolicy, /https:\/\/browser-monitoring\.invalid/);
  assert.doesNotMatch(connectionPolicy, /server-monitoring|serverkey|browserkey/);
  for (const host of ["lydman.test", "legacy.test:8443"]) {
    const legacy = await read({ host, origin: `https://${host}`, "x-forwarded-proto": "https" });
    assert.equal(legacy.response.statusCode, 200);
    assert.ok((legacy.response.headers["content-security-policy-report-only"] as string).includes(`wss://${host}`));
    assert.equal((await read({ host, origin: `https://${host}` })).response.statusCode, 403, "An approved domain must still use HTTPS.");
  }
  assert.equal((await read({ host: "unlisted.test", origin: "https://lydman.test", "x-forwarded-proto": "https" })).response.statusCode, 403);
  const imagePolicy = (response.headers["content-security-policy-report-only"] as string).split(";").find(value => value.trim().startsWith("img-src"))!;
  assert.match(imagePolicy, /https:\/\/i\.scdn\.co/);
  assert.match(imagePolicy, /https:\/\/project\.supabase\.co\/storage\/v1\/object\//);
  assert.doesNotMatch(imagePolicy, /(?:^|\s)https:(?:\s|$)/, "An arbitrary HTTPS artwork host must not be allowed.");
  const rejected = await read({ origin: "https://evil.test" });
  assert.equal(rejected.response.statusCode, 403);
  assert.equal(rejected.response.headers["x-frame-options"], "DENY");
});

test("approved legacy domains support polling and WebSockets while enforcing Origin and namespace auth", async (t) => {
  const app = express();
  const policy = configureHttpSecurity(app, { ...production, APP_ORIGINS: "https://lydman.test", TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128" });
  const server = createServer(app);
  const io = new Server(server, { cors: { origin: policy.origin }, allowRequest: policy.allowRequest });
  io.engine.use((req: IncomingMessage, _res: ServerResponse, next: (error?: Error) => void) => policy.allowRequest(req, (error, ok) => ok ? next() : next(new Error(error || "Request denied."))));
  io.use((socket, next) => socket.handshake.auth.token === "local-fixture" ? next() : next(new Error("Authentication required.")));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => io.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { host: "soundspin.test", "x-forwarded-proto": "https", origin: "https://soundspin.test" };
  const polling = (query: string, requestHeaders: Record<string, string>) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = get(`${url}/socket.io/?${query}`, { headers: requestHeaders, timeout: 2500 }, response => {
      let body = ""; response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, body }));
    });
    request.on("error", reject).on("timeout", () => request.destroy(new Error("Polling fixture timed out.")));
  });
  const initial = await polling("EIO=4&transport=polling", headers);
  assert.equal(initial.status, 200);
  assert.equal((await polling("EIO=4&transport=polling", { ...headers, host: "lydman.test", origin: "https://lydman.test" })).status, 200);
  const invalidProtocol = await polling("EIO=4&transport=polling", { ...headers, "x-forwarded-proto": "wss" });
  assert.ok(invalidProtocol.status >= 400, "wss must not authorize an ordinary HTTP request.");
  const sid = JSON.parse(initial.body.slice(1)).sid;
  assert.ok(sid);
  const hostilePoll = await polling(`EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`, { ...headers, origin: "https://evil.test" });
  assert.ok(hostilePoll.status >= 400, "An existing SID must not skip the Origin guard.");
  async function connect(origin: string | undefined, token: string | undefined, forwardedProto = "wss", host = headers.host) {
    return await new Promise<boolean>(resolve => {
      const socket = clientSocket(url, { forceNew: true, reconnection: false, timeout: 2000, transports: ["websocket"],
        auth: { token }, extraHeaders: { host, "x-forwarded-proto": forwardedProto, ...(origin ? { origin } : {}) } });
      socket.once("connect", () => { socket.close(); resolve(true); });
      socket.once("connect_error", () => { socket.close(); resolve(false); });
    });
  }
  assert.equal(await connect("https://soundspin.test", "local-fixture"), true);
  assert.equal(await connect("https://soundspin.test", "local-fixture", "https"), true);
  assert.equal(await connect("https://lydman.test", "local-fixture", "wss", "lydman.test"), true);
  assert.equal(await connect("https://lydman.test", undefined, "wss", "lydman.test"), false);
  assert.equal(await connect("https://lydman.test", "local-fixture", "wss", "unlisted.test"), false);
  assert.equal(await connect("https://evil.test", "local-fixture"), false);
  assert.equal(await connect("https://soundspin.test", undefined), false);
  assert.equal(await connect(undefined, "local-fixture"), true, "Native clients still require namespace credentials.");
});
