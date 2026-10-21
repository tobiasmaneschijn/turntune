import { isDeepStrictEqual } from 'node:util';

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const PROOFS = ['singleInstance', 'health', 'ready', 'socketPolling', 'websocketUpgrade', 'hostileOrigin', 'missingCredential'];

export class PromotionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PromotionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PromotionError(code, message);
}

function sameRepository(actual, expected) {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

function repositoryParts(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail('PROMOTION_CONFIGURATION', 'Set the GitHub repository as owner/repo.');
  }
  const [owner, repo] = repository.split('/');
  return { owner, repo };
}

export function parseStagingRunUrl(repository, stagingRunUrl) {
  repositoryParts(repository);
  const match = typeof stagingRunUrl === 'string'
    && /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/actions\/runs\/([1-9][0-9]*)$/.exec(stagingRunUrl);
  if (!match || !sameRepository(match[1], repository) || !Number.isSafeInteger(Number(match[2]))) {
    fail('STAGING_RUN_URL', 'Use a GitHub Actions run URL from this repository.');
  }
  return Number(match[2]);
}

function client(github, repository) {
  const parameters = repositoryParts(repository);
  const request = typeof github === 'function' ? github : github?.request?.bind(github);
  if (!request) fail('PROMOTION_CONFIGURATION', 'A GitHub request client is required.');
  return async (route, values = {}) => {
    try {
      const response = await request(route, { ...parameters, ...values });
      return response?.data ?? response;
    } catch {
      fail('PROMOTION_API', 'Could not read the required GitHub staging evidence.');
    }
  };
}

/** Verify before downloading artifacts. The caller downloads only this run's named artifact. */
export async function verifyStagingRun({ github, repository, stagingRunUrl }) {
  const runId = parseStagingRunUrl(repository, stagingRunUrl);
  const get = client(github, repository);
  const run = await get('GET /repos/{owner}/{repo}/actions/runs/{run_id}', { run_id: runId });
  // An associated PR does not change a manual run's event, source or deployment evidence.
  if (run?.id !== runId || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0
    || !SHA.test(run.head_sha ?? '')
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.event !== 'workflow_dispatch' || run.head_branch !== 'develop'
    || run.path !== '.github/workflows/deploy.yml'
    || !sameRepository(run.repository?.full_name, repository)
    || !sameRepository(run.head_repository?.full_name, repository)) {
    fail('STAGING_RUN_UNTRUSTED', 'The run must be a successful manual staging deployment from this repository.');
  }
  const jobs = [];
  for (let page = 1; ; page += 1) {
    if (page > 10) fail('STAGING_JOB_MISSING', 'Staging job evidence exceeded the read limit.');
    const data = await get('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
      run_id: runId, filter: 'latest', per_page: 100, page,
    });
    if (!Array.isArray(data?.jobs)) fail('STAGING_JOB_MISSING', 'GitHub returned incomplete staging job evidence.');
    jobs.push(...data.jobs);
    if (data.jobs.length < 100) break;
  }
  const deployJobs = jobs.filter(job => job?.name === 'Deploy staging');
  if (deployJobs.length !== 1 || deployJobs[0].run_id !== runId
    || deployJobs[0].head_sha !== run.head_sha
    || deployJobs[0].status !== 'completed' || deployJobs[0].conclusion !== 'success') {
    fail('STAGING_JOB_MISSING', 'The staging deployment job must have completed successfully.');
  }
  return run;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NaN;
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  return new Date(parsed).toISOString() === canonical ? parsed : NaN;
}

