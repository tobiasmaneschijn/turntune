import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createGitHub } from './clients.mjs';
import { releaseContext } from './preflight.mjs';
import { discoverStagingRun, verifyPromotion } from './promotion.mjs';
import { verifyDeploymentDispatch } from './dispatch.mjs';

export async function prepare(mode, env = process.env, { github = createGitHub(env.GH_TOKEN), read = readFile, write = writeFile, append = appendFile } = {}) {
  const context = releaseContext(env);
  if (mode === 'validate') {
    const dispatch = await verifyDeploymentDispatch({ github, ...context, eventName: env.GITHUB_EVENT_NAME,
      confirmed: env.DEPLOYMENT_CONFIRMED, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
    if (context.environment === 'production') {
      const run = await discoverStagingRun({ github, repository: context.repository, sha: context.sha, before: dispatch.dispatchedAt });
      if (env.GITHUB_OUTPUT) await append(env.GITHUB_OUTPUT, `staging-run-id=${run.id}\nstaging-run-url=${run.url}\n`);
      if (env.GITHUB_STEP_SUMMARY) await append(env.GITHUB_STEP_SUMMARY, `\nStaging deployment: ${run.url}\n`);
    }
  } else if (mode === 'image') {
    if (context.environment === 'production') {
      const promotion = await verifyPromotion({ github, repository: context.repository, sha: context.sha, stagingRunUrl: env.STAGING_RUN_URL,
        loadArtifact: async () => ({ 'deployment-evidence.json': JSON.parse(await read('staging-evidence/deployment-evidence.json', 'utf8')) }),
      });
      await write('release-image.json', JSON.stringify(promotion.manifest, null, 2) + '\n');
      await write('promotion.json', JSON.stringify({ ...promotion, revision: context.sha, image: promotion.manifest.image }, null, 2) + '\n');
    } else {
      const manifest = JSON.parse(await read('release-artifact/release-image.json', 'utf8'));
      if (manifest.repository !== context.repository || manifest.branch !== context.branch || manifest.revision !== context.sha || manifest.runId !== env.GITHUB_RUN_ID || manifest.runAttempt !== env.GITHUB_RUN_ATTEMPT) throw new Error('The image artifact must belong to this staging run and attempt.');
      const [source, artifact] = await Promise.all([read('compose.release.yaml', 'utf8'), read('release-artifact/compose.release.yaml', 'utf8')]);
      if (source !== artifact) throw new Error('The image artifact runtime configuration differs from the selected revision.');
      await write('release-image.json', JSON.stringify(manifest, null, 2) + '\n');
    }
  } else throw new Error('Expected prepare mode validate or image.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await prepare(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
