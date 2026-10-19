import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDeploymentDispatch, verifyStagingForDispatch } from './dispatch.mjs';

const repository = 'owner/turntune';
const sha = 'a'.repeat(40);
const stagingRunUrl = `https://github.com/${repository}/actions/runs/123`;

function fixture(environment = 'production') {
  const production = { id: 456, run_attempt: 1, head_sha: sha, status: 'in_progress', conclusion: null,
    event: 'workflow_dispatch', head_branch: environment === 'production' ? 'master' : 'develop',
    path: '.github/workflows/deploy.yml', repository: { full_name: repository }, head_repository: { full_name: repository },
    pull_requests: [], created_at: '2026-10-19T14:10:00Z' };
  const staging = { ...production, id: 123, head_sha: 'b'.repeat(40), head_branch: 'develop',
    status: 'completed', conclusion: 'success', updated_at: '2026-10-19T14:00:00Z' };
  const requests = [];
  const github = { async request(route, parameters) {
    requests.push(route);
    assert.equal(parameters.owner, 'owner');
    assert.equal(parameters.repo, 'turntune');
    if (route.endsWith('/actions/runs/{run_id}')) {
      assert.ok([production.id, staging.id].includes(parameters.run_id));
      return { data: parameters.run_id === production.id ? production : staging };
    }
    if (route.endsWith('/jobs')) return { data: { jobs: [{ name: 'Deploy staging', run_id: staging.id,
      head_sha: staging.head_sha, status: 'completed', conclusion: 'success' }] } };
    throw new Error('Unexpected request');
  } };
  const verify = overrides => verifyDeploymentDispatch({ github, repository, sha, environment,
    eventName: 'workflow_dispatch', confirmed: 'true', runId: '456', runAttempt: '1', ...overrides });
  const approveStaging = dispatch => verifyStagingForDispatch({ github, repository, stagingRunUrl, dispatch });
  return { production, staging, requests, verify, approveStaging };
}

test('an operator confirms a manual deployment without supplying evidence URLs', async () => {
  for (const environment of ['staging', 'production']) {
    const release = fixture(environment);
    const dispatch = await release.verify();
    assert.equal(dispatch.confirmed, true);
    assert.equal(dispatch.runId, release.production.id);
    assert.equal(dispatch.url, `https://github.com/${repository}/actions/runs/456`);
  }
  const release = fixture();
  for (const overrides of [{ confirmed: 'false' }, { confirmed: undefined }, { eventName: 'push' }]) {
    await assert.rejects(release.verify(overrides), /Confirm deployment/);
  }
  assert.equal(release.requests.length, 0);
});

test('confirmation cannot authorize another revision or an obsolete workflow attempt', async () => {
  const release = fixture();
  release.production.head_sha = 'c'.repeat(40);
  await assert.rejects(release.verify(), /active manual Deploy run/);
  release.production.head_sha = sha;
  release.production.run_attempt = 2;
  await assert.rejects(release.verify(), /active manual Deploy run/);
  assert.equal((await release.verify({ runAttempt: '2' })).runAttempt, 2);
});

test('a changed staging attempt requires a fresh confirmed production dispatch before promotion', async () => {
  const release = fixture();
  const originalDispatch = await release.verify();
  assert.equal((await release.approveStaging(originalDispatch)).stagingRunAttempt, 1);
  Object.assign(release.staging, { run_attempt: 2, updated_at: '2026-10-19T14:15:00Z', status: 'in_progress', conclusion: null });
  await assert.rejects(release.approveStaging(originalDispatch));
  Object.assign(release.staging, { status: 'completed', conclusion: 'success' });
  Object.assign(release.production, { run_attempt: 2, run_started_at: '2026-10-19T14:20:00Z' });
  await assert.rejects(release.approveStaging(await release.verify({ runAttempt: '2' })), /Start a new Deploy workflow/);
  Object.assign(release.production, { id: 457, run_attempt: 1, created_at: '2026-10-19T14:20:00Z' });
  const fresh = await release.approveStaging(await release.verify({ runId: '457' }));
  assert.equal(fresh.stagingRunId, 123);
  assert.equal(fresh.stagingRunAttempt, 2);
  assert.equal(fresh.stagingVerifiedAt, release.staging.updated_at);
});
