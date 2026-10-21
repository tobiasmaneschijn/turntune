import { createHash } from "node:crypto";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function pushedImageDigest(repository, repoDigests) {
  if (typeof repository !== "string" || !Array.isArray(repoDigests)) throw new Error("Docker must return the pushed image's repository digests.");
  const prefix = `ghcr.io/${repository.toLowerCase()}@`;
  const matches = [...new Set(repoDigests.filter(image => typeof image === "string" && image.startsWith(prefix)))];
  if (matches.length !== 1) throw new Error("Docker must return exactly one digest for the published repository.");
  const digest = matches[0].slice(prefix.length);
  if (!digestPattern.test(digest)) throw new Error("The registry must return a SHA-256 image digest.");
  return digest;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function createImageManifest({ repository, branch, revision, digest, runId, runAttempt, root = process.cwd() }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) throw new Error("A GitHub repository is required.");
  if (!["develop", "master"].includes(branch)) throw new Error("Release images must come from develop or master.");
  if (!/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("A full Git commit SHA is required.");
  if (!digestPattern.test(digest ?? "")) throw new Error("The registry must return a SHA-256 image digest.");
  if (!/^[1-9][0-9]*$/.test(String(runId ?? ""))) throw new Error("A GitHub Actions run ID is required.");
  if (!/^[1-9][0-9]*$/.test(String(runAttempt ?? ""))) throw new Error("A GitHub Actions run attempt is required.");

  const directory = resolve(root, "supabase/migrations");
  const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.name.endsWith(".sql"));
  const migrations = [];
  const versions = new Set();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const match = /^(\d{14})_([A-Za-z0-9_]+)\.sql$/.exec(entry.name);
    if (!entry.isFile() || !match) throw new Error(`Invalid migration file: ${entry.name}`);
    const [, version, name] = match;
    if (versions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    versions.add(version);
    migrations.push({ version, name, sha256: await sha256(resolve(directory, entry.name)) });
  }
  if (!migrations.length) throw new Error("The release must include its migration history.");

  return {
    schemaVersion: 1,
    repository,
    branch,
    revision,
    image: `ghcr.io/${repository.toLowerCase()}@${digest}`,
    digest,
    runId: String(runId),
    runAttempt: String(runAttempt),
    lockfileSha256: await sha256(resolve(root, "package-lock.json")),
    migrations,
  };
}

async function main() {
  const [repoDigestsPath, outputPath = "release-image.json"] = process.argv.slice(2);
  if (!repoDigestsPath || process.argv.length > 4) throw new Error("Usage: node scripts/release/image-manifest.mjs <repo-digests.json> [release-image.json]");
  const repoDigests = JSON.parse(await readFile(repoDigestsPath, "utf8"));
  const manifest = await createImageManifest({
    repository: process.env.GITHUB_REPOSITORY,
    branch: process.env.GITHUB_REF_NAME,
    revision: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    digest: pushedImageDigest(process.env.GITHUB_REPOSITORY, repoDigests),
  });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `image=${manifest.image}\ndigest=${manifest.digest}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Release image\n\nRevision: \`${manifest.revision}\` (${manifest.branch})\n\nImage: \`${manifest.image}\`\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
