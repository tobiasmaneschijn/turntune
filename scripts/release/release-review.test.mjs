import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyReleaseReview } from './release-review.mjs';

const repository = 'owner/SoundSpin';
const sha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const stagingRunUrl = `https://github.com/${repository}/actions/runs/123`;
const releaseEvidenceUrl = `https://github.com/${repository}/pull/9`;

function fixture() {
  const author = { id: 1, login: 'author', type: 'User' };
  const reviewer = { id: 2, login: 'reviewer', type: 'User' };
  const pull = { number: 9, merged: true, merged_at: '2026-10-19T14:05:00Z',
    base: { ref: 'master', repo: { full_name: repository } },
    head: { sha: headSha }, merge_commit_sha: sha, user: author,
    body: `Release evidence: [staging deployment](${stagingRunUrl}).` };
  const run = { id: 123, run_attempt: 1, head_sha: headSha,
    status: 'completed', conclusion: 'success', updated_at: '2026-10-19T14:00:00Z',
    event: 'workflow_dispatch', head_branch: 'develop', path: '.github/workflows/deploy.yml',
    repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [] };
  const production = { id: 456, run_attempt: 1, head_sha: sha, status: 'in_progress', conclusion: null,
    event: 'workflow_dispatch', head_branch: 'master', path: '.github/workflows/deploy.yml',
    repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [],
    created_at: '2026-10-19T14:10:00Z', actor: author, triggering_actor: author };
  const job = { name: 'Deploy staging', run_id: run.id, head_sha: headSha,
    status: 'completed', conclusion: 'success' };
  const reviews = [];
  const permissions = new Map([
    ['author', { permission: 'admin', user: author }],
    ['reviewer', { permission: 'write', user: reviewer }],
  ]);
  const requests = [];
  const github = { async request(route, parameters) {
    requests.push({ route, parameters });
    assert.equal(parameters.owner, 'owner');
    assert.equal(parameters.repo, 'SoundSpin');
    if (route.endsWith('/pulls/{pull_number}')) return { data: pull };
    if (route.endsWith('/reviews')) return { data: reviews };
    if (route.endsWith('/permission')) return { data: permissions.get(parameters.username) };
    if (route.endsWith('/actions/runs/{run_id}')) {
      assert.ok([run.id, production.id].includes(parameters.run_id));
      return { data: parameters.run_id === run.id ? run : production };
    }
    if (route.endsWith('/jobs')) return { data: { jobs: [job] } };
    throw new Error('Unexpected request.');
  } };
  return { pull, run, production, reviewer, reviews, permissions, requests,
    verify: (overrides = {}) => verifyReleaseReview({ github, repository, sha, releaseEvidenceUrl,
      environment: 'production', stagingRunUrl, productionRunId: '456', productionRunAttempt: '1',
      productionConfirmed: 'true', ...overrides,
    }) };
}

test('a solo author confirms a manual production deployment of the merged, staged release', async () => {
  const release = fixture();
  const approval = await release.verify();
  assert.equal(approval.type, 'workflow_dispatch');
  assert.equal(approval.mergeSha, sha);
  assert.equal(approval.headSha, headSha);
  assert.equal(approval.stagingRunUrl, stagingRunUrl);
  assert.equal(approval.stagingRunAttempt, 1);
  assert.equal(approval.stagingVerifiedAt, '2026-10-19T14:00:00Z');
  assert.equal(approval.productionRunId, 456);
  assert.equal(approval.productionRunAttempt, 1);
  assert.equal(approval.dispatchedAt, release.production.created_at);
  assert.equal(approval.confirmed, true);
  assert.deepEqual(approval.actor, { id: 1, login: 'author', permission: 'admin' });
  assert.deepEqual(approval.triggeringActor, approval.actor);
  assert.equal(release.reviews.length, 0);
});

test('production cannot substitute another repository, an issue or an arbitrary evidence URL', async () => {
  for (const invalidUrl of [
    `https://github.com/${repository}/issues/9`, 'https://github.com/other/SoundSpin/pull/9',
    `${releaseEvidenceUrl}?approved=true`, 'https://example.com/approved',
  ]) {
    const release = fixture();
    await assert.rejects(release.verify({ releaseEvidenceUrl: invalidUrl }));
    assert.equal(release.requests.length, 0);
  }
  const release = fixture();
  const reference = await release.verify({ environment: 'staging', releaseEvidenceUrl: `https://github.com/${repository}/issues/8`,
    productionConfirmed: undefined, productionRunId: undefined, productionRunAttempt: undefined });
  assert.equal(reference.approvalRequired, false);
  assert.equal(reference.type, 'evidence_reference');
  assert.equal(release.requests.length, 0);
});

test('manual confirmation cannot deploy an unmerged PR, another base or another production revision', async () => {
  for (const invalid of [
    { merged: false }, { base: { ref: 'develop', repo: { full_name: repository } } },
    { base: { ref: 'master', repo: { full_name: 'other/SoundSpin' } } },
    { merge_commit_sha: 'c'.repeat(40) },
  ]) {
    const release = fixture();
    Object.assign(release.pull, invalid);
    await assert.rejects(release.verify(), { code: 'RELEASE_PR_MISMATCH' });
  }
});

