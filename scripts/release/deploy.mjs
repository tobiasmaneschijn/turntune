import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createDokploy, createGitHub } from './clients.mjs';
import { createImageManifest } from './image-manifest.mjs';
import { inspectTarget, releaseContext, runPreflight } from './preflight.mjs';
import { verifyPromotion } from './promotion.mjs';
import { verifyIngress } from './verify-ingress.mjs';

const imageLine = '    image: ${SOUNDSPIN_IMAGE:?Set an immutable GHCR image}';
const ingressProofs = ['health', 'ready', 'socketPolling', 'websocketUpgrade', 'hostileOrigin', 'missingCredential'];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = value => createHash('sha256').update(value).digest('hex');
const active = container => container.State.Running === true || container.State.Pid > 0;
const sourceFields = ['composeId', 'environmentId', 'appName', 'name', 'sourceType', 'owner', 'repository', 'branch', 'composePath', 'composeFile', 'command', 'env', 'autoDeploy', 'serverId', 'composeType', 'randomize', 'suffix', 'isolatedDeployment', 'isolatedDeploymentsVolume', 'domains', 'mounts'];
const sourceSnapshot = compose => Object.fromEntries(sourceFields.map(key => [key, compose[key]]));

export function verifyApiContract(document) {
  const contracts = [
    ['compose.stop', 'post', ['composeId']],
    ['compose.update', 'post', ['composeId', 'sourceType', 'composeFile', 'autoDeploy']],
    ['compose.deploy', 'post', ['composeId', 'title', 'description']],
    ['docker.getContainers', 'get', ['serverId']],
    ['docker.getConfig', 'get', ['containerId', 'serverId']],
    ['swarm.getContainerStats', 'get', ['serverId']],
    ['deployment.allByCompose', 'get', ['composeId']],
    ['deployment.readLogs', 'get', ['deploymentId', 'tail']],
    ['registry.all', 'get', []],
  ];
  for (const [endpoint, method, names] of contracts) {
    const operation = document?.paths?.[`/${endpoint}`]?.[method];
    const available = method === 'post'
      ? Object.keys(operation?.requestBody?.content?.['application/json']?.schema?.properties || {})
      : (operation?.parameters || []).filter(parameter => parameter.in === 'query').map(parameter => parameter.name);
    if (!operation || names.some(name => !available.includes(name))) throw new Error(`The live Dokploy API does not support the required ${endpoint} contract.`);
  }
}

async function inspectContainer(dokploy, containerId, serverId) {
  const result = await dokploy.call('docker.getConfig', { containerId, ...(serverId ? { serverId } : {}) });
  if (!result || !result.Id || !result.State || typeof result.State.Running !== 'boolean' || !Number.isInteger(result.State.Pid)) throw new Error('Docker did not return a verifiable container inspection.');
  return result;
}

async function observeProxy(dokploy, compose, runtime) {
  const server = compose.serverId ? { serverId: compose.serverId } : {};
  const stats = await dokploy.call('swarm.getContainerStats', server);
  if (!Array.isArray(stats)) throw new Error('Could not observe the running proxy.');
  const matches = stats.filter(item => /^dokploy-traefik(?:[.-]|$)/.test(item.Name || ''));
  if (matches.length !== 1) throw new Error('Exactly one running Dokploy proxy must be observed.');
  const proxy = await inspectContainer(dokploy, matches[0].ID || matches[0].Container, compose.serverId);
  const address = proxy.NetworkSettings?.Networks?.['dokploy-network']?.IPAddress;
  if (!active(proxy) || proxy.State.Running !== true || !isIP(address || '')) throw new Error('The Dokploy proxy must be running on dokploy-network.');
  const trusted = (runtime.TRUSTED_PROXY_CIDRS || '').split(',').map(value => value.trim());
  const exact = new Set([address, `${address}/${isIP(address) === 4 ? 32 : 128}`]);
  if (trusted.length !== 1 || !exact.has(trusted[0])) throw new Error('TRUSTED_PROXY_CIDRS must trust only the proxy address currently observed on dokploy-network.');
  return address;
}

