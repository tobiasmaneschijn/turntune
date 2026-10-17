import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { WebSocket } from "ws";
import { generateKeyPairSync } from "node:crypto";

function isolatedProductionEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(SUPABASE_|VITE_|SPOTIFY_|SOUNDCLOUD_|APPLE_MUSIC_|PROVIDER_TOKEN_|SIGNUP_|YOUTUBE_|GIPHY_)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  return { ...env, NODE_ENV: "production", PORT: "0", HOST: "127.0.0.1",
    APP_ORIGIN: "https://soundspin.test", TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
    SUPABASE_URL: "https://soundspin-production-smoke.invalid",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_production_smoke_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_production_smoke_fixture",
    SUPABASE_JWKS_URL: "https://soundspin-production-smoke.invalid/auth/v1/.well-known/jwks.json",
    ...overrides };
}

// Run after npm run build. Starting plain Node from an unrelated directory
// verifies the packaged imports/static paths, rather than the source/tsx path.
test("the compiled production entrypoint serves the SPA, assets and readiness", { timeout: 30_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const entrypoint = path.join(root, "dist-server/server/start-production.js");
  const publicDirectory = path.join(root, "dist");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.start, "node dist-server/server/start-production.js");
  await readFile(entrypoint);
  await readFile(path.join(root, "dist-server/shared/room-protocol.js"));
  const expectedHtml = await readFile(path.join(publicDirectory, "index.html"), "utf8");
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-production-smoke-"));
  const env = isolatedProductionEnvironment({ DATA_DIR: directory });
  const fixture = new URL("./production-network-fixture.mjs", import.meta.url).href;
  const server = spawn(process.execPath, ["--import", fixture, entrypoint], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  let errors = "";
  server.stderr.on("data", chunk => { errors += chunk.toString(); });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("soundspin-production-smoke-"));
    await rm(directory, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`The compiled server did not start. ${errors}`)), 15_000);
    server.stdout.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/Lydman listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", code => { clearTimeout(timer); reject(new Error(`The compiled server exited (${code}). ${errors}`)); });
  });
  // Undici overrides Host, so use node:http to reproduce the explicit trusted
  // reverse-proxy ingress instead of bypassing production origin/TLS checks.
  const ingressHeaders = { Host: "soundspin.test", "X-Forwarded-Proto": "https" };
  const get = (pathname, extraHeaders = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(`${url}${pathname}`, { headers: { ...ingressHeaders, ...extraHeaders }, signal: AbortSignal.timeout(5_000) }, incoming => {
      const chunks = [];
      incoming.on("data", chunk => chunks.push(chunk));
      incoming.once("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers }));
      });
      incoming.once("error", reject);
    });
    request.once("error", reject); request.end();
  });
  const home = await get("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("Content-Type") || "", /text\/html/);
  assert.equal(await home.text(), expectedHtml);
  const room = await get("/room/production-smoke");
  assert.equal(room.status, 200);
  assert.equal(await room.text(), expectedHtml);

  const assets = [...expectedHtml.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(assets.some(asset => asset.endsWith(".js")), "The built page must load a bundled script.");
  for (const asset of new Set(assets)) {
    const response = await get(asset);
    assert.equal(response.status, 200, `The compiled server must serve ${asset}.`);
    assert.match(response.headers.get("Content-Type") || "", asset.endsWith(".js") ? /javascript/ : /text\/css/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path.join(publicDirectory, asset.slice(1))));
  }
  // Upgrade requests must keep the protocol of their existing polling session.
  // The omitted EIO case is the default-protocol bypass in GHSA-2gc4-cqfq-p2gv.
  const polling = await get("/socket.io/?EIO=4&transport=polling");
  const packet = await polling.text();
  assert.equal(polling.status, 200); assert.equal(packet[0], "0");
  const { sid } = JSON.parse(packet.slice(1));
  const openUpgrade = (revision, shouldOpen) => new Promise((resolve, reject) => {
    const client = new WebSocket(`${url.replace("http:", "ws:")}/socket.io/?transport=websocket&sid=${encodeURIComponent(sid)}${revision}`, {
      headers: { ...ingressHeaders, Origin: "https://soundspin.test" }
    });
    const timer = setTimeout(() => { client.terminate(); reject(new Error("Engine.IO upgrade did not settle in time.")); }, 2_000);
    client.once("error", () => { clearTimeout(timer); if (shouldOpen) reject(new Error("The valid Engine.IO upgrade was rejected.")); else resolve(); });
    client.once("open", () => {
      if (!shouldOpen) { clearTimeout(timer); client.close(); reject(new Error("A mismatched Engine.IO protocol upgraded an existing session.")); return; }
      client.send("2probe");
    });
    client.on("message", value => {
      if (shouldOpen && value.toString() === "3probe") { clearTimeout(timer); client.send("5"); client.close(); resolve(); }
    });
  });
  for (const revision of ["", "&EIO=3"]) await openUpgrade(revision, false);
  await openUpgrade("&EIO=4", true);
  // These negative ingress controls accompany the valid case above, so a
  // blanket denial of socket/static requests cannot make the smoke test pass.
  assert.equal((await get("/", { Host: "wrong.test" })).status, 403);
  assert.equal((await get("/", { "X-Forwarded-Proto": "http" })).status, 403);
  assert.equal((await get("/", { Origin: "https://attacker.invalid" })).status, 403);
  assert.ok(home.headers.get("Content-Security-Policy")?.includes("object-src 'none'"));
  assert.equal(home.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal((await get("/api/health")).status, 200);
  assert.equal((await get("/api/ready")).status, 200);
  const missingApi = await get("/api/not-a-real-endpoint");
  assert.equal(missingApi.status, 401);
  assert.match(missingApi.headers.get("Content-Type") || "", /application\/json/);
  assert.ok((await missingApi.json()).error);
  assert.doesNotMatch(errors, /blocked an unexpected outbound request/);
});

