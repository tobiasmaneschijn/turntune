import test from 'node:test';
import assert from 'node:assert/strict';
import { createDokploy, dokployBase } from './clients.mjs';
import { inspectTarget, releaseContext, targets, verifyEnvironmentProtection } from './preflight.mjs';

const context = environment => releaseContext({ DEPLOY_ENVIRONMENT: environment, GITHUB_REPOSITORY: targets.repository, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: targets[environment].branch, GITHUB_REF: `refs/heads/${targets[environment].branch}` });

test('operators can release only the assigned branch and use authenticated API requests without leaking error bodies', async () => {
  assert.equal(context('staging').branch, 'develop');
  assert.equal(context('production').branch, 'master');
  assert.throws(() => releaseContext({ DEPLOY_ENVIRONMENT: 'staging', GITHUB_REPOSITORY: targets.repository, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'master', GITHUB_REF: 'refs/heads/master' }), /requires/);
  assert.equal(dokployBase('https://deploy.example/api/api/'), 'https://deploy.example/api/');
  assert.throws(() => dokployBase('http://deploy.example'), /HTTPS/);
  const api = createDokploy({ url: 'https://deploy.example/api', key: 'fixture-secret', fetchImpl: async (url, options) => {
    assert.equal(url.href, 'https://deploy.example/api/compose.one?composeId=target');
    assert.equal(options.headers['x-api-key'], 'fixture-secret');
    return { ok: false, status: 403, text: async () => 'fixture-secret' };
  } });
  await assert.rejects(api.call('compose.one', { composeId: 'target' }), error => error.message.includes('403') && !error.message.includes('fixture-secret'));
});

test('operators cannot deploy production with staging data or an unintended public route', async () => {
  const c = context('production');
  const t = c.target;
  const ref = t.supabaseProjectRef;
  const compose = { composeId: t.composeId, environmentId: t.environmentId, name: t.service, owner: 'tobiasmaneschijn', repository: 'SoundSpin', branch: 'master', composePath: './compose.yaml', sourceType: 'github', autoDeploy: false, composeType: 'docker-compose', composeStatus: 'done', serverId: null,
    env: `APP_ORIGIN=${t.origin}/\nSUPABASE_URL=https://${ref}.supabase.co\nSOUNDSPIN_PORT=3000\nSUPABASE_PUBLISHABLE_KEY=fixture-public\nSUPABASE_SECRET_KEY=fixture-private\nSUPABASE_JWKS_URL=https://${ref}.supabase.co/auth/v1/.well-known/jwks.json\n`,
    domains: [{ host: new URL(t.origin).host, https: true, port: 3000, serviceName: 'soundspin', path: '/' }],
  };
  const api = { call: async endpoint => {
    if (endpoint === 'project.all') return [{ projectId: targets.projectId, name: targets.project, environments: [{ name: 'production', environmentId: t.environmentId, compose: [compose] }] }];
    if (endpoint === 'compose.one') return compose;
    if (endpoint === 'deployment.allByCompose') return [];
    throw new Error('Unexpected request');
  } };
  await inspectTarget(api, c, ref);
  await assert.rejects(inspectTarget(api, c, targets.staging.supabaseProjectRef), /separate/);
  compose.env = compose.env.replace(ref, targets.staging.supabaseProjectRef);
  await assert.rejects(inspectTarget(api, c, ref), /does not match/);
  compose.env = compose.env.replace(targets.staging.supabaseProjectRef, ref);
  const configured = compose.env;
  compose.env = compose.env.replace('SUPABASE_SECRET_KEY=fixture-private', 'SUPABASE_SECRET_KEY=');
  await assert.rejects(inspectTarget(api, c, ref), /requires.*server secret/);
  compose.env = configured;
  compose.domains.push({ host: 'legacy.example', https: false, port: 3000, serviceName: 'soundspin', path: '/' });
  await assert.rejects(inspectTarget(api, c, ref), /insecure/);
});

test('the deployment environment cannot grant production access to other branches or tags', async () => {
  const policy = { total_count: 1, branch_policies: [{ name: 'master', type: 'branch' }] };
  const github = { request: async route => ({ data: route.endsWith('deployment-branch-policies') ? policy : { deployment_branch_policy: { custom_branch_policies: true } } }) };
  await verifyEnvironmentProtection(github, targets.repository, 'production');
  policy.branch_policies[0].name = '*';
  await assert.rejects(verifyEnvironmentProtection(github, targets.repository, 'production'), /only its assigned/);
});