/** Find a verified staging deployment of this Git tree, without operator-supplied URLs. */
export async function discoverStagingRun({ github, repository, sha, before }) {
  if (!SHA.test(sha ?? '') || (before !== undefined && !Number.isFinite(timestamp(before)))) {
    fail('PROMOTION_CONFIGURATION', 'Staging discovery requires a full production revision and valid dispatch timestamp.');
  }
  const cutoff = before === undefined ? Infinity : timestamp(before);
  const get = client(github, repository);
  const trees = new Map();
  async function tree(ref) {
    if (!trees.has(ref)) {
      const commit = await get('GET /repos/{owner}/{repo}/commits/{ref}', { ref });
      if (commit?.sha !== ref || !SHA.test(commit.commit?.tree?.sha ?? '')) {
        fail('PROMOTION_SOURCE_MISMATCH', 'Could not verify the Git tree of the selected release or staging revision.');
      }
      trees.set(ref, commit.commit.tree.sha);
    }
    return trees.get(ref);
  }
  const treeSha = await tree(sha);
  const seen = new Set();
  let selected;
  // GitHub caps filtered workflow-run searches at 1,000 results. Commit trees
  // are cached because multiple attempts/runs often test the same source SHA.
  for (let page = 1; page <= 10; page += 1) {
    const data = await get('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
      workflow_id: 'deploy.yml', branch: 'develop', event: 'workflow_dispatch',
      status: 'success', per_page: 100, page,
    });
    if (!Array.isArray(data?.workflow_runs)) {
      fail('STAGING_DISCOVERY_RESPONSE', 'GitHub returned incomplete staging deployment history.');
    }
    for (const listed of data.workflow_runs) {
      if (!Number.isSafeInteger(listed?.id) || listed.id <= 0 || !SHA.test(listed.head_sha ?? '')) {
        fail('STAGING_DISCOVERY_RESPONSE', 'GitHub returned an invalid staging deployment revision.');
      }
      if (seen.has(listed.id)) continue;
      seen.add(listed.id);
      if (await tree(listed.head_sha) !== treeSha) continue;
      const url = `https://github.com/${repository}/actions/runs/${listed.id}`;
      let run;
      try {
        run = await verifyStagingRun({ github, repository, stagingRunUrl: url });
      } catch (error) {
        if (['STAGING_RUN_UNTRUSTED', 'STAGING_JOB_MISSING'].includes(error.code)) continue;
        throw error;
      }
      if (run.head_sha !== listed.head_sha) {
        fail('STAGING_DISCOVERY_RESPONSE', 'The staging deployment revision changed while reading its evidence.');
      }
      const completed = timestamp(run.updated_at);
      if (!Number.isFinite(completed)) {
        fail('STAGING_DISCOVERY_RESPONSE', 'GitHub returned no valid staging completion timestamp.');
      }
      if (completed > cutoff) continue;
      if (!selected || completed > selected.completed || (completed === selected.completed && run.id > selected.id)) {
        selected = { id: run.id, attempt: run.run_attempt, revision: run.head_sha, treeSha, url, completed };
      }
    }
    if (data.workflow_runs.length < 100) break;
  }
  if (!selected) {
    fail('STAGING_DISCOVERY_MISSING', 'No successful staging deployment of this source was found before this dispatch in the recent deployment history. Deploy this source to staging, then start a new production deployment.');
  }
  const { completed, ...result } = selected;
  return result;
}

function validMigrations(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) return false;
  let previous = '';
  for (const migration of migrations) {
    if (!/^\d{14}$/.test(migration?.version ?? '') || migration.version <= previous
      || typeof migration.name !== 'string' || !/^[A-Za-z0-9_]+$/.test(migration.name)
      || !HASH.test(migration.sha256 ?? '')) return false;
    previous = migration.version;
  }
  return true;
}

/** Promote the immutable image verified by staging, preserving its original manifest. */
export async function verifyPromotion({ github, repository, sha, stagingRunUrl, loadArtifact }) {
  if (!SHA.test(sha ?? '') || typeof loadArtifact !== 'function') {
    fail('PROMOTION_CONFIGURATION', 'Promotion requires the full production commit SHA and a run-scoped artifact loader.');
  }
  const run = await verifyStagingRun({ github, repository, stagingRunUrl });
  let files;
  try {
    files = await loadArtifact(run.id, 'deployment-evidence');
  } catch {
    fail('STAGING_EVIDENCE_MISSING', 'Could not load the staging deployment evidence artifact.');
  }
  const evidence = files?.['deployment-evidence.json'];
  const manifest = evidence?.manifest;
  const expectedImage = `ghcr.io/${repository.toLowerCase()}@${manifest?.digest}`;
  if (evidence?.schemaVersion !== 1 || evidence.environment !== 'staging'
    || evidence.githubRunId !== String(run.id) || evidence.revision !== run.head_sha
    || evidence.githubRunAttempt !== String(run.run_attempt)
    || evidence.imageRevision !== run.head_sha || evidence.verified !== true
    || !PROOFS.every(proof => evidence.checks?.[proof] === true)
    || manifest?.schemaVersion !== 1 || !sameRepository(manifest.repository, repository)
    || manifest.branch !== 'develop' || manifest.revision !== run.head_sha
    || manifest.runId !== String(run.id)
    || manifest.runAttempt !== String(run.run_attempt)
    || !/^sha256:[a-f0-9]{64}$/.test(manifest.digest ?? '')
    || manifest.image !== expectedImage || evidence.image !== manifest.image
    || evidence.digest !== manifest.digest || !HASH.test(manifest.lockfileSha256 ?? '')
    || !validMigrations(manifest.migrations)
    || !isDeepStrictEqual(evidence.migrations, manifest.migrations)) {
    fail('STAGING_EVIDENCE_INVALID', 'Staging evidence must prove this run verified the exact image and migration inventory.');
  }

  const get = client(github, repository);
  const [production, staging] = await Promise.all([
    get('GET /repos/{owner}/{repo}/commits/{ref}', { ref: sha }),
    get('GET /repos/{owner}/{repo}/commits/{ref}', { ref: run.head_sha }),
  ]);
  const treeSha = production?.commit?.tree?.sha;
  if (production?.sha !== sha || staging?.sha !== run.head_sha || !SHA.test(treeSha ?? '')
    || treeSha !== staging?.commit?.tree?.sha) {
    fail('PROMOTION_SOURCE_MISMATCH', 'Production source must have the same Git tree as the verified staging image.');
  }
  return { manifest, evidence, treeSha,
    stagingRun: { id: run.id, attempt: run.run_attempt, revision: run.head_sha, url: stagingRunUrl } };
}
