import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createGitHub, createDokploy } from './clients.mjs';
import { verifyGitHubGates } from './github-gates.mjs';
import { verifyReleaseReview } from './release-review.mjs';

export const targets = JSON.parse(await readFile(new URL('../../deploy/targets.json', import.meta.url), 'utf8'));

export function releaseContext(env = process.env) {
  const environment = env.DEPLOY_ENVIRONMENT;
  const branch = env.GITHUB_REF_NAME;
  if (env.GITHUB_REPOSITORY !== targets.repository) throw new Error('Release repository does not match the configured SoundSpin repository.');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('A full GitHub revision is required.');
  if (environment && (!targets[environment] || targets[environment].branch !== branch)) throw new Error('Staging requires develop; production requires master.');
  if (!['develop', 'master'].includes(branch) || env.GITHUB_REF !== `refs/heads/${branch}`) throw new Error('Only the develop and master branches may release.');
  return { repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, branch, environment, target: targets[environment] };
}

export function reviewUrl(value, repository) {
  let url; try { url = new URL(value); } catch { throw new Error('Supply the GitHub issue or pull request containing the release evidence.'); }
  const prefix = `/${repository}/`;
  if (url.origin !== 'https://github.com' || url.username || url.password || !url.pathname.startsWith(prefix) || !/^(issues|pull)\/[1-9]\d*(?:\/.*)?$/.test(url.pathname.slice(prefix.length)) || url.search) throw new Error('Release evidence must be an issue or pull request in this repository.');
  return url.href;
}

export async function verifyEnvironmentProtection(github, repository, environment) {
  const [owner, repo] = repository.split('/');
  const { data } = await github.request('GET /repos/{owner}/{repo}/environments/{environment_name}', { owner, repo, environment_name: environment });
  if (!data.deployment_branch_policy?.custom_branch_policies) throw new Error('Configure an explicit deployment branch policy for the GitHub Environment.');
  const { data: policies } = await github.request('GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies', { owner, repo, environment_name: environment, per_page: 100 });
  if (policies.total_count !== 1 || policies.branch_policies?.[0]?.name !== targets[environment].branch || policies.branch_policies[0].type !== 'branch') throw new Error('The GitHub Environment must allow only its assigned release branch.');
}

export function parseRuntime(value = '') {
  const entries = [];
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let content = match[2].trim();
    if ((content.startsWith('"') && content.endsWith('"')) || (content.startsWith("'") && content.endsWith("'"))) content = content.slice(1, -1);
    if (entries.some(([key]) => key === match[1])) throw new Error(`Duplicate Dokploy variable: ${match[1]}.`);
    entries.push([match[1], content]);
  }
  return Object.fromEntries(entries);
}

function exactHttpsOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Deployment origins must be exact HTTPS origins.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) throw new Error('Deployment origins must be exact HTTPS origins.');
  return url.origin;
}

export function targetOrigins(target) {
  if (target.additionalOrigins !== undefined && !Array.isArray(target.additionalOrigins)) throw new Error('Deployment additionalOrigins must be an exact origin list.');
  return [...new Set([target.origin, ...(target.additionalOrigins || [])].map(exactHttpsOrigin))];
}

