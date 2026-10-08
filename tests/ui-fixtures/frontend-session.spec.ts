import { expect, test } from '@playwright/test'

declare global { interface Window { frontendSessionTest: { requests: Array<{ event: string; payload: unknown; timeout: number }>; replies: Array<(error: Error | null, result?: { ok: boolean }) => void>; connected: boolean };
  roomSessionTest: { joins: Array<{ password?: string }>; transport: { connected: boolean; auth: { accessToken?: string } } } } }
const profile = { user_id: '00000000-0000-4000-8000-000000000001', display_name: 'Alice', bio: 'Saved bio', avatar_key: 'pulse', avatar_url: null,
  avatar_path: null, theme_key: 'afterglow', is_app_admin: false, created_at: '2026-01-15T12:00:00Z', updated_at: '2026-07-31T12:00:00Z' }

test('credential rotation preserves edited profile fields and the next save uses the fresh token', async ({ page }) => {
  let loads = 0, saveToken = ''
  await page.route('**/api/profiles/*', (route) => { loads++; return route.fulfill({ json: { profile, options: [] } }) })
  await page.route('**/api/social', (route) => route.fulfill({ json: { people: [], shareActivity: false } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { library: { picks: [], sets: [] } } }))
  await page.route('**/api/profile', (route) => {
    saveToken = route.request().headers().authorization
    const body = route.request().postDataJSON() as { displayName: string; bio: string }
    return route.fulfill({ json: { profile: { ...profile, display_name: body.displayName, bio: body.bio } } })
  })
  await page.goto('/tests/frontend-session-harness/index.html')
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Display name', { exact: true }).fill('Unsaved name')
  await page.getByLabel('Bio', { exact: true }).fill('Unsaved bio')
  await page.getByRole('button', { name: 'Rotate token' }).click()
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Unsaved name')
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Unsaved bio')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Unsaved name', exact: true })).toBeVisible()
  expect(loads).toBe(1)
  expect(saveToken).toBe('Bearer token-two')
})

test('room roles reject offline commands, disable duplicates while pending and release after timeout', async ({ page }) => {
  await page.goto('/tests/frontend-session-harness/index.html?surface=roles')
  const moderator = page.getByRole('button', { name: 'Moderator — Bob', exact: true })
  await expect(moderator).toBeDisabled()
  expect(await page.evaluate(() => window.frontendSessionTest.requests)).toHaveLength(0)
  // The open dialog owns focus; change the simulated connection via its backing control.
  await page.getByRole('button', { name: 'Toggle connection', includeHidden: true }).evaluate((button) => (button as HTMLButtonElement).click())
  await moderator.click()
  await expect(moderator).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
  const requests = await page.evaluate(() => window.frontendSessionTest.requests)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toEqual({ event: 'room:moderator:set', payload: { roomId: 'lounge', userId: '00000000-0000-4000-8000-000000000002', moderator: true }, timeout: 15000 })
  await page.evaluate(() => window.frontendSessionTest.replies.shift()!(new Error('Timed out')))
  await expect(page.getByRole('alert')).toContainText('request timed out')
  await expect(moderator).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
})

test('room navigation preserves the underlying profile visit and reauthenticates on token rotation', async ({ page }) => {
  await page.goto('/tests/frontend-session-harness/index.html?surface=session')
  await page.getByRole('button', { name: 'Open room', exact: true }).click()
  await expect(page.getByTestId('admission')).toHaveText('admitted')
  await expect(page).toHaveURL(/\/room\/lounge$/)
  expect(await page.evaluate(() => window.roomSessionTest.joins)).toEqual([expect.objectContaining({ password: 'room-password' })])
  await page.getByRole('button', { name: 'Open profile', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('profile')
  await expect(page.getByTestId('room')).toHaveText('lounge')
  await expect(page.getByTestId('snapshot')).toHaveText('lounge')
  await page.getByRole('button', { name: 'Back from profile', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('room')
  await expect(page.getByTestId('snapshot')).toHaveText('lounge')
  await page.getByRole('button', { name: 'Rotate token', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.roomSessionTest.joins.length)).toBe(2)
  expect(await page.evaluate(() => window.roomSessionTest.transport.auth.accessToken)).toBe('token-two')
  await expect(page.getByTestId('admission')).toHaveText('admitted')
  await page.getByRole('button', { name: 'Leave room', exact: true }).click()
  await expect(page.getByTestId('route')).toHaveText('lobby')
  await expect(page.getByTestId('snapshot')).toHaveText('none')
  expect(await page.evaluate(() => window.roomSessionTest.transport.connected)).toBe(false)
})
