import { expect, test, type Page } from '@playwright/test'

const aliceId = '00000000-0000-4000-8000-000000000001'
const bobId = '00000000-0000-4000-8000-000000000002'
const song = { provider: 'youtube', providerId: 'abcdefghijk', title: 'First song', artist: 'One' }
const secondSong = { provider: 'youtube', providerId: 'lmnopqrstuv', title: 'Second song', artist: 'Two' }
const oldPath = `${aliceId}/00000000-0000-4000-8000-000000000099.png`
const profile = { user_id: aliceId, display_name: 'Alice', bio: 'Saved bio', handle: 'alice', status_text: 'Saved status',
  favorite_tracks: [song], avatar_key: 'pulse', avatar_url: `https://example.supabase.co/storage/v1/object/public/profile-avatars/${oldPath}`,
  avatar_path: oldPath, theme_key: 'afterglow', is_app_admin: false, created_at: '2026-01-15T12:00:00Z', updated_at: '2026-07-31T12:00:00Z' }
const options = [{ key: 'pulse', kind: 'avatar', name: 'Pulse', metadata: {} }, { key: 'orbit', kind: 'avatar', name: 'Orbit', metadata: {} }]
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSCkAAAAASUVORK5CYII=', 'base64')

async function fixture(page: Page) {
  await page.addInitScript((id) => {
    const expires = Math.floor(Date.now() / 1000) + 86_400;
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: expires })}.fixture-signature`;
    localStorage.setItem('soundspin-auth', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: expires, expires_in: 86_400,
      token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated', email: 'alice@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  }, aliceId);
  await page.route('**/api/profiles/*', route => route.fulfill({ json: { profile: route.request().url().endsWith(bobId)
    ? { ...profile, user_id: bobId, display_name: 'Bob', handle: 'bob', avatar_url: null, avatar_path: null } : profile, options } }))
  await page.route('**/api/social', route => route.fulfill({ json: { people: [], shareActivity: false } }))
  await page.route('**/api/library', route => route.fulfill({ json: { library: { picks: [song, secondSong].map((track, index) => ({ id: String(index), track, savedAt: index })), sets: [] } } }))
  await page.route('**/api/uploads/cleanup', route => route.fulfill({ json: { ok: true } }))
  await page.route('**/storage/v1/object/public/**', route => route.fulfill({ contentType: 'image/png', body: image }))
}
async function edit(page: Page, query = 'embedded') {
  await page.goto(`/tests/browser/profiles/harness/index.html?${query}`)
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
}
async function selectImage(page: Page) {
  await page.locator('.avatar-upload input[type=file]').setInputFiles({ name: 'new-avatar.png', mimeType: 'image/png', buffer: image })
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', /^blob:/)
}

test('edit a profile and avatar, then retry a failed save without losing the draft', async ({ page }) => {
  await fixture(page)
  let uploadedPath = '', uploads = 0, saves = 0
  const submittedPaths: string[] = [], removed: string[] = []
  await page.route('**/api/uploads/cleanup', route => { removed.push(...route.request().postDataJSON().storagePaths); return route.fulfill({ json: { ok: true } }) })
  await page.route('**/api/uploads/avatar', route => {
    uploads++; uploadedPath = `${aliceId}/${crypto.randomUUID()}.png`
    return route.fulfill({ json: { storagePath: uploadedPath } })
  })
  await page.route('**/api/profile', route => {
    const submitted = route.request().postDataJSON()
    saves++; submittedPaths.push(submitted.customAvatarPath)
    if (saves === 1) return route.fulfill({ status: 422, json: { error: 'Profile saving unavailable. Try again.' } })
    return route.fulfill({ json: { profile: { ...profile, bio: submitted.bio, favorite_tracks: submitted.favoriteTracks,
      avatar_path: uploadedPath, avatar_url: `https://example.supabase.co/storage/v1/object/public/profile-avatars/${uploadedPath}` } } })
  })
  await edit(page, '')
  await selectImage(page)
  await page.getByLabel('Bio', { exact: true }).fill('Friday DJ')
  await page.getByRole('button', { name: 'Add Second song to favorites', exact: true }).click()
  await page.getByRole('link', { name: 'Rooms', exact: true }).click()
  const discard = page.getByRole('dialog', { name: 'Discard changes?', exact: true })
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Friday DJ')
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', /^blob:/)
  expect(uploads).toBe(0)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Profile saving unavailable')
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', profile.avatar_url)
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Friday DJ')
  await expect(page.getByRole('list', { name: 'Selected favorite songs' })).toContainText('Second song')
  expect(removed).toEqual([])
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => saves).toBe(2)
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible()
  expect(uploads).toBe(1)
  expect(submittedPaths).toEqual([uploadedPath, uploadedPath])
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', `https://example.supabase.co/storage/v1/object/public/profile-avatars/${uploadedPath}`)
  await expect(page.getByText('Friday DJ', { exact: true })).toBeVisible()
  expect(removed).toEqual([])
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Bio', { exact: true }).fill('Unsaved replacement')
  await page.getByRole('link', { name: 'turntune home', exact: true }).click()
  await discard.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Profile closed$/ })).toBeVisible()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Friday DJ', { exact: true })).toBeVisible()
  expect(saves).toBe(2)
})

test('switch accounts without exposing or submitting the previous profile draft', async ({ page }) => {
  await fixture(page)
  const writes: string[] = []
  await page.route('**/api/profile', route => { writes.push('profile'); return route.fulfill({ json: { profile } }) })
  await page.route('**/api/uploads/avatar', route => { writes.push('storage'); return route.fulfill({ json: {} }) })
  await edit(page)
  await selectImage(page)
  await page.getByLabel('Bio', { exact: true }).fill('Private old-account draft')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Bob')
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Saved bio')
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', '/avatars/pulse.svg')
  expect(writes).toEqual([])
})
