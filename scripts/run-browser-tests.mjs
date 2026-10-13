import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testEnvironment } from "./test-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const playwright = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const groups = {
  ui: ["playwright.config.ts"],
  fixtures: ["playwright.fixtures.config.ts"],
  playback: ["playwright.playback.config.ts"],
  "music-qol": ["playwright.music-qol.config.ts"],
  "player-qol": ["playwright.player-qol.config.ts"],
  behavior: ["playwright.fixtures-behavior.config.ts", "playwright.playback.config.ts", "playwright.music-qol.config.ts", "playwright.player-qol.config.ts"],
  visual: ["playwright.config.ts", "playwright.fixtures-visual.config.ts"]
};

/** Keep local browser suites on their fixed fixture configurations. Ordinary
 * Playwright options, including --list, --workers and --grep, pass through. */
export function browserTestCommands(group = "ui", forwarded = []) {
  if (!Object.hasOwn(groups, group)) throw new Error(`Unknown browser test group. Choose ${Object.keys(groups).join(", ")}.`);
  if (forwarded.some(argument => argument === "--config" || argument.startsWith("--config=") || argument.startsWith("-c")))
    throw new Error("Browser configuration is fixed by the selected test group. Use test:ui:live separately for an explicitly authorized live test.");
  // Playwright defaults to half the host's logical CPUs even in CI, which can
  // greatly exceed a container's CPU budget. Explicit caller choices win.
  const workerArguments = forwarded.some(argument => argument === "--workers" || argument.startsWith("--workers=") || argument.startsWith("-j")) ? [] : ["--workers=1"];
  return groups[group].map(config => [playwright, "test", `--config=${config}`, ...workerArguments, ...forwarded]);
}

export async function runBrowserTests(argv = process.argv.slice(2), options = {}) {
  const [group = "ui", ...forwarded] = argv;
  const commands = browserTestCommands(group, forwarded);
  const source = options.sourceEnvironment || process.env;
  const env = testEnvironment(source);
  // The configs disable web-server reuse in CI. Always start the isolated
  // fixture server rather than trusting an unrelated process on the same port.
  if (!env.CI) env.CI = "1";
  // Browser binaries may live outside the repository in managed CI. No
  // application key, Node injection option or arbitrary PLAYWRIGHT_* setting
  // is inherited alongside this one installation path.
  if (source.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = source.PLAYWRIGHT_BROWSERS_PATH;
  const spawnChild = options.spawnChild || spawn;
  let current;
  let interrupted;
  const interrupt = signal => { interrupted = signal; current?.kill(signal); };
  const sigint = () => interrupt("SIGINT");
  const sigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", sigint);
  process.once("SIGTERM", sigterm);
  try {
    for (const args of commands) {
      if (interrupted) return interrupted === "SIGINT" ? 130 : 143;
      const code = await new Promise(resolve => {
        current = spawnChild(process.execPath, args, { cwd: root, env, stdio: "inherit" });
        current.once("error", () => { console.error("Could not start the browser test runner."); resolve(1); });
        current.once("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
      });
      current = undefined;
      if (interrupted) return interrupted === "SIGINT" ? 130 : 143;
      if (code !== 0) return code;
    }
    return 0;
  } finally {
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runBrowserTests(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Browser test setup failed."); process.exitCode = 1; }
}
