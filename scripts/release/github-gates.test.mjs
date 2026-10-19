import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyGitHubGates } from './github-gates.mjs';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const repository = 'owner/SoundSpin';
const migrationContext = {
  type: 'check_run', name: 'Supabase — SoundSpin Staging',
  app: { id: 123, slug: 'observed-supabase-app', owner: 'supabase' },
  identity: { field: 'details_url', value: 'https://supabase.com/dashboard/project/observed-staging-ref' },
};

function releaseFixture() {
  const workflows = {
    'ci.yml': [{ id: 11, name: 'App checks', path: '.github/workflows/ci.yml' }],
    'security.yml': [{ id: 12, name: 'Security gates', path: '.github/workflows/security.yml' }],
  };
  for (const runs of Object.values(workflows)) {
    Object.assign(runs[0], {
      head_sha: sha, head_branch: 'develop', event: 'push',
      repository: { full_name: repository }, head_repository: { full_name: repository },
      status: 'completed', conclusion: 'success', run_attempt: 1,
      html_url: `https://github.com/${repository}/actions/runs/${runs[0].id}`,
    });
  }
  const migrations = [{ id: 21, name: migrationContext.name, head_sha: sha,
    app: { id: 123, slug: migrationContext.app.slug, owner: { login: 'supabase' } },
    details_url: migrationContext.identity.value, status: 'completed', conclusion: 'success',
    html_url: `https://github.com/${repository}/runs/21`,
  }];
  const requests = [];
  const github = { async request(route, params) {
    requests.push({ route, params });
    assert.equal(params.owner, 'owner');
    assert.equal(params.repo, 'SoundSpin');
    if (route.endsWith('/runs')) return { data: { workflow_runs: workflows[params.workflow_id] } };
    if (route.endsWith('/check-runs')) return { data: { check_runs: migrations } };
    throw new Error('Unexpected API request.');
  } };
  return { workflows, migrations, requests, verify: (options = {}) => verifyGitHubGates({
    github, repository, sha, branch: 'develop', migrationContext, ...options,
  }) };
}

test('an operator deploys only after the exact pushed revision and intended database deployment succeed', async () => {
  const fixture = releaseFixture();
  const evidence = await fixture.verify();
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.branch, 'develop');
  assert.deepEqual(evidence.workflows.map(workflow => workflow.runId), [11, 12]);
  assert.equal(evidence.migration.id, 21);
  for (const { params } of fixture.requests.filter(({ route }) => route.endsWith('/runs'))) {
    assert.equal(params.event, 'push');
    assert.equal(params.branch, 'develop');
    assert.equal(params.head_sha, sha);
  }
  assert.equal(fixture.requests.at(-1).params.app_id, migrationContext.app.id);
});

test('a release cannot borrow green CI from another revision, branch, pull request or repository', async () => {
  for (const invalid of [
    { head_sha: otherSha }, { head_branch: 'master' }, { event: 'pull_request' },
    { head_repository: { full_name: 'someone/fork' } }, { path: '.github/workflows/untrusted.yml' },
  ]) {
    const fixture = releaseFixture();
    Object.assign(fixture.workflows['ci.yml'][0], invalid);
    await assert.rejects(fixture.verify(), { code: 'CI_MISSING' });
  }
});

test('an operator must wait for pending CI and resolve a failed newer run instead of using an older success', async () => {
  const fixture = releaseFixture();
  const run = fixture.workflows['security.yml'][0];
  fixture.workflows['security.yml'].push({ ...run, id: 13, status: 'queued', conclusion: null });
  await assert.rejects(fixture.verify(), { code: 'CI_PENDING' });
  Object.assign(fixture.workflows['security.yml'][1], { status: 'completed', conclusion: 'failure' });
  await assert.rejects(fixture.verify(), { code: 'CI_FAILED' });
  fixture.workflows['security.yml'][1].conclusion = 'success';
  assert.equal((await fixture.verify()).workflows[1].runId, 13);
});

test('missing migrations and successful migrations for another revision cannot authorize a release', async () => {
  const fixture = releaseFixture();
  fixture.migrations[0].head_sha = otherSha;
  await assert.rejects(fixture.verify(), { code: 'MIGRATION_MISSING' });
  fixture.migrations.length = 0;
  await assert.rejects(fixture.verify(), { code: 'MIGRATION_MISSING' });
});

test('a spoofed check name or another database project cannot stand in for the trusted migration deployment', async () => {
  for (const invalid of [
    { app: { id: 999, slug: migrationContext.app.slug, owner: { login: 'supabase' } } },
    { app: { id: 123, slug: 'other-app', owner: { login: 'supabase' } } },
    { app: { id: 123, slug: migrationContext.app.slug, owner: { login: 'someone' } } },
    { details_url: 'https://supabase.com/dashboard/project/production-ref' },
  ]) {
    const fixture = releaseFixture();
    Object.assign(fixture.migrations[0], invalid);
    await assert.rejects(fixture.verify(), { code: 'MIGRATION_UNTRUSTED' });
  }
});

test('an operator must resolve the latest migration attempt before deploying the server', async () => {
  const fixture = releaseFixture();
  fixture.migrations.push({ ...fixture.migrations[0], id: 22, status: 'in_progress', conclusion: null });
  await assert.rejects(fixture.verify(), { code: 'MIGRATION_PENDING' });
  Object.assign(fixture.migrations[1], { status: 'completed', conclusion: 'failure' });
  await assert.rejects(fixture.verify(), { code: 'MIGRATION_FAILED' });
  fixture.migrations[1].conclusion = 'success';
  assert.equal((await fixture.verify()).migration.id, 22);
});

test('unconfigured migration provenance and unavailable GitHub evidence fail before authorization', async () => {
  await assert.rejects(verifyGitHubGates({ repository, sha, branch: 'develop', github: async () => {} }),
    { code: 'GATE_CONFIGURATION' });
  await assert.rejects(verifyGitHubGates({ repository, sha, branch: 'develop', migrationContext,
    github: async () => { throw new Error('network unavailable'); } }), { code: 'GITHUB_API' });
});

test('a build can explicitly check CI without claiming the database is ready for deployment', async () => {
  const fixture = releaseFixture();
  const evidence = await fixture.verify({ migrationContext: null, requireMigrations: false });
  assert.equal(evidence.migration, null);
  assert.equal(fixture.requests.length, 2);
  await assert.rejects(fixture.verify({ migrationContext: null }), { code: 'GATE_CONFIGURATION' });
});