export async function inspectTarget(dokploy, context, projectRef) {
  const { target, environment, repository } = context;
  if (!target) throw new Error('Select a deployment environment.');
  if (!/^[a-z]{20}$/.test(projectRef || '')) throw new Error('SUPABASE_PROJECT_REF must identify the intended Supabase project.');
  if (environment === 'production' && projectRef === targets.staging.supabaseProjectRef) throw new Error('Production must use a separate Supabase project.');
  if (projectRef !== target.supabaseProjectRef) throw new Error('Supabase project does not match the verified environment target.');
  const projects = await dokploy.call('project.all');
  const project = projects.find(item => item.projectId === targets.projectId && item.name === targets.project);
  const discovered = project?.environments?.find(item => item.environmentId === target.environmentId && item.name === environment)?.compose?.find(item => item.composeId === target.composeId && item.name === target.service);
  if (!discovered) throw new Error('The existing Dokploy project, environment or Compose service no longer matches the release target.');
  const compose = await dokploy.call('compose.one', { composeId: target.composeId });
  if (compose.environmentId !== target.environmentId || compose.name !== target.service || `${compose.owner}/${compose.repository}` !== repository || compose.branch !== target.branch || compose.composePath !== './compose.yaml' || !['github', 'raw'].includes(compose.sourceType) || compose.autoDeploy !== false || compose.composeType !== 'docker-compose' || compose.serverId) throw new Error('Dokploy source, branch, Compose type or manual-deployment configuration differs from the verified target.');
  if (compose.composeStatus === 'running') throw new Error('Dokploy already has a deployment in progress.');
  const runtime = parseRuntime(compose.env);
  const origins = targetOrigins(target);
  let origin; try { origin = exactHttpsOrigin(runtime.APP_ORIGIN); } catch { throw new Error('Dokploy APP_ORIGIN is invalid.'); }
  if (origin !== origins[0] || runtime.SUPABASE_URL?.replace(/\/$/, '') !== `https://${projectRef}.supabase.co` || String(runtime.SOUNDSPIN_PORT || '3000') !== target.hostPort) throw new Error('Dokploy origin, database or loopback port does not match this environment.');
  if (!runtime.SUPABASE_PUBLISHABLE_KEY || !runtime.SUPABASE_SECRET_KEY || runtime.SUPABASE_JWKS_URL !== `https://${projectRef}.supabase.co/auth/v1/.well-known/jwks.json`) throw new Error('Dokploy requires the project’s publishable key, server secret and exact JWKS URL before stopping the active service.');
  if ([runtime.SPOTIFY_CLIENT_ID, runtime.SPOTIFY_CLIENT_SECRET, runtime.SPOTIFY_REDIRECT_URI].some(value => value?.trim())) {
    if (!runtime.SPOTIFY_CLIENT_ID?.trim() || !runtime.SPOTIFY_CLIENT_SECRET?.trim()) throw new Error('Configured Spotify requires both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET before deploying.');
    if (runtime.SPOTIFY_REDIRECT_URI !== `${origin}/api/spotify/callback`) throw new Error('SPOTIFY_REDIRECT_URI must exactly match APP_ORIGIN/api/spotify/callback before deploying.');
  }
  const expectedAliases = new Set(origins.slice(1));
  let aliases;
  try { aliases = new Set((runtime.APP_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(exactHttpsOrigin)); }
  catch { throw new Error('Dokploy APP_ORIGINS must match the approved additional origins.'); }
  if (aliases.size !== expectedAliases.size || [...aliases].some(value => !expectedAliases.has(value))) throw new Error('Dokploy APP_ORIGINS must match the approved additional origins.');
  const domains = compose.domains || [];
  const hosts = new Set(origins.map(value => new URL(value).host));
  if (domains.some(item => item.serviceName !== 'soundspin' || item.https !== true || !hosts.has(item.host) || item.port !== 3000 || item.path !== '/')) throw new Error('Remove unexpected or insecure SoundSpin ingress routes before deploying.');
  if ([...hosts].some(host => !domains.some(item => item.host === host))) throw new Error('Every approved HTTPS domain must route to soundspin container port 3000.');
  const deployments = await dokploy.call('deployment.allByCompose', { composeId: target.composeId });
  if (deployments.some(item => ['queued', 'running'].includes(item.status))) throw new Error('Dokploy has a queued or running deployment.');
  return { compose, runtime, deployments };
}

export async function runPreflight(mode, env = process.env) {
  const context = releaseContext(env);
  const github = createGitHub(env.GH_TOKEN);
  const imageOnly = mode === 'image';
  if (!imageOnly && mode !== 'deploy') throw new Error('Expected preflight mode image or deploy.');
  let migrationContext;
  if (!imageOnly) {
    reviewUrl(env.RELEASE_EVIDENCE, context.repository);
    await verifyEnvironmentProtection(github, context.repository, context.environment);
    context.review = await verifyReleaseReview({ github, repository: context.repository, sha: context.sha, environment: context.environment, releaseEvidenceUrl: env.RELEASE_EVIDENCE, stagingRunUrl: env.STAGING_RUN_URL });
    try { migrationContext = JSON.parse(env.MIGRATION_CHECK_JSON); } catch { throw new Error('Configure MIGRATION_CHECK_JSON from the observed Supabase GitHub check.'); }
    const expectedIdentity = `https://supabase.com/dashboard/project/${env.SUPABASE_PROJECT_REF}`;
    if (!env.SUPABASE_PROJECT_REF || migrationContext.identity?.field !== 'details_url' || ![expectedIdentity, `${expectedIdentity}/branches`].includes(migrationContext.identity.value)) throw new Error('The migration check identity must identify this environment’s Supabase dashboard project.');
  }
  const gates = await verifyGitHubGates({ github, ...context, migrationContext, requireMigrations: !imageOnly });
  if (context.review) gates.releaseReview = context.review;
  if (!imageOnly) {
    const dokploy = createDokploy({ url: env.DOKPLOY_API_URL || env.DOKPLOY_API, key: env.DOKPLOY_API_KEY });
    await inspectTarget(dokploy, context, env.SUPABASE_PROJECT_REF);
  }
  const evidence = { ...context, gates }; delete evidence.target;
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `\nRevision: \`${context.sha}\`\n\n${imageOnly ? 'Image CI gates passed.' : `Target: **${context.environment}**. CI and migration gates passed. Release review: ${reviewUrl(env.RELEASE_EVIDENCE, context.repository)}`}\n`);
  if (mode === 'deploy') await writeFile('release-preflight.json', JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runPreflight(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
