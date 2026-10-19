import { parseStagingRunUrl } from './promotion.mjs';

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
  const visible = body.replace(/<!--[\s\S]*?-->/g, '');
  const urls = visible.match(/https:\/\/[^\s<>()\[\]"'`]+/g) ?? [];
  return urls.some(value => value.replace(/[.,;:!?]+$/, '') === url);
}

/** Native PR approval is the production gate; staging only records an evidence reference. */
export async function verifyReleaseReview({ github, repository, sha, releaseEvidenceUrl, environment, stagingRunUrl }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || !/^[a-f0-9]{40}$/.test(sha ?? '') || !['staging', 'production'].includes(environment)) {
    fail('RELEASE_REVIEW_CONFIGURATION', 'Release review requires this repository, full commit SHA and deployment environment.');
  }
  const reference = evidenceReference(repository, releaseEvidenceUrl);
  if (environment === 'staging') {
    return { type: 'evidence_reference', url: releaseEvidenceUrl, approvalRequired: false };
  }
  if (reference.type !== 'pull') {
    fail('RELEASE_PR_REQUIRED', 'Production requires an approved, merged release pull request.');
  }
  try {
    parseStagingRunUrl(repository, stagingRunUrl);
  } catch {
    fail('RELEASE_STAGING_LINK', 'Production review requires the selected staging deployment run URL.');
  }
  const request = typeof github === 'function' ? github : github?.request?.bind(github);
  if (!request) fail('RELEASE_REVIEW_CONFIGURATION', 'A GitHub request client is required.');
  const [owner, repo] = repository.split('/');
  async function get(route, parameters = {}) {
    try {
      const response = await request(route, { owner, repo, ...parameters });
      return response?.data ?? response;
    } catch {
      fail('RELEASE_REVIEW_API', 'Could not verify the native GitHub release review.');
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
  if (trusted.some(({ review }) => review.state !== 'APPROVED')) {
    fail('RELEASE_REVIEW_BLOCKED', 'Resolve requested changes or dismissed reviews with a new approval before release.');
  }
  const approvers = trusted.filter(({ review }) => review.commit_id === pull.head.sha
    && containsStagingLink(review.body, stagingRunUrl));
  if (!approvers.length) {
    fail('RELEASE_APPROVAL_MISSING', 'Another collaborator with write access must approve the final release PR head and include the selected staging run URL in the approval text.');
  }
  return { type: 'pull_request', url: releaseEvidenceUrl, number: reference.number,
    headSha: pull.head.sha, mergeSha: sha, stagingRunUrl,
    reviewers: approvers.map(({ review, access }) => ({ login: review.user.login,
      reviewId: review.id, permission: access.permission })) };
}
