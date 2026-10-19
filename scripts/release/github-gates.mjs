const REQUIRED_WORKFLOWS = [
  { file: 'ci.yml', path: '.github/workflows/ci.yml', name: 'App checks' },
  { file: 'security.yml', path: '.github/workflows/security.yml', name: 'Security gates' },
];

export class GateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GateError(code, message);
}

function sameRepository(actual, expected) {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

function newest(records) {
  if (records.some(record => !Number.isSafeInteger(record.id) || record.id <= 0)) {
    fail('GITHUB_RESPONSE', 'GitHub returned a record without a valid ID.');
  }
  return records.toSorted((left, right) => right.id - left.id)[0];
}

function requireSuccess(record, prefix, label) {
  if (!record) fail(`${prefix}_MISSING`, `${label} is missing for this revision.`);
  if (record.status !== 'completed') {
    fail(`${prefix}_PENDING`, `${label} has not completed for this revision.`);
  }
  if (record.conclusion !== 'success') {
    fail(`${prefix}_FAILED`, `${label} did not succeed for this revision.`);
  }
}

/**
 * Read-only release gates using an Octokit-compatible request(route, params).
 * migrationContext must be configured from the integration's observed payload:
 * { type: 'check_run', name, app: { id, slug, owner },
 *   identity: { field: 'name' | 'details_url' | 'external_id', value } }
 * The exact identity value must identify the intended Supabase project/environment.
 * No migration check name, app identity or project binding is assumed here.
 * requireMigrations: false checks CI only when producing a build artifact.
 */
export async function verifyGitHubGates({ github, repository, sha, branch, migrationContext, requireMigrations = true }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail('GATE_CONFIGURATION', 'Set the GitHub repository as owner/repo.');
  }
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) {
    fail('GATE_CONFIGURATION', 'Release gates require the full lowercase commit SHA.');
  }
  if (!['develop', 'master'].includes(branch)) {
    fail('GATE_CONFIGURATION', 'Release gates require develop or master.');
  }
  if (typeof requireMigrations !== 'boolean') {
    fail('GATE_CONFIGURATION', 'requireMigrations must be a boolean.');
  }
  const app = migrationContext?.app;
  const identity = migrationContext?.identity;
  if (requireMigrations && (migrationContext?.type !== 'check_run'
    || typeof migrationContext.name !== 'string' || !migrationContext.name.trim()
    || !Number.isSafeInteger(app?.id) || app.id <= 0
    || typeof app.slug !== 'string' || !app.slug.trim()
    || typeof app.owner !== 'string' || !app.owner.trim()
    || !['name', 'details_url', 'external_id'].includes(identity?.field)
    || typeof identity?.value !== 'string' || !identity.value.trim())) {
    fail('GATE_CONFIGURATION', 'Configure the observed Supabase check, trusted GitHub App and exact project/environment identity.');
  }
  const request = typeof github === 'function' ? github : github?.request?.bind(github);
  if (!request) fail('GATE_CONFIGURATION', 'A GitHub request client is required.');
  const [owner, repo] = repository.split('/');

  async function list(route, parameters, key) {
    const items = [];
    // A bounded read fails closed rather than approving an incomplete result set.
    for (let page = 1; page <= 10; page += 1) {
      let response;
      try {
        response = await request(route, { owner, repo, ...parameters, per_page: 100, page });
      } catch {
        fail('GITHUB_API', 'Could not read the required GitHub release evidence.');
      }
      const data = response?.data ?? response;
      const batch = key ? data?.[key] : data;
      if (!Array.isArray(batch)) fail('GITHUB_RESPONSE', 'GitHub returned incomplete release evidence.');
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    fail('GITHUB_RESPONSE', 'GitHub release evidence exceeded the read limit.');
  }

  const workflows = await Promise.all(REQUIRED_WORKFLOWS.map(async workflow => {
    const runs = await list('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
      workflow_id: workflow.file, event: 'push', branch, head_sha: sha,
    }, 'workflow_runs');
    const run = newest(runs.filter(candidate => candidate.head_sha === sha
      && candidate.head_branch === branch && candidate.event === 'push'
      && candidate.path === workflow.path && candidate.name === workflow.name
      && sameRepository(candidate.repository?.full_name, repository)
      && sameRepository(candidate.head_repository?.full_name, repository)));
    requireSuccess(run, 'CI', workflow.name);
    return { name: workflow.name, path: workflow.path, runId: run.id,
      runAttempt: run.run_attempt, url: run.html_url };
  }));

  if (!requireMigrations) return { repository, sha, branch, workflows, migration: null };

  const checkRuns = await list('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
    ref: sha, check_name: migrationContext.name, app_id: app.id, filter: 'all',
  }, 'check_runs');
  const named = checkRuns.filter(check => check.head_sha === sha && check.name === migrationContext.name);
  const trusted = named.filter(check => check.app?.id === app.id
    && check.app?.slug === app.slug
    && sameRepository(check.app?.owner?.login, app.owner)
    && check[identity.field] === identity.value);
  if (named.length && !trusted.length) {
    fail('MIGRATION_UNTRUSTED', 'The migration check does not match the trusted app and intended Supabase project/environment.');
  }
  const migration = newest(trusted);
  requireSuccess(migration, 'MIGRATION', 'Supabase migration deployment');
  return {
    repository, sha, branch, workflows,
    migration: { type: 'check_run', id: migration.id, name: migration.name,
      appId: app.id, identity, url: migration.html_url },
  };
}
