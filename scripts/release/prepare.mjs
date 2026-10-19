import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createGitHub } from './clients.mjs';
import { releaseContext, reviewUrl } from './preflight.mjs';
import { verifyStagingRun, verifyPromotion } from './promotion.mjs';

export async function prepare(mode, env = process.env) {
  const context = releaseContext(env);
  reviewUrl(env.RELEASE_EVIDENCE, context.repository);
  const github = createGitHub(env.GH_TOKEN);
  if (mode === 'validate') {
    if (context.environment === 'production') {
      const run = await verifyStagingRun({ github, repository: context.repository, stagingRunUrl: env.STAGING_RUN_URL });
      if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `staging-run-id=${run.id}\n`);
    }
  } else if (mode === 'image') {
    if (context.environment === 'production') {
      const promotion = await verifyPromotion({ github, repository: context.repository, sha: context.sha, stagingRunUrl: env.STAGING_RUN_URL,
        loadArtifact: async () => ({ 'deployment-evidence.json': JSON.parse(await readFile('staging-evidence/deployment-evidence.json', 'utf8')) }),
      });
      await writeFile('release-image.json', JSON.stringify(promotion.manifest, null, 2) + '\n');
      await writeFile('promotion.json', JSON.stringify({ ...promotion, revision: context.sha, image: promotion.manifest.image }, null, 2) + '\n');
    } else {
      const manifest = JSON.parse(await readFile('release-artifact/release-image.json', 'utf8'));
      if (manifest.repository !== context.repository || manifest.branch !== context.branch || manifest.revision !== context.sha || manifest.runId !== env.GITHUB_RUN_ID || manifest.runAttempt !== env.GITHUB_RUN_ATTEMPT) throw new Error('The image artifact must belong to this staging run and attempt.');
      const [source, artifact] = await Promise.all([readFile('compose.release.yaml', 'utf8'), readFile('release-artifact/compose.release.yaml', 'utf8')]);
      if (source !== artifact) throw new Error('The image artifact runtime configuration differs from the selected revision.');
      await writeFile('release-image.json', JSON.stringify(manifest, null, 2) + '\n');
    }
  } else throw new Error('Expected prepare mode validate or image.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await prepare(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
