import assert from 'node:assert/strict'
import test from 'node:test'
import { PublicRequestError, publicRequestFailure, trustedSqlRequestError } from './public-request-error.js'
import { telemetry } from '../observability/index.js'

test('caught request failures stay private when reporting fails and expected denials do not create incidents', t => {
  const reports: unknown[] = []
  t.mock.method(telemetry, 'captureError', (error: unknown) => { reports.push(error); throw new Error('Monitoring unavailable') })
  const unavailable = new Error('Database unavailable: private diagnostic')
  assert.deepEqual(publicRequestFailure(unavailable, 'Could not save. Try again.', { operation: 'room.settings.update' }),
    { status: 503, message: 'Could not save. Try again.' })
  const denied = new PublicRequestError('Only moderators can change this setting.', 403)
  assert.deepEqual(publicRequestFailure(denied, 'Could not save.'), { status: 403, message: denied.message })
  const expected = trustedSqlRequestError({ code: 'P0001', message: 'Room is full.' }, { 'Room is full.': 429 }, 'Could not save.')
  assert.equal(expected.status, 429)
  assert.deepEqual(reports, [unavailable])
  const diagnostic = { code: '08006', message: 'Private database details' }
  const failure = trustedSqlRequestError(diagnostic, {}, 'Could not save.')
  assert.equal(failure.status, 503)
  assert.equal(failure.message, 'Could not save.')
  assert.deepEqual(reports, [unavailable, diagnostic])
})
