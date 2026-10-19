import { spawn } from "node:child_process";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testEnvironment } from "./test-environment.mjs";
export { testEnvironment } from "./test-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const groups = Object.freeze({
  all: ["server/**/*.test.ts", "tests/*.test.ts"],
  sql: ["tests/*-rls.test.mjs", "tests/sql/check-chat-rls.mjs"],
  signup: ["server/features/auth/invite-signup.test.ts", "server/features/auth/signup-routes.test.ts"],
  chat: ["tests/chat-*.test.ts", "server/features/chat/chat-*.test.ts"],
  feedback: ["tests/feedback-*.test.ts", "server/features/admin/admin-routes.test.ts"],
  giphy: ["server/integrations/giphy.test.ts", "server/integrations/provider-http.test.ts"],
  radio: ["server/features/rooms/radio*.test.ts", "server/persistence/store.test.ts"],
  soundcloud: ["server/integrations/soundcloud.test.ts", "server/integrations/provider-http.test.ts"],
  music: ["server/features/music/music*.test.ts", "server/integrations/spotify/spotify-*.test.ts", "server/features/music/provider-*.test.ts", "server/integrations/provider-*.test.ts", "server/features/music/saved-set.test.ts", "server/features/rooms/room-music-policy.test.ts"],
  playback: ["tests/playback-*.test.ts", "tests/player-api-loader.test.ts"],
  integration: ["tests/server-integration.test.ts", "tests/socket-auth-integration.test.ts"],
  production: ["tests/production-entrypoint-smoke.mjs"]
});

export function testArguments(group = "all") {
  if (!Object.hasOwn(groups, group)) throw new Error(`Unknown test group: ${group}`);
  const files = [...new Set(groups[group].flatMap(pattern => globSync(pattern, { cwd: root })))].sort();
  if (!files.length) throw new Error(`No test files were found for ${group}.`);
  const plainJs = group === "sql" || group === "production";
  // Integration fixtures spawn isolated application processes as well as a test
  // worker; two workers keep cold imports and password hashing inside deadlines.
  const concurrency = group === "production" ? 1 : ["all", "sql", "integration"].includes(group) ? 2 : 4;
  return [...(plainJs ? [] : ["--import", "tsx"]), "--test", `--test-concurrency=${concurrency}`, ...files];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error("Usage: node scripts/run-tests.mjs [all|sql|signup|chat|feedback|giphy|radio|soundcloud|music|playback|integration|production]");
  const child = spawn(process.execPath, testArguments(process.argv[2] ?? "all"), { cwd: root, env: testEnvironment(), stdio: "inherit" });
  child.once("error", error => { console.error("Could not start the test runner:", error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { child.kill(signal); });
}
