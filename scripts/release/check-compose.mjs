import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Resolve both real configurations with fixture values. Never print runtime
// configuration or inherit the operator's Supabase/provider credentials.
const env = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
  APP_ORIGIN: 'https://soundspin.example',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable',
  SUPABASE_SECRET_KEY: 'fixture-server-only',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
  SOUNDSPIN_IMAGE: `ghcr.io/tobiasmaneschijn/turntune@sha256:${'a'.repeat(64)}`,
  SOUNDSPIN_REVISION: 'b'.repeat(40),
};
// An explicit standalone Compose executable also supports validation on hosts
// without Docker Engine or a globally installed Docker CLI.
const composeBinary = process.env.COMPOSE_BINARY || 'docker';
const composePrefix = process.env.COMPOSE_BINARY ? [] : ['compose'];
const load = file => JSON.parse(execFileSync(composeBinary, [...composePrefix, '--env-file', '.env.example', '-f', file, 'config', '--format', 'json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
try {
  const local = load('compose.yaml');
  const release = load('compose.release.yaml');
  assert.equal(release.services.soundspin.image, env.SOUNDSPIN_IMAGE);
  assert.equal(release.services.soundspin.pull_policy, 'always');
  assert.equal(release.services.soundspin.build, undefined, 'Releases must pull the scanned image without rebuilding.');
  delete local.services.soundspin.build;
  delete release.services.soundspin.image;
  delete release.services.soundspin.pull_policy;
  assert.deepEqual(release, local, 'Release and source builds must retain the same runtime protections, volumes, ingress and environment.');
  console.log('Source and release Compose runtime configurations match.');
} catch {
  console.error('Compose release validation failed. Check Docker Compose availability and runtime configuration parity.');
  process.exitCode = 1;
}