async function observeTargets(dokploy, compose) {
  const inventory = await dokploy.call('docker.getContainers', compose.serverId ? { serverId: compose.serverId } : {});
  // Dokploy can return [] after a Docker command failure. An empty response is
  // never evidence that an application exited.
  if (!Array.isArray(inventory) || inventory.length === 0 || inventory.some(item => !item.containerId || !item.name)) throw new Error('Docker container inventory is unavailable; refusing to infer an exited process.');
  const candidates = inventory.filter(item => item.name.replace(/^\//, '').startsWith(`${compose.appName}-`));
  const containers = await Promise.all(candidates.map(item => inspectContainer(dokploy, item.containerId, compose.serverId)));
  return containers.filter(item => item.Config?.Labels?.['com.docker.compose.project'] === compose.appName);
}

function assertSingleInstance(containers) {
  const running = containers.filter(active);
  if (running.length > 1) throw new Error('More than one application container is active; stop the conflicting deployment before retrying.');
  if (running.some(item => item.Config?.Labels?.['com.docker.compose.service'] !== 'soundspin')) throw new Error('An unexpected service is active in the SoundSpin Compose project.');
  return running;
}

function verifyRunningContainer(container, manifest, target) {
  if (container.State.Running !== true || container.State.Pid <= 0 || container.State.Health?.Status !== 'healthy') return false;
  if (container.Config.Image !== manifest.image || container.Config.Labels?.['org.opencontainers.image.revision'] !== manifest.revision) throw new Error('The running container does not match the verified image digest and source revision.');
  const ports = Object.entries(container.Config.Labels || {}).filter(([key]) => /^traefik\.http\.services\..+\.loadbalancer\.server\.port$/.test(key));
  if (ports.length === 0 || ports.some(([, value]) => String(value) !== '3000')) throw new Error('The running Traefik target must use container port 3000.');
  const bindings = Object.entries(container.HostConfig?.PortBindings || {}).flatMap(([port, values]) => (values || []).map(value => ({ port, ...value })));
  if (bindings.length !== 1 || bindings[0].port !== '3000/tcp' || bindings[0].HostIp !== '127.0.0.1' || String(bindings[0].HostPort) !== target.hostPort) throw new Error('The running backend must publish only its expected loopback port.');
  return true;
}

/** Stop, verify exit, replace with an immutable image, then verify the ingress. */
export async function deployRelease({
  dokploy, github, manifest, template, promotion, env = process.env,
  context = releaseContext(env), preflight = runPreflight, inspect = inspectTarget,
  verify = verifyIngress, wait = pause, attempts = 120, intervalMs = 5_000,
  root = process.cwd(), save = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n'),
}) {
  let phase = 'validation';
  let deploymentId;
  const evidenceBase = { schemaVersion: 1, environment: context.environment, githubRunId: String(env.GITHUB_RUN_ID), githubRunAttempt: String(env.GITHUB_RUN_ATTEMPT), revision: context.sha };
  try {
    if (!context.target || !/^[1-9]\d*$/.test(String(env.GITHUB_RUN_ID || '')) || !/^[1-9]\d*$/.test(String(env.GITHUB_RUN_ATTEMPT || ''))) throw new Error('Deployment requires its GitHub Actions run identity and environment.');
    const expected = await createImageManifest({ ...manifest, root });
    if (!isDeepStrictEqual(manifest, expected) || manifest.repository !== context.repository) throw new Error('The release image manifest does not match the checked-out lockfile and migrations.');
    if (context.environment === 'staging') {
      if (manifest.branch !== 'develop' || manifest.revision !== context.sha || manifest.runId !== String(env.GITHUB_RUN_ID) || manifest.runAttempt !== String(env.GITHUB_RUN_ATTEMPT)) throw new Error('Staging must deploy the image built by this exact workflow run and attempt.');
    } else {
      if (!promotion || promotion.revision !== context.sha || promotion.image !== manifest.image || !isDeepStrictEqual(promotion.manifest, manifest)) throw new Error('Production requires the verified staging promotion record.');
      const rechecked = await verifyPromotion({ github, repository: context.repository, sha: context.sha, stagingRunUrl: promotion.stagingRun?.url, loadArtifact: async () => ({ 'deployment-evidence.json': promotion.evidence }) });
      if (!isDeepStrictEqual(rechecked.manifest, manifest) || rechecked.treeSha !== promotion.treeSha) throw new Error('The production promotion record changed.');
    }
    if (typeof template !== 'string' || template.split(imageLine).length !== 2 || /^\s*build:/m.test(template)) throw new Error('The release Compose template must contain one immutable image slot and no build command.');
    const composeFile = template.replace(imageLine, `    image: ${manifest.image}`);
    let initial = await inspect(dokploy, context, env.SUPABASE_PROJECT_REF);
    const original = sourceSnapshot(initial.compose);
    verifyApiContract(await dokploy.call('settings.getOpenApiDocument'));
    if (initial.compose.command || initial.compose.randomize || initial.compose.isolatedDeployment || initial.compose.isolatedDeploymentsVolume) throw new Error('Custom Compose commands and randomized or isolated deployment modes require operator review.');
    const registries = await dokploy.call('registry.all');
    if (!Array.isArray(registries) || !registries.some(item => item.registryUrl?.replace(/^https:\/\//, '').replace(/\/$/, '') === 'ghcr.io' && item.registryType === 'cloud' && item.username && item.password && (item.serverId || null) === (initial.compose.serverId || null))) throw new Error('Configure a persistent private GHCR pull credential in Dokploy Registry on this server before deploying.');
    let proxyAddress = await observeProxy(dokploy, initial.compose, initial.runtime);
    const previous = await observeTargets(dokploy, initial.compose);
    assertSingleInstance(previous);
    // Recheck CI/migrations after approvals and artifact preparation. Read the
    // source again immediately before the first live mutation.
    const gates = await preflight('deploy', env);
    initial = await inspect(dokploy, context, env.SUPABASE_PROJECT_REF);
    if (!isDeepStrictEqual(sourceSnapshot(initial.compose), original)) throw new Error('Dokploy configuration changed during release preparation; review it and retry.');
    if (!gates?.gates) throw new Error('Release preflight did not return verified CI and migration gates.');
    const compose = initial.compose;
    const oldIds = new Set(previous.map(item => item.Id));
    phase = 'stopping';
    await dokploy.call('compose.stop', { composeId: compose.composeId }, 'POST');
    let stopped = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await observeProxy(dokploy, compose, initial.runtime);
      const old = await Promise.all([...oldIds].map(id => inspectContainer(dokploy, id, compose.serverId)));
      const current = await observeTargets(dokploy, compose);
      if (current.some(item => active(item) && !oldIds.has(item.Id))) throw new Error('A different application process started while the prior release was stopping.');
      if (old.every(item => item.State.Running === false && item.State.Pid === 0) && current.every(item => !active(item))) { stopped = true; break; }
      await wait(intervalMs);
    }
    if (!stopped) throw new Error('The prior application process did not exit; replacement was not started.');
    const beforeUpdate = await inspect(dokploy, context, env.SUPABASE_PROJECT_REF);
    if (!isDeepStrictEqual(sourceSnapshot(beforeUpdate.compose), original)) throw new Error('Dokploy configuration changed while stopping the service.');
    phase = 'configuration';
    await dokploy.call('compose.update', { composeId: compose.composeId, sourceType: 'raw', composeFile, autoDeploy: false }, 'POST');
    const updated = await inspect(dokploy, context, env.SUPABASE_PROJECT_REF);
    if (!isDeepStrictEqual(sourceSnapshot(updated.compose), { ...original, sourceType: 'raw', composeFile, autoDeploy: false })) throw new Error('Dokploy did not save the exact immutable release configuration.');
    if ((await observeTargets(dokploy, compose)).some(active)) throw new Error('An application process appeared before replacement; refusing to deploy.');
    phase = 'deployment';
    const title = `GitHub ${env.GITHUB_RUN_ID} attempt ${env.GITHUB_RUN_ATTEMPT}`;
    const oldDeployments = new Set(initial.deployments.map(item => item.deploymentId));
    await dokploy.call('compose.deploy', { composeId: compose.composeId, title, description: `Revision ${context.sha}; image ${manifest.image}` }, 'POST');
    let complete = false;
    let logsRead = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await observeProxy(dokploy, compose, initial.runtime);
      assertSingleInstance(await observeTargets(dokploy, compose));
      const deployments = await dokploy.call('deployment.allByCompose', { composeId: compose.composeId });
      if (!Array.isArray(deployments)) throw new Error('Dokploy deployment status is unavailable.');
      const matching = deployments.filter(item => !oldDeployments.has(item.deploymentId) && item.title === title);
      if (matching.length > 1 || deployments.some(item => !oldDeployments.has(item.deploymentId) && item.title !== title && ['queued', 'running'].includes(item.status))) throw new Error('A conflicting Dokploy deployment was observed.');
      if (matching.length === 1) {
        const deployment = matching[0];
        deploymentId = deployment.deploymentId;
        if (!deploymentId) throw new Error('Dokploy returned a deployment without an ID.');
        const logs = await dokploy.call('deployment.readLogs', { deploymentId, tail: 20 });
        logsRead = logs != null; // Never persist raw build logs; they may contain credentials.
        if (['error', 'failed', 'cancelled', 'canceled'].includes(deployment.status)) throw new Error('The Dokploy deployment failed; review its restricted deployment logs.');
        if (deployment.status === 'done' && logsRead) { complete = true; break; }
      }
      await wait(intervalMs);
    }
    if (!complete) throw new Error('Dokploy did not confirm a completed deployment and readable logs before the deadline.');
    phase = 'verification';
    let checks;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      proxyAddress = await observeProxy(dokploy, compose, initial.runtime);
      const running = assertSingleInstance(await observeTargets(dokploy, compose));
      if (running.length === 1 && verifyRunningContainer(running[0], manifest, context.target)) {
        try {
          const ingress = await verify(context.target.origin);
          if (!ingressProofs.every(name => ingress?.[name] === true)) throw new Error('Ingress verification returned incomplete evidence.');
          const confirmed = assertSingleInstance(await observeTargets(dokploy, compose));
          if (confirmed.length !== 1 || confirmed[0].Id !== running[0].Id || !verifyRunningContainer(confirmed[0], manifest, context.target)) throw new Error('The application changed during ingress verification.');
          checks = { singleInstance: true, ...ingress };
          break;
        } catch (error) {
          if (attempt === attempts - 1) throw new Error('The intended ingress did not pass health, Socket.IO and Origin verification before the deadline.');
        }
      }
      await wait(intervalMs);
    }
    if (!checks) throw new Error('Exactly one healthy application container was not verified before the deadline.');
    const evidence = { ...evidenceBase, imageRevision: manifest.revision, image: manifest.image, digest: manifest.digest, manifest, migrations: manifest.migrations, verified: true, checks, gates: gates.gates, config: { origin: context.target.origin, composeId: compose.composeId, environmentId: context.target.environmentId, projectRef: env.SUPABASE_PROJECT_REF, proxyAddress, templateSha256: hash(template) }, deploymentId, deploymentLogsReadable: logsRead, releaseEvidence: env.RELEASE_EVIDENCE };
    await save('deployment-evidence.json', evidence);
    return evidence;
  } catch (error) {
    // API payloads, Docker Config.Env and build logs must never enter artifacts.
    await save('failure-evidence.json', { ...evidenceBase, verified: false, phase, ...(deploymentId ? { deploymentId } : {}), message: 'Release stopped. Review the failed workflow step and restricted Dokploy deployment logs.' });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    const manifest = JSON.parse(await readFile('release-image.json', 'utf8'));
    const template = await readFile('compose.release.yaml', 'utf8');
    const promotion = env.DEPLOY_ENVIRONMENT === 'production' ? JSON.parse(await readFile('promotion.json', 'utf8')) : undefined;
    const dokploy = createDokploy({ url: env.DOKPLOY_API_URL || env.DOKPLOY_API, key: env.DOKPLOY_API_KEY });
    const evidence = await deployRelease({ dokploy, github: createGitHub(env.GH_TOKEN), manifest, template, promotion, env });
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `\nDeployed **${evidence.environment}**.\n\nRevision: \`${evidence.revision}\`\n\nImage: \`${evidence.image}\`\n\nIngress and single-instance checks passed.\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
