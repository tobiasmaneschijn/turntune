import { execFile } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

async function sourceMaps(directory) {
  const files = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(files.map(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceMaps(path) : entry.isFile() && entry.name.endsWith('.map') ? [path] : [];
  }));
  return nested.flat();
}

function cliEnvironment(env, token) {
  const inherited = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
  return {
    ...Object.fromEntries(inherited.filter(key => env[key] !== undefined).map(key => [key, env[key]])),
    SENTRY_LOG_LEVEL: 'error', SENTRY_DISABLE_UPDATE_CHECK: '1', SENTRY_LOAD_DOTENV: '0',
    ...(token ? { SENTRY_AUTH_TOKEN: token } : {}),
  };
}

async function runSentry(args, options) {
  // Run the package's cross-platform entrypoint without a shell or token argument.
  try {
    await execute(process.execPath, [require.resolve('@sentry/cli/bin/sentry-cli'), ...args], {
      ...options, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
    });
  } catch {
    // Remote error output and inherited CLI settings must not expose credentials.
    throw new Error('Sentry source-map processing failed. Check the upload configuration and Sentry service.');
  }
}

async function uploadToken(env) {
  if (!env.SENTRY_AUTH_TOKEN_FILE) return env.SENTRY_AUTH_TOKEN?.trim() || '';
  try { return (await readFile(env.SENTRY_AUTH_TOKEN_FILE, 'utf8')).trim(); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('Cannot read the source-map upload secret.'); }
}

/** Prepare one immutable release; source maps never remain in published output. */
export async function prepareBuild({ root = process.cwd(), env = process.env, runCli = runSentry } = {}) {
  const browser = resolve(root, 'dist');
  const server = resolve(root, 'dist-server');
  const maps = (await Promise.all([sourceMaps(browser), sourceMaps(server)])).flat();
  try {
    const revision = env.BUILD_REVISION?.trim() || 'unknown';
    if (revision !== 'unknown' && !/^[a-f0-9]{40}$/.test(revision)) throw new Error('BUILD_REVISION must be a full Git commit SHA.');
    await writeFile(resolve(server, 'build-release.json'), JSON.stringify({ revision }) + '\n');
    const token = await uploadToken(env);
    if (env.SENTRY_UPLOAD_ENABLED === 'true' && !token) throw new Error('The source-map upload secret is missing.');
    const org = env.SENTRY_ORG?.trim();
    const projects = [env.SENTRY_BROWSER_PROJECT?.trim(), env.SENTRY_SERVER_PROJECT?.trim()];
    let url;
    if (token) {
      if (!org || projects.some(project => !project) || ![org, ...projects].every(value => /^[a-zA-Z0-9_-]+$/.test(value)) || revision === 'unknown') {
        throw new Error('Source-map upload requires SENTRY_ORG, SENTRY_BROWSER_PROJECT, SENTRY_SERVER_PROJECT and a full BUILD_REVISION.');
      }
      if (env.SENTRY_URL?.trim()) {
        try {
          url = new URL(env.SENTRY_URL.trim());
          if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
        } catch { throw new Error('SENTRY_URL must be an HTTPS URL without credentials, query or fragment.'); }
      }
    }
    if (!maps.length) throw new Error('The build did not generate source maps.');
    const options = { cwd: root, env: cliEnvironment(env, token) };
    await runCli(['sourcemaps', 'inject', browser, server], options);
    if (token) {
      for (const [index, directory] of [browser, server].entries()) {
        await runCli([...(url ? ['--url', url.href] : []), 'sourcemaps', 'upload',
          '--org', org, '--project', projects[index], '--release', revision, '--validate', '--strict', '--wait', directory], options);
      }
    }
    return { revision, uploaded: Boolean(token), mapCount: maps.length };
  } finally {
    // This also runs when upload fails: no public source maps survive a failed build.
    await Promise.all(maps.map(file => rm(file)));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareBuild();
    console.log(`Release ${result.revision}: source maps ${result.uploaded ? 'uploaded privately' : 'removed (upload disabled)'}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
