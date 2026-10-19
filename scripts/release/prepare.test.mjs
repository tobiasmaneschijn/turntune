import assert from 'node:assert/strict';
import test from 'node:test';
import { prepare } from './prepare.mjs';
import { targets } from './preflight.mjs';

test('an operator stages missing source, then confirms production without pasting URLs and promotes the staged image', async () => {
  const repository = targets.repository;
  const sha = 'a'.repeat(40);
  const stagingSha = 'b'.repeat(40);
  const treeSha = 'c'.repeat(40);
  const identity = { event: 'workflow_dispatch', path: '.github/workflows/deploy.yml',
    repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [] };
  const production = { ...identity, id: 900, run_attempt: 1, head_sha: sha, head_branch: 'master',
    status: 'in_progress', conclusion: null, created_at: '2026-10-19T12:00:00Z' };
  const staging = { ...identity, id: 123, run_attempt: 2, head_sha: stagingSha, head_branch: 'develop',
    status: 'completed', conclusion: 'success', updated_at: '2026-10-19T12:02:00Z' };
  const manifest = { schemaVersion: 1, repository, branch: 'develop', revision: stagingSha,
    runId: String(staging.id), runAttempt: String(staging.run_attempt),
    digest: `sha256:${'d'.repeat(64)}`, lockfileSha256: 'e'.repeat(64),
    migrations: [{ version: '20261001090000', name: 'rooms', sha256: 'f'.repeat(64) }] };
  manifest.image = `ghcr.io/${repository.toLowerCase()}@${manifest.digest}`;
  const evidence = { schemaVersion: 1, environment: 'staging', githubRunId: manifest.runId,
    githubRunAttempt: manifest.runAttempt, revision: stagingSha, imageRevision: stagingSha,
    image: manifest.image, digest: manifest.digest, manifest,
    migrations: structuredClone(manifest.migrations), verified: true,
    checks: { singleInstance: true, health: true, ready: true, socketPolling: true,
      websocketUpgrade: true, hostileOrigin: true, missingCredential: true } };
  const env = { DEPLOY_ENVIRONMENT: 'production', DEPLOYMENT_CONFIRMED: 'true',
    GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_REF_NAME: 'master', GITHUB_REF: 'refs/heads/master',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: String(production.id), GITHUB_RUN_ATTEMPT: '1',
    GITHUB_OUTPUT: 'workflow-output', GITHUB_STEP_SUMMARY: 'workflow-summary' };
  let stagingAvailable = false;
  const written = new Map();
  const appended = new Map();
  const reads = [];
  const io = {
    github: { async request(route, parameters) {
      assert.ok(route.startsWith('GET '), 'preparation only reads GitHub');
      assert.equal(`${parameters.owner}/${parameters.repo}`, repository);
      if (route.endsWith('/actions/workflows/{workflow_id}/runs')) {
        return { data: { workflow_runs: stagingAvailable ? [staging] : [] } };
      }
      if (route.endsWith('/actions/runs/{run_id}')) {
        const run = [production, staging].find(candidate => candidate.id === parameters.run_id);
        assert.ok(run, 'only the production dispatch or discovered staging run is read');
        return { data: run };
      }
      if (route.endsWith('/jobs')) {
        assert.equal(parameters.run_id, staging.id);
        return { data: { jobs: [{ name: 'Deploy staging', run_id: staging.id, head_sha: stagingSha,
          status: 'completed', conclusion: 'success' }] } };
      }
      if (route.endsWith('/commits/{ref}')) {
        assert.ok([sha, stagingSha].includes(parameters.ref));
        return { data: { sha: parameters.ref, commit: { tree: { sha: treeSha } } } };
      }
      assert.fail(`Unexpected GitHub request: ${route}`);
    } },
    async read(path) {
      reads.push(path);
      assert.equal(path, 'staging-evidence/deployment-evidence.json');
      return JSON.stringify(evidence);
    },
    async write(path, value) { written.set(path, value); },
    async append(path, value) { appended.set(path, (appended.get(path) ?? '') + value); },
  };

  await assert.rejects(prepare('validate', env, io), { code: 'STAGING_DISCOVERY_MISSING' });
  assert.equal(appended.size, 0);
  assert.equal(written.size, 0);
  assert.deepEqual(reads, []);

  stagingAvailable = true;
  production.id = 901;
  production.created_at = '2026-10-19T12:03:00Z';
  env.GITHUB_RUN_ID = String(production.id);
  await prepare('validate', env, io);
  const outputs = Object.fromEntries(appended.get(env.GITHUB_OUTPUT).trim().split('\n').map(line => {
    const delimiter = line.indexOf('=');
    return [line.slice(0, delimiter), line.slice(delimiter + 1)];
  }));
  const stagingRunUrl = `https://github.com/${repository}/actions/runs/${staging.id}`;
  assert.equal(outputs['staging-run-id'], String(staging.id));
  assert.equal(outputs['staging-run-url'], stagingRunUrl);
  assert.ok(appended.get(env.GITHUB_STEP_SUMMARY).includes(stagingRunUrl));
  assert.equal(written.size, 0);
  assert.deepEqual(reads, []);

  await prepare('image', { ...env, STAGING_RUN_URL: outputs['staging-run-url'] }, io);
  assert.deepEqual(reads, ['staging-evidence/deployment-evidence.json']);
  assert.deepEqual(JSON.parse(written.get('release-image.json')), manifest);
  const promotion = JSON.parse(written.get('promotion.json'));
  assert.equal(promotion.revision, sha);
  assert.equal(promotion.treeSha, treeSha);
  assert.equal(promotion.image, manifest.image);
  assert.deepEqual(promotion.manifest, manifest);
  assert.deepEqual(promotion.stagingRun, { id: staging.id, attempt: staging.run_attempt,
    revision: stagingSha, url: stagingRunUrl });
});
