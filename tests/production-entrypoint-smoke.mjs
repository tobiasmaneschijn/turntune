import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Run after npm run build. Starting plain Node from an unrelated directory
// verifies the packaged imports/static paths, rather than the source/tsx path.
test("the compiled production entrypoint serves the SPA, assets and readiness", { timeout: 20_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const entrypoint = path.join(root, "dist-server/server/index.js");
  const publicDirectory = path.join(root, "dist");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.start, "node dist-server/server/index.js");
  await readFile(entrypoint);
  await readFile(path.join(root, "dist-server/shared/room-protocol.js"));
  const expectedHtml = await readFile(path.join(publicDirectory, "index.html"), "utf8");
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-production-smoke-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(SUPABASE_|VITE_|SPOTIFY_|SOUNDCLOUD_|APPLE_MUSIC_|PROVIDER_TOKEN_|SIGNUP_|YOUTUBE_|GIPHY_)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  Object.assign(env, {
    NODE_ENV: "production", PORT: "0", HOST: "127.0.0.1", DATA_DIR: directory,
    SUPABASE_URL: "https://soundspin-production-smoke.invalid",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_production_smoke_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_production_smoke_fixture",
    SUPABASE_JWKS_URL: "https://soundspin-production-smoke.invalid/auth/v1/.well-known/jwks.json"
  });
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
    const timer = setTimeout(() => reject(new Error(`The compiled server did not start. ${errors}`)), 8_000);
    server.stdout.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/Lydman listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", code => { clearTimeout(timer); reject(new Error(`The compiled server exited (${code}). ${errors}`)); });
  });
  const get = pathname => fetch(`${url}${pathname}`, { signal: AbortSignal.timeout(5_000) });
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
  for (const revision of ["", "&EIO=3"]) {
    await new Promise((resolve, reject) => {
      const client = new WebSocket(`${url.replace("http:", "ws:")}/socket.io/?transport=websocket&sid=${encodeURIComponent(sid)}${revision}`);
      const timer = setTimeout(() => { client.close(); reject(new Error("A mismatched upgrade was not rejected in time.")); }, 2_000);
      client.addEventListener("error", () => { clearTimeout(timer); resolve(); }, { once: true });
      client.addEventListener("open", () => { clearTimeout(timer); client.close(); reject(new Error("A mismatched Engine.IO protocol upgraded an existing session.")); }, { once: true });
    });
  }
  assert.equal((await get("/api/health")).status, 200);
  assert.equal((await get("/api/ready")).status, 200);
  const missingApi = await get("/api/not-a-real-endpoint");
  assert.equal(missingApi.status, 404);
  assert.match(missingApi.headers.get("Content-Type") || "", /application\/json/);
  assert.ok((await missingApi.json()).error);
  assert.doesNotMatch(errors, /blocked an unexpected outbound request/);
});
