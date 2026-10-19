import { parseStagingRunUrl, verifyStagingRun } from './promotion.mjs';

const ASSOCIATIONS = new Set(['MEMBER', 'OWNER', 'COLLABORATOR']);
const PERMISSIONS = new Set(['admin', 'maintain', 'write']);
const SUBSTANTIVE = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

export class ReleaseReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseReviewError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseReviewError(code, message);
}

function sameRepository(actual, expected) {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

function evidenceReference(repository, url) {
  const match = typeof url === 'string'
    && /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(pull|issues)\/([1-9][0-9]*)$/.exec(url);
  if (!match || !sameRepository(match[1], repository) || !Number.isSafeInteger(Number(match[3]))) {
    fail('RELEASE_EVIDENCE_URL', 'Use an issue or pull request URL from this repository for release evidence.');
  }
  return { type: match[2], number: Number(match[3]) };
}

function containsStagingLink(body, url) {
  if (typeof body !== 'string') return false;
  // Read visible prose, bare URLs and Markdown links without accepting a URL prefix.
  const visible = body.replace(new RegExp('<!--[^]*?-->', 'g'), '');
  const urls = visible.match(/https:\/\/[^\s<>()\[\]"'`]+/g) ?? [];
  return urls.some(value => value.replace(/[.,;:!?]+$/, '') === url);
}

function nativeTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return NaN;
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  return new Date(timestamp).toISOString() === canonical ? timestamp : NaN;
}

/** A fresh manual GitHub dispatch authorizes production; staging records an evidence reference. */
export async function verifyReleaseReview({ github, repository, sha, releaseEvidenceUrl, environment, stagingRunUrl, productionRunId, productionRunAttempt, productionConfirmed }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || !/^[a-f0-9]{40}$/.test(sha ?? '') || !['staging', 'production'].includes(environment)) {
    fail('RELEASE_REVIEW_CONFIGURATION', 'Release review requires this repository, full commit SHA and deployment environment.');
  }
  const reference = evidenceReference(repository, releaseEvidenceUrl);
  if (environment === 'staging') {
    return { type: 'evidence_reference', url: releaseEvidenceUrl, approvalRequired: false };
  }
  if (reference.type !== 'pull') {
    fail('RELEASE_PR_REQUIRED', 'Production requires a merged release pull request.');
  }
  try {
    parseStagingRunUrl(repository, stagingRunUrl);
  } catch {
    fail('RELEASE_STAGING_LINK', 'Production requires the selected staging deployment run URL.');
  }
  if (productionConfirmed !== 'true') {
    fail('RELEASE_CONFIRMATION_REQUIRED', 'Check the production confirmation when starting a new Deploy workflow.');
  }
  if (!/^[1-9][0-9]*$/.test(String(productionRunId ?? '')) || !Number.isSafeInteger(Number(productionRunId))
    || !/^[1-9][0-9]*$/.test(String(productionRunAttempt ?? '')) || !Number.isSafeInteger(Number(productionRunAttempt))) {
    fail('RELEASE_DISPATCH_CONFIGURATION', 'Production requires the current GitHub run ID and attempt.');
  }
  const request = typeof github === 'function' ? github : github?.request?.bind(github);
  if (!request) fail('RELEASE_REVIEW_CONFIGURATION', 'A GitHub request client is required.');
  const [owner, repo] = repository.split('/');
  async function get(route, parameters = {}) {
    try {
      const response = await request(route, { owner, repo, ...parameters });
      return response?.data ?? response;
    } catch {
      fail('RELEASE_REVIEW_API', 'Could not verify GitHub release authorization.');
    }
  }
  const pull = await get('GET /repos/{owner}/{repo}/pulls/{pull_number}', { pull_number: reference.number });
  if (pull?.number !== reference.number || pull.merged !== true || pull.base?.ref !== 'master'
    || !sameRepository(pull.base?.repo?.full_name, repository) || pull.merge_commit_sha !== sha
    || !/^[a-f0-9]{40}$/.test(pull.head?.sha ?? '')
    || !Number.isSafeInteger(pull.user?.id) || pull.user.id <= 0) {
    fail('RELEASE_PR_MISMATCH', 'The release PR must be merged into this repository’s master at the selected production commit.');
  }
  if (!containsStagingLink(pull.body, stagingRunUrl)) {
    fail('RELEASE_STAGING_LINK', 'The release PR description must link the selected staging deployment run.');
  }

  const stagingRun = await verifyStagingRun({ github, repository, stagingRunUrl });
  const stagingVerifiedAt = nativeTimestamp(stagingRun.updated_at);
  if (!Number.isFinite(stagingVerifiedAt)) {
    fail('RELEASE_REVIEW_RESPONSE', 'GitHub returned no valid completion timestamp for the latest staging attempt.');
  }

  const productionRun = await get('GET /repos/{owner}/{repo}/actions/runs/{run_id}', { run_id: Number(productionRunId) });
  if (productionRun?.id !== Number(productionRunId) || productionRun.run_attempt !== Number(productionRunAttempt)
    || productionRun.event !== 'workflow_dispatch' || productionRun.head_branch !== 'master'
    || productionRun.head_sha !== sha || productionRun.path !== '.github/workflows/deploy.yml'
    || !sameRepository(productionRun.repository?.full_name, repository)
    || !sameRepository(productionRun.head_repository?.full_name, repository)
    || !Array.isArray(productionRun.pull_requests) || productionRun.pull_requests.length !== 0
    || productionRun.status !== 'in_progress' || productionRun.conclusion !== null) {
    fail('RELEASE_DISPATCH_UNTRUSTED', 'Production requires this active manual Deploy run on the selected master revision.');
  }
  const dispatchedAt = nativeTimestamp(productionRun.created_at);
  const mergedAt = nativeTimestamp(pull.merged_at);
  // created_at belongs to the original dispatch. Queuing or rerunning a job must
  // not authorize staging evidence that became available after that dispatch.
  if (!Number.isFinite(dispatchedAt) || !Number.isFinite(mergedAt)) {
    fail('RELEASE_REVIEW_RESPONSE', 'GitHub returned incomplete release dispatch timestamps.');
  }
  if (dispatchedAt < stagingVerifiedAt || dispatchedAt < mergedAt) {
    fail('RELEASE_DISPATCH_STALE', 'Start a new Deploy workflow after the release PR is merged and the latest staging attempt succeeds.');
  }
  const operators = [];
  for (const user of [productionRun.actor, productionRun.triggering_actor]) {
    if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.type !== 'User'
      || typeof user.login !== 'string' || !/^[A-Za-z0-9-]+$/.test(user.login)) {
      fail('RELEASE_OPERATOR_UNTRUSTED', 'A repository writer must manually start or rerun production deployment.');
    }
    const existing = operators.find(operator => operator.id === user.id);
    if (existing) {
      if (existing.login !== user.login) fail('RELEASE_OPERATOR_UNTRUSTED', 'GitHub returned inconsistent deployment operator identity.');
      continue;
    }
    const access = await get('GET /repos/{owner}/{repo}/collaborators/{username}/permission', { username: user.login });
    if (!PERMISSIONS.has(access?.permission) || access.user?.id !== user.id || access.user?.login !== user.login) {
      fail('RELEASE_OPERATOR_UNTRUSTED', 'The dispatch actor and rerun actor must still have repository write access.');
    }
    operators.push({ id: user.id, login: user.login, permission: access.permission });
  }

  const reviews = [];
  for (let page = 1; ; page += 1) {
    if (page > 10) fail('RELEASE_REVIEW_RESPONSE', 'Release review evidence exceeded the read limit.');
    const data = await get('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      pull_number: reference.number, per_page: 100, page,
    });
    if (!Array.isArray(data)) fail('RELEASE_REVIEW_RESPONSE', 'GitHub returned incomplete release reviews.');
    reviews.push(...data);
    if (data.length < 100) break;
  }
  const latest = new Map();
  for (const review of reviews) {
    if (!SUBSTANTIVE.has(review?.state)) continue;
    if (!Number.isSafeInteger(review.id) || review.id <= 0
      || !Number.isSafeInteger(review.user?.id) || review.user.id <= 0
      || typeof review.user.login !== 'string' || !/^[A-Za-z0-9-]+(?:\[bot\])?$/.test(review.user.login)) {
      fail('RELEASE_REVIEW_RESPONSE', 'GitHub returned incomplete reviewer identity.');
    }
    const previous = latest.get(review.user.id);
    if (!previous || review.id > previous.id) latest.set(review.user.id, review);
  }
  const candidates = [...latest.values()].filter(review => ASSOCIATIONS.has(review.author_association)
    && review.user.type === 'User' && review.user.id !== pull.user.id);
  const permissions = await Promise.all(candidates.map(async review => ({ review,
    access: await get('GET /repos/{owner}/{repo}/collaborators/{username}/permission', { username: review.user.login }),
  })));
  const trusted = permissions.filter(({ review, access }) => PERMISSIONS.has(access?.permission)
    && access.user?.id === review.user.id);
  if (trusted.some(({ review }) => review.state === 'CHANGES_REQUESTED')) {
    fail('RELEASE_REVIEW_BLOCKED', 'Resolve outstanding change requests from repository writers before release.');
  }
  return { type: 'workflow_dispatch', url: releaseEvidenceUrl, number: reference.number,
    headSha: pull.head.sha, mergeSha: sha, stagingRunUrl,
    stagingRunAttempt: stagingRun.run_attempt, stagingVerifiedAt: stagingRun.updated_at,
    productionRunId: productionRun.id, productionRunAttempt: productionRun.run_attempt,
    dispatchedAt: productionRun.created_at, confirmed: true,
    actor: operators.find(user => user.id === productionRun.actor.id),
    triggeringActor: operators.find(user => user.id === productionRun.triggering_actor.id) };
}