test('production requires explicit confirmation tied to the current run and attempt', async () => {
  for (const productionConfirmed of [undefined, '', 'false', 'yes']) {
    const release = fixture();
    await assert.rejects(release.verify({ productionConfirmed }), { code: 'RELEASE_CONFIRMATION_REQUIRED' });
    assert.equal(release.requests.length, 0);
  }
  for (const invalid of [{ productionRunId: undefined }, { productionRunId: '0' }, { productionRunAttempt: undefined }]) {
    await assert.rejects(fixture().verify(invalid), { code: 'RELEASE_DISPATCH_CONFIGURATION' });
  }
  for (const invalid of [
    { event: 'push' }, { head_branch: 'develop' }, { head_sha: headSha }, { run_attempt: 2 },
    { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'fork/SoundSpin' } },
    { repository: { full_name: 'other/SoundSpin' } }, { pull_requests: [{}] },
    { status: 'completed', conclusion: 'success' },
  ]) {
    const release = fixture();
    Object.assign(release.production, invalid);
    await assert.rejects(release.verify(), { code: 'RELEASE_DISPATCH_UNTRUSTED' });
  }
});

test('the original dispatcher and rerun operator must both remain authorized repository writers', async () => {
  for (const change of [
    release => { release.permissions.get('author').permission = 'read'; },
    release => { release.permissions.get('author').user = { id: 99, login: 'author' }; },
    release => { release.production.actor = { id: 1, login: 'author', type: 'Bot' }; },
  ]) {
    const release = fixture();
    change(release);
    await assert.rejects(release.verify(), { code: 'RELEASE_OPERATOR_UNTRUSTED' });
  }
  const release = fixture();
  release.production.run_attempt = 2;
  release.production.triggering_actor = release.reviewer;
  const approval = await release.verify({ productionRunAttempt: '2' });
  assert.equal(approval.actor.login, 'author');
  assert.equal(approval.triggeringActor.login, 'reviewer');
  release.permissions.get('reviewer').permission = 'read';
  await assert.rejects(release.verify({ productionRunAttempt: '2' }), { code: 'RELEASE_OPERATOR_UNTRUSTED' });
});

test('queued starts cannot authorize a release dispatched before its PR merge or staging completion', async () => {
  const release = fixture();
  release.production.created_at = '2026-10-19T14:04:00Z';
  release.production.run_started_at = '2026-10-19T14:20:00Z';
  await assert.rejects(release.verify(), { code: 'RELEASE_DISPATCH_STALE' });
  release.pull.merged_at = '2026-10-19T13:55:00Z';
  release.production.created_at = '2026-10-19T13:59:00Z';
  await assert.rejects(release.verify(), { code: 'RELEASE_DISPATCH_STALE' });
  release.production.created_at = 'invalid';
  await assert.rejects(release.verify(), { code: 'RELEASE_REVIEW_RESPONSE' });
});

test('a new staging attempt requires a fresh manual production dispatch instead of rerunning an old approval', async () => {
  const release = fixture();
  assert.equal((await release.verify()).stagingRunAttempt, 1);
  Object.assign(release.run, { run_attempt: 2, updated_at: '2026-10-19T14:15:00Z',
    status: 'in_progress', conclusion: null });
  await assert.rejects(release.verify(), { code: 'STAGING_RUN_UNTRUSTED' });
  Object.assign(release.run, { status: 'completed', conclusion: 'success' });
  release.production.run_attempt = 2;
  release.production.run_started_at = '2026-10-19T14:20:00Z';
  await assert.rejects(release.verify({ productionRunAttempt: '2' }), { code: 'RELEASE_DISPATCH_STALE' });
  Object.assign(release.production, { id: 457, run_attempt: 1, created_at: '2026-10-19T14:20:00Z' });
  const approval = await release.verify({ productionRunId: '457' });
  assert.equal(approval.stagingRunAttempt, 2);
  assert.equal(approval.stagingVerifiedAt, release.run.updated_at);
});

test('the merged release PR must visibly link the exact selected staging run', async () => {
  const release = fixture();
  release.pull.body = `Reviewed ${stagingRunUrl}4`;
  await assert.rejects(release.verify(), { code: 'RELEASE_STAGING_LINK' });
  release.pull.body = `<!-- ${stagingRunUrl} -->`;
  await assert.rejects(release.verify(), { code: 'RELEASE_STAGING_LINK' });
});

test('solo dispatch respects unresolved writer change requests and their native resolution', async () => {
  for (const resolution of ['APPROVED', 'DISMISSED']) {
    const release = fixture();
    release.reviews.push({ id: 10, user: release.reviewer, author_association: 'COLLABORATOR', state: 'CHANGES_REQUESTED' });
    release.reviews.push({ ...release.reviews[0], id: 11, state: 'COMMENTED' });
    await assert.rejects(release.verify(), { code: 'RELEASE_REVIEW_BLOCKED' });
    release.reviews.push({ ...release.reviews[0], id: 12, state: resolution });
    assert.equal((await release.verify()).confirmed, true);
  }
});

test('unavailable native GitHub evidence leaves production blocked', async () => {
  await assert.rejects(fixture().verify({ github: async () => { throw new Error('not available'); } }),
    { code: 'RELEASE_REVIEW_API' });
});
