import assert from 'node:assert/strict';
import test from 'node:test';
import { createDokploy } from './clients.mjs';

const secret = 'fixture-private-response';
const makeClient = (fetchImpl, wait = async () => {}) => createDokploy({
  url: 'https://deploy.example/api', key: secret, fetchImpl, wait,
});
const safeError = (endpoint, status) => error => {
  assert.match(error.message, new RegExp(`${endpoint.replace('.', '\\.')}.*${status}`));
  assert.equal(error.message.includes(secret), false);
  return true;
};

test('An operator keeps polling after empty or truncated reads and receives status without repeating a mutation', async () => {
  const delays = [];
  const requests = [];
  const api = makeClient(async (url, options) => {
    requests.push({ url: url.href, method: options.method });
    if (requests.length < 3) return new Response(requests.length === 1 ? ' \n' : '{"status":', { status: 200 });
    return Response.json([{ deploymentId: 'release-1', status: 'done' }]);
  }, async milliseconds => { delays.push(milliseconds); });

  assert.deepEqual(await api.call('deployment.allByCompose', { composeId: 'target' }), [{ deploymentId: 'release-1', status: 'done' }]);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.method === 'GET' && request.url === 'https://deploy.example/api/deployment.allByCompose?composeId=target'));
  assert.deepEqual(delays, [200, 400]);
});

test('An operator gets a bounded, redacted error when a required Dokploy read stays empty or returns invalid JSON', async () => {
  let emptyRequests = 0;
  const empty = makeClient(async () => { emptyRequests++; return new Response(null, { status: 204 }); });
  await assert.rejects(empty.call('docker.getConfig', { containerId: 'target' }), safeError('docker.getConfig', 204));
  assert.equal(emptyRequests, 3);

  let invalidRequests = 0;
  const invalid = makeClient(async () => { invalidRequests++; return new Response(secret, { status: 200 }); });
  await assert.rejects(invalid.call('docker.getConfig', { containerId: 'target' }), safeError('docker.getConfig', 200));
  assert.equal(invalidRequests, 3);
});

test('An operator accepts an empty successful Compose command once and never retries an uncertain mutation', async () => {
  for (const [endpoint, status] of [['compose.stop', 200], ['compose.update', 204], ['compose.deploy', 200]]) {
    const requests = [];
    const api = makeClient(async (url, options) => { requests.push({ url, options }); return new Response(null, { status }); });
    await api.call(endpoint, { composeId: 'target' }, 'POST');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(requests[0].options.body), { composeId: 'target' });
  }

  let requests = 0;
  const invalid = makeClient(async () => { requests++; return new Response(secret, { status: 200 }); });
  await assert.rejects(invalid.call('compose.deploy', { composeId: 'target' }, 'POST'), safeError('compose.deploy', 200));
  assert.equal(requests, 1);
});
