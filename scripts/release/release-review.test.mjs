import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyReleaseReview } from './release-review.mjs';

const repository = 'owner/SoundSpin';
const sha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const stagingRunUrl = `https://github.com/${repository}/actions/runs/123`;
const releaseEvidenceUrl = `https://github.com/${repository}/pull/9`;

function fixture() {
  const pull = { number: 9, merged: true, base: { ref: 'master', repo: { full_name: repository } },
    head: { sha: headSha }, merge_commit_sha: sha, user: { id: 1, login: 'author' },
    body: `Release evidence: [staging deployment](${stagingRunUrl}).` };
  const run = { id: 123, run_attempt: 1, head_sha: headSha,
    status: 'completed', conclusion: 'success', updated_at: '2026-10-19T14:00:00Z',
    event: 'workflow_dispatch', head_branch: 'develop', path: '.github/workflows/deploy.yml',
    repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [] };
  const job = { name: 'Deploy staging', run_id: run.id, head_sha: headSha,
    status: 'completed', conclusion: 'success' };
  const reviewer = { id: 2, login: 'reviewer', type: 'User' };
  const reviews = [{ id: 10, user: reviewer, author_association: 'COLLABORATOR',
    state: 'APPROVED', commit_id: headSha, body: `Reviewed staging: ${stagingRunUrl}`,
    submitted_at: '2026-10-19T14:05:00Z' }];
  const access = { permission: 'write', user: reviewer };
  const requests = [];
  const github = { async request(route, parameters) {
    requests.push({ route, parameters });
    assert.equal(parameters.owner, 'owner');
    assert.equal(parameters.repo, 'SoundSpin');
    if (route.endsWith('/pulls/{pull_number}')) return { data: pull };
    if (route.endsWith('/reviews')) return { data: reviews };
    if (route.endsWith('/permission')) return { data: access };
    if (route.endsWith('/actions/runs/{run_id}')) return { data: run };
    if (route.endsWith('/jobs')) return { data: { jobs: [job] } };
    throw new Error('Unexpected request.');
  } };
  return { pull, run, reviews, access, requests, verify: (overrides = {}) => verifyReleaseReview({
    github, repository, sha, releaseEvidenceUrl, environment: 'production', stagingRunUrl, ...overrides,
  }) };
}

test('an operator deploys the approved merged release and its reviewed staging evidence', async () => {
  const release = fixture();
  // A later comment must not erase an earlier substantive approval.
  release.reviews.push({ ...release.reviews[0], id: 11, state: 'COMMENTED' });
  const approval = await release.verify();
  assert.equal(approval.mergeSha, sha);
  assert.equal(approval.headSha, headSha);
  assert.equal(approval.stagingRunUrl, stagingRunUrl);
  assert.equal(approval.stagingRunAttempt, 1);
  assert.equal(approval.stagingVerifiedAt, '2026-10-19T14:00:00Z');
  assert.deepEqual(approval.reviewers, [{ login: 'reviewer', reviewId: 10, permission: 'write' }]);
  assert.equal(release.requests.at(-1).parameters.username, 'reviewer');
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
  const reference = await release.verify({ environment: 'staging', releaseEvidenceUrl: `https://github.com/${repository}/issues/8` });
  assert.equal(reference.approvalRequired, false);
  assert.equal(reference.type, 'evidence_reference');
  assert.equal(release.requests.length, 0);
});

test('a release cannot borrow review from an unmerged PR, another base or another production revision', async () => {
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

test('new source needs a new approval of the final PR head', async () => {
  const release = fixture();
  release.reviews[0].commit_id = 'c'.repeat(40);
  await assert.rejects(release.verify(), { code: 'RELEASE_APPROVAL_MISSING' });
  release.reviews.push({ ...release.reviews[0], id: 11, commit_id: headSha });
  assert.equal((await release.verify()).reviewers[0].reviewId, 11);
});

test('requested changes and dismissed approvals block deployment until the reviewer approves again', async () => {
  for (const state of ['CHANGES_REQUESTED', 'DISMISSED']) {
    const release = fixture();
    release.reviews.push({ ...release.reviews[0], id: 11, state });
    await assert.rejects(release.verify(), { code: 'RELEASE_REVIEW_BLOCKED' });
    release.reviews.push({ ...release.reviews[0], id: 12 });
    assert.equal((await release.verify()).reviewers[0].reviewId, 12);
  }
});

test('self-approval, an outside review or removed repository access cannot authorize release', async () => {
  for (const alter of [
    release => { release.pull.user.id = release.reviews[0].user.id; },
    release => { release.reviews[0].author_association = 'NONE'; },
    release => { release.access.permission = 'read'; },
  ]) {
    const release = fixture();
    alter(release);
    await assert.rejects(release.verify(), { code: 'RELEASE_APPROVAL_MISSING' });
  }
});

test('the reviewed PR must visibly link the exact selected staging run', async () => {
  const release = fixture();
  release.pull.body = `Reviewed ${stagingRunUrl}4`;
  await assert.rejects(release.verify(), { code: 'RELEASE_STAGING_LINK' });
  release.pull.body = `<!-- ${stagingRunUrl} -->`;
  await assert.rejects(release.verify(), { code: 'RELEASE_STAGING_LINK' });
});

test('editing a release description cannot substitute staging evidence after the reviewer approves', async () => {
  const release = fixture();
  // The mutable PR description already names the selected run; the review names another.
  release.reviews[0].body = `Reviewed staging: ${stagingRunUrl}4`;
  await assert.rejects(release.verify(), { code: 'RELEASE_APPROVAL_MISSING' });
  release.reviews.push({ ...release.reviews[0], id: 11, body: `Approved [staging evidence](${stagingRunUrl}).` });
  assert.equal((await release.verify()).reviewers[0].reviewId, 11);
});

test('a staging rerun needs fresh approval after its latest successful attempt completes', async () => {
  const release = fixture();
  assert.equal((await release.verify()).stagingRunAttempt, 1);
  Object.assign(release.run, { run_attempt: 2, updated_at: '2026-10-19T14:10:00Z',
    status: 'in_progress', conclusion: null });
  await assert.rejects(release.verify(), { code: 'STAGING_RUN_UNTRUSTED' });
  Object.assign(release.run, { status: 'completed', conclusion: 'success' });
  await assert.rejects(release.verify(), { code: 'RELEASE_APPROVAL_MISSING' });
  release.reviews.push({ ...release.reviews[0], id: 11, submitted_at: '2026-10-19T14:15:00Z' });
  const approval = await release.verify();
  assert.equal(approval.stagingRunAttempt, 2);
  assert.equal(approval.stagingVerifiedAt, release.run.updated_at);
  assert.equal(approval.reviewers[0].reviewId, 11);
  release.run.updated_at = 'invalid';
  await assert.rejects(release.verify(), { code: 'RELEASE_REVIEW_RESPONSE' });
});

test('unavailable native review evidence leaves production blocked', async () => {
  const release = fixture();
  await assert.rejects(release.verify({ github: async () => { throw new Error('not available'); } }),
    { code: 'RELEASE_REVIEW_API' });
});
