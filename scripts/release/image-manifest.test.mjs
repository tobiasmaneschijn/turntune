import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createImageManifest, pushedImageDigest } from "./image-manifest.mjs";

const release = { repository: "Example/SoundSpin", branch: "develop", revision: "a".repeat(40), digest: `sha256:${"b".repeat(64)}`, runId: "12345", runAttempt: "2" };
const hash = value => createHash("sha256").update(value).digest("hex");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "soundspin-image-manifest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "supabase/migrations"), { recursive: true });
  await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(join(root, "supabase/migrations/20261001090000_create_rooms.sql"), "create table rooms (id integer);\n");
  return root;
}

test("Publishing a release records the registry digest, exact lockfile and ordered migration history", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "supabase/migrations/20261002090000_create_tracks.sql"), "create table tracks (id integer);\n");
  const manifest = await createImageManifest({ ...release, root });
  assert.equal(pushedImageDigest(release.repository, [manifest.image]), release.digest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.image, `ghcr.io/example/soundspin@${release.digest}`);
  assert.equal(manifest.revision, release.revision);
  assert.equal(manifest.runId, release.runId);
  assert.equal(manifest.runAttempt, release.runAttempt);
  assert.equal(manifest.lockfileSha256, hash('{"lockfileVersion":3}\n'));
  assert.deepEqual(manifest.migrations, [
    { version: "20261001090000", name: "create_rooms", sha256: hash("create table rooms (id integer);\n") },
    { version: "20261002090000", name: "create_tracks", sha256: hash("create table tracks (id integer);\n") },
  ]);
});

test("Publishing refuses a mutable image reference or ambiguous migration history", async t => {
  const root = await fixture(t);
  await assert.rejects(createImageManifest({ ...release, root, digest: "latest" }), /image digest/);
  assert.throws(() => pushedImageDigest(release.repository, [`ghcr.io/other/repository@${release.digest}`]), /published repository/);
  assert.throws(() => pushedImageDigest(release.repository, [`ghcr.io/example/soundspin@${release.digest}`, `ghcr.io/example/soundspin@sha256:${"c".repeat(64)}`]), /exactly one digest/);
  await assert.rejects(createImageManifest({ ...release, root, branch: "feature" }), /develop or master/);
  await assert.rejects(createImageManifest({ ...release, root, runAttempt: "0" }), /run attempt/);
  await writeFile(join(root, "supabase/migrations/20261001090000_other_name.sql"), "select 1;\n");
  await assert.rejects(createImageManifest({ ...release, root }), /Duplicate migration version/);
});
