import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scanner = process.env.GITLEAKS_BIN || "gitleaks";
const shared = ["--redact", "--no-banner", "--ignore-gitleaks-allow", "--timeout=120"];
// Generic account passwords can escape pattern scanners. Keep local environment
// files out of the source inventory even when someone force-adds an ignored file.
const publishedEnvironmentFiles = new Set([".env.example"]);
function unexpectedEnvironmentFiles(files) {
  return files.filter(file => /(?:^|\/)\.env[^/]*$/.test(file) && !publishedEnvironmentFiles.has(file));
}
function run(args, input) {
  const result = spawnSync(scanner, args, { input, encoding: "utf8", timeout: 130_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw new Error(`Gitleaks could not run. Install the checksum-pinned version used by CI. ${result.error.message}`);
  return result;
}
if (process.argv.includes("--self-test")) {
  assert.deepEqual(unexpectedEnvironmentFiles([".env.example", "server/lib/config.ts"]), []);
  assert.deepEqual(unexpectedEnvironmentFiles([".env", ".env.test", ".env.test-users.local", "nested/.env.local"]),
    [".env", ".env.test", ".env.test-users.local", "nested/.env.local"], "Local environment files must be rejected even without a recognized credential pattern.");
  // Construct a well-known NONVALID credential shape in memory; never commit a key.
  const fixture = `github_token = ghp_${"aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2"}\n`;
  const detected = run(["stdin", ...shared], fixture);
  assert.equal(detected.status, 1, "Synthetic credential must make Gitleaks fail.");
  assert.equal(run(["stdin", ...shared], "ordinary nonsecret text\n").status, 0);
  // A staged file is still publishable after its working copy is removed.
  // Reject it before pattern scanning, even when its value looks harmless.
  const fixtureRoot = path.resolve("work");
  mkdirSync(fixtureRoot, { recursive: true });
  const stagedFixture = mkdtempSync(path.join(fixtureRoot, "secret-index-selftest-"));
  try {
    const git = args => spawnSync("git", args, { cwd: stagedFixture, encoding: "utf8" });
    assert.equal(git(["init", "--quiet"]).status, 0, "Cannot create the isolated staging fixture.");
    const localEnvironment = path.join(stagedFixture, ".env.local");
    writeFileSync(localEnvironment, "EXAMPLE_VALUE=synthetic\n");
    assert.equal(git(["add", "--force", ".env.local"]).status, 0, "Cannot stage the synthetic environment file.");
    unlinkSync(localEnvironment);
    const rejected = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: stagedFixture, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, GITLEAKS_BIN: path.join(stagedFixture, "scanner-must-not-run") }
    });
    assert.equal(rejected.status, 1, "Staged local environment files must fail validation after working-copy deletion.");
    assert.match(rejected.stderr, /Local environment files must not be published: \.env\.local/);
  } finally {
    assert.equal(path.dirname(stagedFixture), fixtureRoot);
    assert.ok(path.basename(stagedFixture).startsWith("secret-index-selftest-"));
    rmSync(stagedFixture, { recursive: true, force: true });
  }
  console.log("Secret scanner failure-path self-test passed.");
} else {
  const files = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(files.status, 0, "Cannot inventory working files.");
  const sourceFiles = files.stdout.split("\0").filter(Boolean);
  const unexpected = unexpectedEnvironmentFiles(sourceFiles);
  assert.equal(unexpected.length, 0, `Local environment files must not be published: ${unexpected.join(", ")}`);
  // Complete available history, then unstaged diff and every tracked/untracked
  // non-ignored working file. Ignored env files are private local configuration.
  const history = run(["git", ...shared, "--log-opts=--all", "."]);
  process.stdout.write(history.stdout); process.stderr.write(history.stderr);
  assert.equal(history.status, 0, "Secret detected in Git history or history scan failed.");
  mkdirSync("work", { recursive: true });
  const scanDirectory = mkdtempSync(path.resolve("work", "secret-scan-"));
  try {
    for (const file of sourceFiles) {
      let stat;
      try { stat = lstatSync(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      // A Git symlink stores a path; do not follow it into unrelated credentials.
      if (stat.isSymbolicLink()) continue;
      assert.ok(stat.isFile() && !path.isAbsolute(file) && !file.split(/[\\/]/).includes(".."), "Unexpected source inventory entry.");
      const destination = path.join(scanDirectory, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(file, destination);
    }
    const working = run(["dir", ...shared, scanDirectory]);
    process.stdout.write(working.stdout); process.stderr.write(working.stderr);
    assert.equal(working.status, 0, "Secret detected in working files or working scan failed.");
  } finally {
    assert.ok(path.basename(scanDirectory).startsWith("secret-scan-"));
    rmSync(scanDirectory, { recursive: true, force: true });
  }
}