test("the packaged start rejects an inherited inline JWKS override before listening", { timeout: 20_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const inlineJwks = JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "inline-startup-fixture", alg: "RS256" }] });
  // This is the same otherwise valid configuration proven by the positive
  // smoke case. A real ephemeral key models a leftover test/development key.
  const env = isolatedProductionEnvironment({ SUPABASE_JWKS: inlineJwks });
  const fixture = new URL("./production-network-fixture.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", fixture, path.join(root, "dist-server/server/start-production.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data.toString(); });
  child.stderr.on("data", data => { stderr += data.toString(); });
  let code;
  try { [code] = await once(child, "exit", { signal: AbortSignal.timeout(15_000) }); }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      const terminated = once(child, "exit"); child.kill("SIGKILL"); await terminated;
    }
  }
  assert.notEqual(code, 0);
  assert.doesNotMatch(stdout, /listening on/i);
  assert.match(stderr, /SUPABASE_JWKS/);
  assert.doesNotMatch(stderr, /blocked an unexpected outbound request/);
  assert.ok(!stderr.includes(inlineJwks), "Startup errors must not print the inherited key material.");
});


for (const inheritedEnvironment of [undefined, "development"]) test(`the packaged start fails before listening without credentials (inherited NODE_ENV=${inheritedEnvironment ?? "unset"})`, { timeout: 20_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const env = { ...process.env, APP_ORIGIN: "https://soundspin.test", PORT: "0", HOST: "127.0.0.1" };
  for (const key of Object.keys(env)) if (/^(SUPABASE_|VITE_|SPOTIFY_|SOUNDCLOUD_|APPLE_MUSIC_|PROVIDER_|SIGNUP_|YOUTUBE_|GIPHY_)/.test(key)) delete env[key];
  delete env.NODE_OPTIONS;
  if (inheritedEnvironment) env.NODE_ENV = inheritedEnvironment;
  else delete env.NODE_ENV;
  const child = spawn(process.execPath, [path.join(root, "dist-server/server/start-production.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data.toString(); });
  child.stderr.on("data", data => { stderr += data.toString(); });
  let code;
  try { [code] = await once(child, "exit", { signal: AbortSignal.timeout(15_000) }); }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      const terminated = once(child, "exit"); child.kill("SIGKILL"); await terminated;
    }
  }
  assert.notEqual(code, 0);
  assert.doesNotMatch(stdout, /listening on/i);
  assert.match(stderr, /production|SUPABASE|configuration/i);
});
