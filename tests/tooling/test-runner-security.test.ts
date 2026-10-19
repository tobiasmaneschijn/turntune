import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { testArguments, testEnvironment } from "../../scripts/run-tests.mjs";

test("the launched test process receives no application credentials or production settings", () => {
  for (const name of Object.keys(process.env)) {
    assert.ok(!/^(?:SUPABASE_|VITE_|SPOTIFY_|SOUNDCLOUD_|APPLE_MUSIC_|GIPHY_|YOUTUBE_|MIXCLOUD_|SIGNUP_|APP_ORIGIN$|TRUST_PROXY$|TRUSTED_PROXY_CIDRS$|PORT$|HOST$|NODE_OPTIONS$)/.test(name), `Unexpected inherited application setting: ${name}`);
  }
  assert.equal(process.env.NODE_ENV, "test");
});

test("every focused test group uses fixed local fixtures and production smoke uses compiled JavaScript", () => {
  for (const group of ["all", "sql", "signup", "chat", "feedback", "giphy", "radio", "soundcloud", "music", "playback", "integration", "production"]) {
    const args = testArguments(group);
    assert.ok(args.includes("--test"));
    assert.ok(args.some(value => value.startsWith("--test-concurrency=")));
    assert.ok(args.some(value => /\.test\.ts$|\.mjs$/.test(value)));
    assert.equal(args.includes("tsx"), group !== "sql" && group !== "production");
  }
  assert.ok(testArguments("signup").map(path => path.replaceAll("\\", "/")).includes("server/features/auth/signup-routes.test.ts"));
  assert.ok(testArguments("integration").map(path => path.replaceAll("\\", "/")).includes("tests/integration/auth/socket-auth-integration.test.ts"));
  assert.deepEqual(testArguments("production").map(path => path.replaceAll("\\", "/")), ["--test", "--test-concurrency=1", "tests/integration/production/production-entrypoint-smoke.mjs"]);
});

test("test environment strips application credentials and runtime injection while preserving network trust", () => {
  const source = {
    SUPABASE_URL: "https://credential.invalid", SUPABASE_ANON_KEY: "sentinel", SUPABASE_SERVICE_ROLE_KEY: "sentinel",
    VITE_SUPABASE_URL: "https://credential.invalid", VITE_SUPABASE_ANON_KEY: "sentinel", SPOTIFY_CLIENT_ID: "sentinel",
    SPOTIFY_CLIENT_SECRET: "sentinel", SPOTIFY_REDIRECT_URI: "https://credential.invalid", SOUNDCLOUD_CLIENT_ID: "sentinel",
    SOUNDCLOUD_CLIENT_SECRET: "sentinel", APPLE_MUSIC_PRIVATE_KEY: "sentinel", GIPHY_API_KEY: "sentinel",
    SIGNUP_INVITE_PASSWORD: "sentinel", APP_ORIGIN: "https://credential.invalid", TRUST_PROXY: "true",
    TRUSTED_PROXY_CIDRS: "0.0.0.0/0", PORT: "9999", HOST: "0.0.0.0", NODE_ENV: "production",
    NODE_OPTIONS: "--require=/missing/credential-injection.cjs", UNEXPECTED_PRIVATE_KEY: "sentinel",
    PATH: "/safe/bin", HTTP_PROXY: "http://proxy.test", HTTPS_PROXY: "http://proxy.test", NO_PROXY: "localhost",
    NODE_EXTRA_CA_CERTS: "/safe/ca.pem", SSL_CERT_FILE: "/safe/ca.pem", LANG: "en_US.UTF-8"
  };
  assert.deepEqual(testEnvironment(source), {
    PATH: "/safe/bin", HTTP_PROXY: "http://proxy.test", HTTPS_PROXY: "http://proxy.test", NO_PROXY: "localhost",
    NODE_EXTRA_CA_CERTS: "/safe/ca.pem", SSL_CERT_FILE: "/safe/ca.pem", LANG: "en_US.UTF-8", NODE_ENV: "test"
  });
});

test("unknown test groups fail before spawning fixtures", () => {
  assert.throws(() => testArguments("production-with-live-creds"), /Unknown test group/);
  const result = spawnSync(process.execPath, ["scripts/run-tests.mjs", "production-with-live-creds"], {
    cwd: new URL("../../", import.meta.url), env: testEnvironment(), encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown test group/);
});

test("Windows process paths survive without admitting differently cased application secrets", () => {
  assert.deepEqual(testEnvironment({ Path: "C:/safe/bin", SystemRoot: "C:/Windows", windir: "C:/Windows", ComSpec: "C:/Windows/cmd.exe", supabase_service_role_key: "sentinel", Node_Options: "--require=secret" }), {
    Path: "C:/safe/bin", SystemRoot: "C:/Windows", windir: "C:/Windows", ComSpec: "C:/Windows/cmd.exe", NODE_ENV: "test"
  });
});
