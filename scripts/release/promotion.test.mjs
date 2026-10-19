import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPromotion, verifyStagingRun } from './promotion.mjs';

const repository = 'owner/SoundSpin';
const sha = 'a'.repeat(40);
const stagingSha = 'b'.repeat(40);
const treeSha = 'c'.repeat(40);
const stagingRunUrl = `https://github.com/${repository}/actions/runs/123`;

function fixture() {
  const run = { id: 123, run_attempt: 2, head_sha: stagingSha, status: 'completed', conclusion: 'success',
    event: 'workflow_dispatch', head_branch: 'develop', path: '.github/workflows/deploy.yml',
    repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [] };
  const job = { name: 'Deploy staging', run_id: run.id, head_sha: stagingSha,
    status: 'completed', conclusion: 'success' };
  const manifest = { schemaVersion: 1, repository, branch: 'develop', revision: stagingSha,
    runId: String(run.id), runAttempt: String(run.run_attempt),
    digest: `sha256:${'d'.repeat(64)}`, lockfileSha256: 'e'.repeat(64),
    migrations: [{ version: '20261001090000', name: 'rooms', sha256: 'f'.repeat(64) }] };
  manifest.image = `ghcr.io/${repository.toLowerCase()}@${manifest.digest}`;
  const evidence = { schemaVersion: 1, environment: 'staging', githubRunId: String(run.id),
    githubRunAttempt: String(run.run_attempt),
    revision: stagingSha, imageRevision: stagingSha, image: manifest.image, digest: manifest.digest,
    manifest, migrations: structuredClone(manifest.migrations), verified: true,
    checks: { singleInstance: true, health: true, ready: true, socketPolling: true,
      websocketUpgrade: true, hostileOrigin: true, missingCredential: true } };
  const commits = {
    [sha]: { sha, commit: { tree: { sha: treeSha } } },
    [stagingSha]: { sha: stagingSha, commit: { tree: { sha: treeSha } } },
  };
  const requests = [];
  let artifactReads = 0;
  const github = { async request(route, parameters) {
    requests.push({ route, parameters });
    assert.equal(parameters.owner, 'owner');
    assert.equal(parameters.repo, 'SoundSpin');
    if (route.endsWith('/actions/runs/{run_id}')) return { data: run };
    if (route.endsWith('/jobs')) return { data: { jobs: [job] } };
    if (route.endsWith('/commits/{ref}')) return { data: commits[parameters.ref] };
    throw new Error('Unexpected request.');
  } };
  const args = { github, repository, sha, stagingRunUrl,
    async loadArtifact(runId, name) {
      artifactReads += 1;
      assert.equal(runId, run.id);
      assert.equal(name, 'deployment-evidence');
      return { 'deployment-evidence.json': evidence };
    } };
  return { run, job, manifest, evidence, commits, requests, args,
    artifactReads: () => artifactReads, verify: (overrides = {}) => verifyPromotion({ ...args, ...overrides }) };
}

test('production promotes the exact staged digest when a merge commit preserves the tested source tree', async () => {
  const release = fixture();
  const promoted = await release.verify();
  assert.strictEqual(promoted.manifest, release.manifest);
  assert.equal(promoted.manifest.image, release.evidence.image);
  assert.equal(promoted.manifest.revision, stagingSha);
  assert.equal(promoted.treeSha, treeSha);
  assert.equal(promoted.stagingRun.id, 123);
  assert.equal(promoted.stagingRun.attempt, 2);
  assert.equal(release.artifactReads(), 1);
});

test('an operator cannot select another repository or an arbitrary artifact URL', async () => {
  for (const invalidUrl of [
    'https://example.com/owner/SoundSpin/actions/runs/123',
    'https://github.com/other/SoundSpin/actions/runs/123',
    `${stagingRunUrl}?artifact=other`, `${stagingRunUrl}#artifact`,
    `https://github.com@evil.example/${repository}/actions/runs/123`,
  ]) {
    const release = fixture();
    await assert.rejects(release.verify({ stagingRunUrl: invalidUrl }), { code: 'STAGING_RUN_URL' });
    assert.equal(release.requests.length, 0);
    assert.equal(release.artifactReads(), 0);
  }
});

test('failed, pull request or unrelated workflow runs cannot supply staging promotion artifacts', async () => {
  for (const invalid of [
    { conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' },
    { head_branch: 'master' }, { path: '.github/workflows/ci.yml' },
    { head_repository: { full_name: 'someone/fork' } }, { pull_requests: [{ number: 1 }] },
    { run_attempt: 0 },
  ]) {
    const release = fixture();
    Object.assign(release.run, invalid);
    await assert.rejects(release.verify(), { code: 'STAGING_RUN_UNTRUSTED' });
    assert.equal(release.artifactReads(), 0);
  }
});

test('a green workflow with a skipped deployment cannot authorize promotion', async () => {
  const release = fixture();
  release.job.conclusion = 'skipped';
  await assert.rejects(verifyStagingRun(release.args), { code: 'STAGING_JOB_MISSING' });
  assert.equal(release.artifactReads(), 0);
});

test('production rejects substituted images, another run and incomplete hosted verification', async () => {
  for (const alter of [
    evidence => { evidence.githubRunId = '456'; },
    evidence => { evidence.manifest.runId = '456'; },
    evidence => { evidence.image = 'ghcr.io/owner/soundspin:latest'; },
    evidence => { evidence.manifest.repository = 'other/SoundSpin'; },
    evidence => { evidence.imageRevision = sha; },
    evidence => { evidence.verified = false; },
    evidence => { evidence.checks.websocketUpgrade = false; },
    evidence => { evidence.migrations = []; },
  ]) {
    const release = fixture();
    alter(release.evidence);
    await assert.rejects(release.verify(), { code: 'STAGING_EVIDENCE_INVALID' });
  }
});

test('production must return to staging when its source differs from the tested image', async () => {
  const release = fixture();
  release.commits[sha].commit.tree.sha = '9'.repeat(40);
  await assert.rejects(release.verify(), { code: 'PROMOTION_SOURCE_MISMATCH' });
});

test('rerunning staging cannot promote evidence or a manifest left by an earlier attempt', async () => {
  const release = fixture();
  release.evidence.githubRunAttempt = '1';
  await assert.rejects(release.verify(), { code: 'STAGING_EVIDENCE_INVALID' });
  release.evidence.githubRunAttempt = '2';
  release.manifest.runAttempt = '1';
  await assert.rejects(release.verify(), { code: 'STAGING_EVIDENCE_INVALID' });
  release.manifest.runAttempt = '02';
  await assert.rejects(release.verify(), { code: 'STAGING_EVIDENCE_INVALID' });
  release.manifest.runAttempt = '2';
  assert.equal((await release.verify()).stagingRun.attempt, 2);
});

test('missing artifacts and unavailable source evidence leave promotion blocked', async () => {
  const release = fixture();
  await assert.rejects(release.verify({ loadArtifact: async () => ({}) }), { code: 'STAGING_EVIDENCE_INVALID' });
  await assert.rejects(release.verify({ loadArtifact: async () => { throw new Error('expired'); } }),
    { code: 'STAGING_EVIDENCE_MISSING' });
  await assert.rejects(release.verify({ github: async () => { throw new Error('unavailable'); } }),
    { code: 'PROMOTION_API' });
});
