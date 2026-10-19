import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageManifest } from './image-manifest.mjs';
import { deployRelease } from './deploy.mjs';
import { targets } from './preflight.mjs';

const revision = 'a'.repeat(40);
const env = { DEPLOY_ENVIRONMENT: 'staging', GITHUB_REPOSITORY: targets.repository, GITHUB_SHA: revision, GITHUB_REF: 'refs/heads/develop', GITHUB_REF_NAME: 'develop', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', SUPABASE_PROJECT_REF: targets.staging.supabaseProjectRef, RELEASE_EVIDENCE: `https://github.com/${targets.repository}/issues/1` };
const template = 'services:\n  soundspin:\n    image: ${SOUNDSPIN_IMAGE:?Set an immutable GHCR image}\n';
const manifest = await createImageManifest({ repository: targets.repository, branch: 'develop', revision, digest: `sha256:${'b'.repeat(64)}`, runId: '123', runAttempt: '1' });

function fixture({ neverExits = false, inventoryFailure = false, sourceChanges = false, missingRegistry = false, badPort = false, deploymentFails = false, aliasFails = false } = {}) {
  let stopped = false;
  let deployed = false;
  let preflightDone = false;
  const events = [];
  const saved = {};
  let compose = { composeId: targets.staging.composeId, environmentId: targets.staging.environmentId, appName: 'soundspin-staging-abcd', name: targets.staging.service, sourceType: 'github', owner: 'tobiasmaneschijn', repository: 'turntune', branch: 'develop', composePath: './compose.yaml', composeFile: '', env: 'secret=must-not-appear', autoDeploy: false, composeType: 'docker-compose', serverId: null, domains: [], mounts: [] };
  const runtime = { TRUSTED_PROXY_CIDRS: '10.0.1.2/32' };
  const proxy = { Id: 'proxy', State: { Running: true, Pid: 10 }, NetworkSettings: { Networks: { 'dokploy-network': { IPAddress: '10.0.1.2' } } } };
  function app(id, running, healthy = false) {
    return { Id: id, State: { Running: running, Pid: running ? 20 : 0, Health: { Status: healthy ? 'healthy' : 'starting' } }, Config: { Image: id === 'new' ? manifest.image : 'old-image', Env: ['SECRET=must-not-appear'], Labels: { 'com.docker.compose.project': compose.appName, 'com.docker.compose.service': 'soundspin', 'org.opencontainers.image.revision': manifest.revision, 'traefik.http.services.soundspin.loadbalancer.server.port': badPort ? '80' : '3000' } }, HostConfig: { PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3001' }] } } };
  }
  const apiContracts = [
    ['compose.stop', 'post', ['composeId']], ['compose.update', 'post', ['composeId', 'sourceType', 'composeFile', 'autoDeploy']], ['compose.deploy', 'post', ['composeId', 'title', 'description']],
    ['docker.getContainers', 'get', ['serverId']], ['docker.getConfig', 'get', ['containerId', 'serverId']], ['swarm.getContainerStats', 'get', ['serverId']],
    ['deployment.allByCompose', 'get', ['composeId']], ['deployment.readLogs', 'get', ['deploymentId', 'tail']], ['registry.all', 'get', []],
  ];
  const document = { paths: Object.fromEntries(apiContracts.map(([name, method, names]) => [`/${name}`, { [method]: method === 'post' ? { requestBody: { content: { 'application/json': { schema: { properties: Object.fromEntries(names.map(name => [name, {}])) } } } } } : { parameters: names.map(name => ({ name, in: 'query' })) } }])) };
  const dokploy = { async call(name, parameters = {}, method = 'GET') {
    events.push({ name, parameters, method });
    if (name === 'settings.getOpenApiDocument') return document;
    if (name === 'registry.all') return missingRegistry ? [] : [{ registryUrl: 'ghcr.io', registryType: 'cloud', username: 'pull-user', password: 'must-not-appear', serverId: null }];
    if (name === 'swarm.getContainerStats') return [{ ID: 'proxy', Name: 'dokploy-traefik' }];
    if (name === 'docker.getContainers') return stopped && inventoryFailure ? [] : [{ containerId: 'old', name: `${compose.appName}-soundspin-1` }, ...(deployed ? [{ containerId: 'new', name: `${compose.appName}-soundspin-2` }] : [])];
    if (name === 'docker.getConfig') {
      if (parameters.containerId === 'proxy') return structuredClone(proxy);
      if (parameters.containerId === 'old') return app('old', !stopped || neverExits);
      if (parameters.containerId === 'new') return app('new', true, true);
    }
    if (name === 'compose.stop') { assert.equal(method, 'POST'); stopped = true; return {}; }
    if (name === 'compose.update') { assert.equal(method, 'POST'); assert.ok(stopped); compose = { ...compose, ...parameters }; return {}; }
    if (name === 'compose.deploy') { assert.equal(method, 'POST'); deployed = true; return {}; }
    if (name === 'deployment.allByCompose') return deployed ? [{ deploymentId: 'deployment-1', title: 'GitHub 123 attempt 1', status: deploymentFails ? 'error' : 'done' }] : [];
    if (name === 'deployment.readLogs') return { logs: 'SECRET=must-not-appear' };
    throw new Error(`Unexpected fixture request ${name}`);
  } };
  const options = { dokploy, env, manifest, template, attempts: 2, intervalMs: 0, wait: async () => {},
    inspect: async () => ({ compose: structuredClone({ ...compose, ...(sourceChanges && preflightDone ? { branch: 'changed' } : {}) }), runtime, deployments: [] }),
    preflight: async () => { events.push({ name: 'preflight' }); preflightDone = true; return { gates: { ci: true, migrations: true } }; },
    verify: async origin => { events.push({ name: 'verifyIngress', origin }); if (aliasFails && origin === targets.staging.additionalOrigins[0]) throw new Error('The approved legacy domain is unavailable.'); return { health: true, ready: true, socketPolling: true, websocketUpgrade: true, hostileOrigin: true, missingCredential: true }; },
    save: async (path, value) => { saved[path] = value; },
  };
  return { options, events, saved };
}

test('An operator deploys the scanned staging image after the old process exits and receives verified evidence', async () => {
  const { options, events, saved } = fixture();
  const result = await deployRelease(options);
  assert.equal(result.verified, true);
  assert.equal(result.deploymentId, 'deployment-1');
  assert.equal(result.image, manifest.image);
  assert.ok(Object.values(result.checks).every(value => value === true));
  assert.deepEqual(result.migrations, manifest.migrations);
  assert.deepEqual(events.filter(item => item.name === 'verifyIngress').map(item => item.origin), [targets.staging.origin, ...targets.staging.additionalOrigins]);
  assert.deepEqual(result.config.additionalOrigins, targets.staging.additionalOrigins);
  const names = events.map(item => item.name);
  assert.ok(names.indexOf('preflight') < names.indexOf('compose.stop'));
  assert.ok(names.indexOf('compose.stop') < names.indexOf('compose.update'));
  assert.ok(names.indexOf('compose.update') < names.indexOf('compose.deploy'));
  assert.match(events.find(item => item.name === 'compose.update').parameters.composeFile, new RegExp(manifest.digest));
  assert.equal(events.filter(item => item.name === 'compose.deploy').length, 1);
  assert.equal(events.some(item => item.name === 'compose.redeploy'), false);
  assert.equal(JSON.stringify(saved).includes('must-not-appear'), false);
});

test('An operator can retry a blocked release without starting a replacement when the old process exit cannot be proved', async () => {
  for (const failure of [{ neverExits: true }, { inventoryFailure: true }]) {
    const { options, events, saved } = fixture(failure);
    await assert.rejects(deployRelease(options), /did not exit|inventory is unavailable/);
    assert.equal(events.some(item => item.name === 'compose.update' || item.name === 'compose.deploy'), false);
    assert.equal(saved['failure-evidence.json'].phase, 'stopping');
    assert.equal(JSON.stringify(saved).includes('must-not-appear'), false);
  }
});

test('An operator sees changed configuration or missing pull credentials before the live service is stopped', async () => {
  for (const failure of [{ sourceChanges: true }, { missingRegistry: true }]) {
    const { options, events } = fixture(failure);
    await assert.rejects(deployRelease(options), /configuration changed|persistent private GHCR/);
    assert.equal(events.some(item => item.method === 'POST'), false);
  }
});

test('A failed deployment or failed ingress cannot produce a successful release or an automatic rollback', async () => {
  for (const failure of [{ deploymentFails: true }, { badPort: true }, { aliasFails: true }]) {
    const { options, events, saved } = fixture(failure);
    await assert.rejects(deployRelease(options), /deployment failed|container port 3000|intended ingress/);
    assert.equal(saved['deployment-evidence.json'], undefined);
    assert.equal(saved['failure-evidence.json'].verified, false);
    assert.equal(events.filter(item => item.name === 'compose.deploy').length, 1);
    assert.equal(events.some(item => /rollback|start|redeploy/.test(item.name)), false);
    assert.equal(JSON.stringify(saved).includes('must-not-appear'), false);
  }
});
