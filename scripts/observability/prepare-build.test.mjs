import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareBuild } from './prepare-build.mjs';

const revision = 'a'.repeat(40);
const require = createRequire(import.meta.url);
const configured = { BUILD_REVISION: revision, SENTRY_AUTH_TOKEN: 'fixture-upload-secret', SENTRY_ORG: 'fixture-org',
  SENTRY_BROWSER_PROJECT: 'web', SENTRY_SERVER_PROJECT: 'server', SUPABASE_SECRET_KEY: 'must-not-reach-cli',
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };

async function buildFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'turntune-source-maps-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const maps = [];
  for (const directory of ['dist/assets', 'dist-server/server']) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, 'app.js'), 'throw new Error("fixture");');
    const map = join(root, directory, 'app.js.map');
    await writeFile(map, JSON.stringify({ version: 3, file: 'app.js', names: [], mappings: 'AAAA', sources: ['private.ts'], sourcesContent: ['private source'] }));
    maps.push(map);
  }
  return { root, maps };
}

test('Publishing a release uploads matching private maps and leaves no maps or upload credentials in runtime output', async t => {
  const { root, maps } = await buildFixture(t);
  const calls = [];
  const result = await prepareBuild({ root, env: configured, runCli: async (args, options) => {
    calls.push(args);
    assert.equal(options.env.SENTRY_AUTH_TOKEN, configured.SENTRY_AUTH_TOKEN);
    assert.equal(options.env.SUPABASE_SECRET_KEY, undefined);
    assert.ok(!args.includes(configured.SENTRY_AUTH_TOKEN));
    for (const map of maps) assert.ok((await stat(map)).isFile());
    if (args[1] === 'inject') {
      execFileSync(process.execPath, [require.resolve('@sentry/cli/bin/sentry-cli'), ...args], { ...options, stdio: 'pipe' });
      for (const map of maps) {
        const sourceMap = JSON.parse(await readFile(map, 'utf8'));
        assert.match(sourceMap.debugId ?? sourceMap.debug_id, /^[a-f0-9-]{36}$/);
        assert.ok((await readFile(map.slice(0, -4), 'utf8')).includes(sourceMap.debugId ?? sourceMap.debug_id));
      }
    }
  } });
  assert.equal(result.uploaded, true);
  assert.equal(calls[0][1], 'inject');
  assert.deepEqual(calls.slice(1).map(args => args[args.indexOf('--project') + 1]), ['web', 'server']);
  for (const args of calls.slice(1)) assert.equal(args[args.indexOf('--release') + 1], revision);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'dist-server/build-release.json'), 'utf8')), { revision });
  for (const map of maps) await assert.rejects(stat(map), { code: 'ENOENT' });
});

test('An operator cannot publish maps after incomplete upload configuration or an upload failure', async t => {
  for (const failure of ['configuration', 'missing-secret', 'upload']) {
    const { root, maps } = await buildFixture(t);
    let calls = 0;
    await assert.rejects(prepareBuild({ root,
      env: failure === 'configuration' ? { ...configured, SENTRY_SERVER_PROJECT: '' }
        : failure === 'missing-secret' ? { ...configured, SENTRY_AUTH_TOKEN_FILE: join(root, 'missing-token'), SENTRY_UPLOAD_ENABLED: 'true' } : configured,
      runCli: async args => { calls++; if (args[1] === 'upload') throw new Error('Upload unavailable'); },
    }), failure === 'configuration' ? /requires SENTRY_ORG/ : failure === 'missing-secret' ? /secret is missing/ : /Upload unavailable/);
    assert.equal(calls, failure === 'upload' ? 2 : 0);
    for (const map of maps) await assert.rejects(stat(map), { code: 'ENOENT' });
  }
});
