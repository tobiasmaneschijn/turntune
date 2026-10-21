import test from 'node:test';
import assert from 'node:assert/strict';
import { createDokploy, dokployBase } from './clients.mjs';
import { inspectTarget, releaseContext, targets } from './preflight.mjs';

const context = environment => releaseContext({ DEPLOY_ENVIRONMENT: environment, GITHUB_REPOSITORY: targets.repository, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: targets[environment].branch, GITHUB_REF: `refs/heads/${targets[environment].branch}` });

test('operators can release only the assigned branch and use authenticated API requests without leaking error bodies', async () => {
  assert.equal(context('staging').branch, 'develop');
  assert.equal(context('production').branch, 'master');
  assert.equal(context('staging').repository, 'tobiasmaneschijn/turntune');
  assert.throws(() => releaseContext({ DEPLOY_ENVIRONMENT: 'staging', GITHUB_REPOSITORY: 'tobiasmaneschijn/SoundSpin', GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'develop', GITHUB_REF: 'refs/heads/develop' }), /repository/);
  assert.throws(() => releaseContext({ DEPLOY_ENVIRONMENT: 'staging', GITHUB_REPOSITORY: targets.repository, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'master', GITHUB_REF: 'refs/heads/master' }), /requires/);
  assert.throws(() => releaseContext({ DEPLOY_ENVIRONMENT: 'production', GITHUB_REPOSITORY: targets.repository, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'develop', GITHUB_REF: 'refs/heads/develop' }), /requires/);
  assert.throws(() => releaseContext({ DEPLOY_ENVIRONMENT: 'production', GITHUB_REPOSITORY: targets.repository, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'master', GITHUB_REF: 'refs/tags/master' }), /Only the develop and master branches/);
  assert.equal(dokployBase('https://deploy.example/api/api/'), 'https://deploy.example/api/');
  assert.throws(() => dokployBase('http://deploy.example'), /HTTPS/);
  const api = createDokploy({ url: 'https://deploy.example/api', key: 'fixture-secret', fetchImpl: async (url, options) => {
    assert.equal(url.href, 'https://deploy.example/api/compose.one?composeId=target');
    assert.equal(options.headers['x-api-key'], 'fixture-secret');
    return { ok: false, status: 403, text: async () => 'fixture-secret' };
  } });
  await assert.rejects(api.call('compose.one', { composeId: 'target' }), error => error.message.includes('403') && !error.message.includes('fixture-secret'));
});

function targetFixture(environment) {
  const c = context(environment);
  const t = c.target;
  const ref = t.supabaseProjectRef;
  const compose = { composeId: t.composeId, environmentId: t.environmentId, name: t.service, owner: 'tobiasmaneschijn', repository: 'turntune', branch: t.branch, composePath: './compose.yaml', sourceType: 'github', autoDeploy: false, composeType: 'docker-compose', composeStatus: 'done', serverId: null,
    env: `APP_ORIGIN=${t.origin}/\nAPP_ORIGINS=${(t.additionalOrigins || []).join(',')}\nSUPABASE_URL=https://${ref}.supabase.co\nSOUNDSPIN_PORT=${t.hostPort}\nSUPABASE_PUBLISHABLE_KEY=fixture-public\nSUPABASE_SECRET_KEY=fixture-private\nSUPABASE_JWKS_URL=https://${ref}.supabase.co/auth/v1/.well-known/jwks.json\n`,
    domains: [t.origin, ...(t.additionalOrigins || [])].map(origin => ({ host: new URL(origin).host, https: true, port: 3000, serviceName: 'soundspin', path: '/' })),
  };
  const api = { call: async endpoint => {
    if (endpoint === 'project.all') return [{ projectId: targets.projectId, name: targets.project, environments: [{ name: environment, environmentId: t.environmentId, compose: [compose] }] }];
    if (endpoint === 'compose.one') return compose;
    if (endpoint === 'deployment.allByCompose') return [];
    throw new Error('Unexpected request');
  } };
  return { c, ref, compose, api };
}

test('operators cannot deploy production with staging data or an unintended public route', async () => {
  const { c, ref, compose, api } = targetFixture('production');
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

test('staging keeps its approved legacy origin while rejecting a mistyped primary or an unapproved alias', async () => {
  const { c, ref, compose, api } = targetFixture('staging');
  compose.env += `SPOTIFY_CLIENT_ID=fixture-client\nSPOTIFY_CLIENT_SECRET=fixture-secret\nSPOTIFY_REDIRECT_URI=${c.target.origin}/api/spotify/callback\n`;
  const configured = compose.env;
  await inspectTarget(api, c, ref);
  compose.env = configured.replace('https://beta.turntune.app', 'https://beta.turntune.com');
  await assert.rejects(inspectTarget(api, c, ref), /does not match/);
  compose.env = configured.replace(`${c.target.origin}/api/spotify/callback`, 'https://beta.turntune.com/api/spotify/callback');
  await assert.rejects(inspectTarget(api, c, ref), /SPOTIFY_REDIRECT_URI/);
  compose.env = configured.replace(c.target.additionalOrigins[0], 'https://unexpected.example');
  await assert.rejects(inspectTarget(api, c, ref), /APP_ORIGINS/);
  compose.env = configured;
  compose.domains.push({ host: 'unexpected.example', https: true, port: 3000, serviceName: 'soundspin', path: '/' });
  await assert.rejects(inspectTarget(api, c, ref), /unexpected/);
  compose.domains.pop();
  const alias = compose.domains.pop();
  await assert.rejects(inspectTarget(api, c, ref), /Every approved HTTPS domain/);
  compose.domains.push(alias);
  await inspectTarget(api, c, ref);
});
