import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverStagingRun, verifyPromotion, verifyStagingRun } from './promotion.mjs';

const repository = 'owner/turntune';
const sha = 'a'.repeat(40);
const stagingSha = 'b'.repeat(40);
const treeSha = 'c'.repeat(40);
const stagingRunUrl = `https://github.com/${repository}/actions/runs/123`;

function fixture() {
  const run = { id: 123, run_attempt: 2, head_sha: stagingSha, status: 'completed', conclusion: 'success',
    event: 'workflow_dispatch', head_branch: 'develop', path: '.github/workflows/deploy.yml',
    updated_at: '2026-10-19T12:00:00Z',
    repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [{ number: 68 }] };
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
  const runs = new Map([[run.id, run]]);
  const runJobs = new Map([[run.id, [job]]]);
  const runPages = [[run]];
  let artifactReads = 0;
  const github = { async request(route, parameters) {
    requests.push({ route, parameters });
    assert.equal(parameters.owner, 'owner');
    assert.equal(parameters.repo, 'turntune');
    if (route.endsWith('/actions/workflows/{workflow_id}/runs')) return { data: { workflow_runs: runPages[parameters.page - 1] ?? [] } };
    if (route.endsWith('/actions/runs/{run_id}')) return { data: runs.get(parameters.run_id) };
    if (route.endsWith('/jobs')) return { data: { jobs: runJobs.get(parameters.run_id) ?? [] } };
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
  return { run, job, manifest, evidence, commits, requests, runs, runJobs, runPages, args,
    artifactReads: () => artifactReads, verify: (overrides = {}) => verifyPromotion({ ...args, ...overrides }) };
}

test('production promotes a PR-associated manual staging run when a merge commit preserves the tested source tree', async () => {
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

test('production automatically finds the latest verified staging deployment of its Git tree across history', async () => {
  const release = fixture();
  const unrelated = '9'.repeat(40);
  release.commits[unrelated] = { sha: unrelated, commit: { tree: { sha: '8'.repeat(40) } } };
  release.runPages[0] = Array.from({ length: 100 }, (_, index) => ({ id: 1000 + index, head_sha: unrelated }));
  const latest = { ...release.run, id: 124, updated_at: '2026-10-19T12:10:00Z' };
  release.runs.set(latest.id, latest);
  release.runJobs.set(latest.id, [{ ...release.job, run_id: latest.id }]);
  release.runPages[1] = [latest, release.run];

  const found = await discoverStagingRun({ ...release.args, before: '2026-10-19T12:20:00Z' });
  assert.deepEqual(found, { id: 124, attempt: 2, revision: stagingSha, treeSha,
    url: `https://github.com/${repository}/actions/runs/124` });
  const lists = release.requests.filter(item => item.route.endsWith('/actions/workflows/{workflow_id}/runs'));
  assert.equal(lists.length, 2);
  assert.ok(lists.every(({ parameters }) => parameters.workflow_id === 'deploy.yml'
    && parameters.branch === 'develop' && parameters.event === 'workflow_dispatch'
    && parameters.status === 'success' && parameters.per_page === 100));
  const sourceReads = release.requests.filter(item => item.route.endsWith('/commits/{ref}'));
  for (const revision of [sha, unrelated, stagingSha]) {
    assert.equal(sourceReads.filter(item => item.parameters.ref === revision).length, 1);
  }
  assert.equal(release.artifactReads(), 0);
});

test('an operator must start a new production dispatch after matching staging verification completes', async () => {
  const release = fixture();
  await assert.rejects(discoverStagingRun({ ...release.args, before: '2026-10-19T11:59:00Z' }),
    { code: 'STAGING_DISCOVERY_MISSING' });
  assert.equal((await discoverStagingRun({ ...release.args, before: '2026-10-19T12:01:00Z' })).id, release.run.id);
  assert.equal(release.artifactReads(), 0);
});

test('a missing matching deployment produces a bounded restaging result', async () => {
  const release = fixture();
  const unrelated = '9'.repeat(40);
  release.commits[unrelated] = { sha: unrelated, commit: { tree: { sha: '8'.repeat(40) } } };
  for (let page = 0; page < 11; page += 1) {
    release.runPages[page] = Array.from({ length: 100 }, (_, index) => ({ id: 1000 + page * 100 + index, head_sha: unrelated }));
  }
  await assert.rejects(discoverStagingRun(release.args), { code: 'STAGING_DISCOVERY_MISSING' });
  assert.equal(release.requests.filter(item => item.route.endsWith('/actions/workflows/{workflow_id}/runs')).length, 10);
  assert.equal(release.requests.filter(item => item.route.endsWith('/commits/{ref}')).length, 2);
  assert.equal(release.artifactReads(), 0);
});

test('an operator cannot select another repository or an arbitrary artifact URL', async () => {
  for (const invalidUrl of [
    'https://example.com/owner/turntune/actions/runs/123',
    'https://github.com/other/turntune/actions/runs/123',
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
    { conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' }, { event: 'pull_request_target' },
    { head_branch: 'master' }, { path: '.github/workflows/ci.yml' },
    { head_repository: { full_name: 'someone/fork' } },
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
  await assert.rejects(discoverStagingRun(release.args), { code: 'STAGING_DISCOVERY_MISSING' });
  assert.equal(release.artifactReads(), 0);
});

test('production rejects substituted images, another run and incomplete hosted verification', async () => {
  for (const alter of [
    evidence => { evidence.githubRunId = '456'; },
    evidence => { evidence.manifest.runId = '456'; },
    evidence => { evidence.image = 'ghcr.io/owner/turntune:latest'; },
    evidence => { evidence.manifest.repository = 'other/turntune'; },
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
  await assert.rejects(discoverStagingRun({ ...release.args, github: async () => { throw new Error('unavailable'); } }),
    { code: 'PROMOTION_API' });
});
