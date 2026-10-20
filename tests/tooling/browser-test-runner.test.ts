import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserTestCommands, runBrowserTests } from "../../scripts/run-browser-tests.mjs";

test("browser test groups keep fixed configurations and forward Playwright filters", () => {
  const commands = browserTestCommands("behavior", ["--workers=2", "--grep", "permission", "--list"]);
  assert.deepEqual(commands.map(command => command[2]), [
    "--config=tests/config/playwright/features.config.ts", "--config=tests/config/playwright/playback.config.ts",
    "--config=tests/config/playwright/music.config.ts", "--config=tests/config/playwright/room-player.config.ts"
  ]);
  for (const command of commands) assert.deepEqual(command.slice(3), ["--workers=2", "--grep", "permission", "--list"]);
  assert.equal(browserTestCommands().length, 1);
  assert.throws(() => browserTestCommands("live"), /Unknown browser test group/);
  for (const argument of ["--config", "--config=tests/config/playwright/live.config.ts", "-c", "-c=tests/config/playwright/live.config.ts"])
    assert.throws(() => browserTestCommands("fixtures", [argument]), /configuration is fixed/);
});

test("browser runner strips real app settings, runs groups serially and stops on failure", async () => {
  const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
  let active = 0;
  const sourceEnvironment = {
    PATH: "/safe/bin", HOME: "/safe/home", CI: "1", NODE_ENV: "production",
    HTTP_PROXY: "http://managed-proxy.invalid", NODE_EXTRA_CA_CERTS: "/safe/ca.pem", PLAYWRIGHT_BROWSERS_PATH: "/safe/browsers",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-private-key", VITE_SUPABASE_URL: "https://live.invalid", SPOTIFY_CLIENT_SECRET: "synthetic-provider-key",
    APP_ORIGIN: "https://live.invalid", TRUSTED_PROXY_CIDRS: "0.0.0.0/0", NODE_OPTIONS: "--require=unsafe.cjs", PLAYWRIGHT_TEST_BASE_URL: "https://live.invalid"
  };
  const code = await runBrowserTests(["behavior", "--workers=1"], {
    sourceEnvironment,
    spawnChild: (_executable: string, args: string[], options: { env: Record<string, string> }) => {
      assert.equal(active, 0, "groups must not run concurrently"); active++;
      calls.push({ args, env: options.env });
      const child = new EventEmitter();
      queueMicrotask(() => { active--; child.emit("exit", calls.length === 2 ? 7 : 0, null); });
      return child;
    }
  });
  assert.equal(code, 7);
  assert.equal(calls.length, 2, "later suites must not run after a failed gate");
  for (const { env } of calls) {
    assert.equal(env.NODE_ENV, "test");
    assert.equal(env.CI, "1");
    assert.equal(env.HTTP_PROXY, sourceEnvironment.HTTP_PROXY);
    assert.equal(env.NODE_EXTRA_CA_CERTS, sourceEnvironment.NODE_EXTRA_CA_CERTS);
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, sourceEnvironment.PLAYWRIGHT_BROWSERS_PATH);
    for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_URL", "SPOTIFY_CLIENT_SECRET", "APP_ORIGIN", "TRUSTED_PROXY_CIDRS", "NODE_OPTIONS", "PLAYWRIGHT_TEST_BASE_URL"])
      assert.equal(Object.hasOwn(env, key), false, key);
  }
});

test("browser runner disables existing-server reuse when the caller has no CI setting", async () => {
  const code = await runBrowserTests(["music-qol", "--list"], {
    sourceEnvironment: { NODE_ENV: "production" },
    spawnChild: (_executable: string, _args: string[], options: { env: Record<string, string> }) => {
      assert.equal(options.env.CI, "1");
      assert.equal(options.env.NODE_ENV, "test");
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    }
  });
  assert.equal(code, 0);
});

test("every browser group spawns one worker by default and preserves explicit worker overrides", async () => {
  const groups = ["ui", "fixtures", "playback", "music-qol", "player-qol", "behavior"];
  const overrides = [["--workers=3"], ["--workers", "2"], ["-j", "2"], ["-j3"], ["-j=2"], ["--workers=25%"]];
  for (const group of groups) {
    for (const forwarded of [[], ...overrides]) {
      const calls: string[][] = [];
      const code = await runBrowserTests([group, ...forwarded, "--list"], {
        sourceEnvironment: {},
        spawnChild: (_executable: string, args: string[]) => {
          calls.push(args);
          const child = new EventEmitter();
          queueMicrotask(() => child.emit("exit", 0, null));
          return child;
        }
      });
      assert.equal(code, 0);
      assert.equal(calls.length, group === "behavior" ? 4 : 1);
      for (const args of calls) {
        assert.deepEqual(args.slice(3), forwarded.length ? [...forwarded, "--list"] : ["--workers=1", "--list"], group);
        assert.equal(args.filter(argument => argument === "--workers=1").length, forwarded.length ? 0 : 1, group);
      }
    }
  }
});
