import { expect, test, type Page, type Route } from '@playwright/test'

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
  await page.goto(`/tests/frontend-session-harness/index.html?${query}`)
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
}
async function selectImage(page: Page) {
  await page.locator('.avatar-upload input[type=file]').setInputFiles({ name: 'new-avatar.png', mimeType: 'image/png', buffer: image })
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', /^blob:/)
}

// These exercise production ProfilePage, RoomProfileDialog, FriendsPanel, and the trusted upload adapter.
test('embedded profile protects dirty Escape and backdrop dismissal and allows pristine dismissal', async ({ page }) => {
  await fixture(page)
  await page.goto('/tests/frontend-session-harness/index.html?dialog')
  await expect(page.getByRole('dialog', { name: 'Profile', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open profile', exact: true }).click()
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Bio', { exact: true }).fill('Unsaved profile text')
  await page.getByRole('button', { name: 'Add Second song to favorites', exact: true }).click()
  await page.keyboard.press('Escape')
  const confirmation = page.getByRole('dialog', { name: 'Discard changes?', exact: true })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Unsaved profile text')
  await expect(page.getByRole('list', { name: 'Selected favorite songs' })).toContainText('Second song')
  await page.mouse.click(3, 3)
  await expect(confirmation).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirmation).toHaveCount(0)
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Unsaved profile text')
  await page.keyboard.press('Escape')
  await confirmation.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open profile', exact: true }).click()
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Saved bio')
  await expect(page.getByRole('list', { name: 'Selected favorite songs' })).not.toContainText('Second song')
})

test('profile cannot be dismissed while a submitted save is pending', async ({ page }) => {
  await fixture(page)
  let pending: Route | undefined
  await page.route('**/api/profile', route => { pending = route })
  await edit(page, 'dialog')
  await page.getByLabel('Bio', { exact: true }).fill('New bio')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => Boolean(pending)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
  await pending!.fulfill({ json: { profile: { ...profile, bio: 'New bio' } } })
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('avatar files and presets remain local until Save and Cancel preserves the old image', async ({ page }) => {
  await fixture(page)
  const writes: string[] = []
  await page.route('**/api/profile', route => { writes.push('profile'); return route.fulfill({ json: { profile } }) })
  await page.route('**/api/uploads/avatar', route => { writes.push(route.request().method()); return route.fulfill({ json: {} }) })
  await edit(page)
  await selectImage(page)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', profile.avatar_url)
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByRole('button', { name: 'Orbit', exact: true }).click()
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', '/avatars/orbit.svg')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', profile.avatar_url)
  expect(writes).toEqual([])
})

test('avatar save commits the staged image without browser deletion of committed objects', async ({ page }) => {
  await fixture(page)
  let uploadedPath = '', pending: Route | undefined
  const removed: string[] = []
  await page.route('**/api/uploads/cleanup', route => { removed.push(...route.request().postDataJSON().storagePaths); return route.fulfill({ json: { ok: true } }) })
  await page.route('**/api/uploads/avatar', route => {
    uploadedPath = `${aliceId}/${crypto.randomUUID()}.png`
    return route.fulfill({ json: { storagePath: uploadedPath } })
  })
  await page.route('**/api/profile', route => { pending = route })
  await edit(page)
  await selectImage(page)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => Boolean(pending)).toBe(true)
  expect(pending!.request().postDataJSON().customAvatarPath).toBe(uploadedPath)
  expect(removed).toEqual([])
  const newUrl = `https://example.supabase.co/storage/v1/object/public/profile-avatars/${uploadedPath}`
  await pending!.fulfill({ json: { profile: { ...profile, avatar_path: uploadedPath, avatar_url: newUrl } } })
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible()
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', newUrl)
  expect(removed).toEqual([])
})

test('failed avatar save keeps the original, retries the same staged upload, and cleans discarded uncommitted uploads', async ({ page }) => {
  await fixture(page)
  let uploadedPath = '', uploads = 0, saves = 0
  const submittedPaths: string[] = [], removed: string[] = []
  await page.route('**/api/uploads/cleanup', route => { removed.push(...route.request().postDataJSON().storagePaths); return route.fulfill({ json: { ok: true } }) })
  await page.route('**/api/uploads/avatar', route => {
    uploads++; uploadedPath = `${aliceId}/${crypto.randomUUID()}.png`
    return route.fulfill({ json: { storagePath: uploadedPath } })
  })
  await page.route('**/api/profile', route => {
    saves++; submittedPaths.push(route.request().postDataJSON().customAvatarPath)
    return route.fulfill({ status: 422, json: { error: 'Profile saving unavailable. Try again.' } })
  })
  await edit(page)
  await selectImage(page)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Profile saving unavailable')
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', profile.avatar_url)
  expect(removed).toEqual([])
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => saves).toBe(2)
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  expect(uploads).toBe(1)
  expect(submittedPaths).toEqual([uploadedPath, uploadedPath])
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => removed).toEqual([uploadedPath])
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', profile.avatar_url)
})

test('account changes clear staged avatars and profile drafts without writing them', async ({ page }) => {
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

test('Friends first load exposes pending then empty state and search requirements remain visible', async ({ page }) => {
  let pending: Route | undefined
  await page.route('**/api/social', route => { pending = route })
  await page.goto('/tests/social-harness/index.html')
  await expect(page.locator('.friends-panel').getByRole('status')).toHaveText('Loading friends…')
  await expect.poll(() => Boolean(pending)).toBe(true)
  await expect(page.getByText('No friends yet.', { exact: true })).toHaveCount(0)
  await pending!.fulfill({ json: { people: [], invitations: [], shareActivity: false } })
  await expect(page.getByText('No friends yet.', { exact: true })).toBeVisible()
  await expect(page.getByText('Loading friends…', { exact: true })).toHaveCount(0)
  await page.getByText('Find people', { exact: true }).click()
  await expect(page.getByText('Enter at least 2 characters.', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Find people' }).fill('a')
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled()
})

test('friend removal names its target and needs an explicit confirmation before committing', async ({ page }) => {
  const alice = { id: 'alice', name: 'Alice', avatarSeed: 'alice' }
  let removed = false
  const actions: string[] = []
  await page.route('**/api/social', route => route.fulfill({ json: { people: removed ? [] : [{ user: alice, state: 'friends' }], invitations: [], shareActivity: false } }))
  await page.route('**/api/friends/alice', route => { actions.push(route.request().postDataJSON().action); removed = true; return route.fulfill({ json: { ok: true } }) })
  await page.goto('/tests/social-harness/index.html')
  await page.getByRole('button', { name: 'Remove Alice from friends', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Remove Alice from friends?', exact: true })
  await expect(confirmation).toContainText('Adding them again requires a new friend request.')
  expect(actions).toEqual([])
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: "Open Alice's profile", exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove Alice from friends', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Remove Alice from friends', exact: true }).click()
  await expect(page.getByText('Friend removed.', { exact: true })).toBeVisible()
  expect(actions).toEqual(['remove'])
})

test('edits made during a staged-avatar upload survive its delayed save response', async ({ page }) => {
  await fixture(page)
  let upload: Route | undefined, submitted: Record<string, unknown> | undefined
  await page.route('**/api/uploads/avatar', route => { upload = route })
  await page.route('**/api/profile', route => {
    submitted = route.request().postDataJSON()
    return route.fulfill({ json: { profile: { ...profile, bio: submitted!.bio, avatar_path: submitted!.customAvatarPath,
      avatar_url: `https://example.supabase.co/storage/v1/object/public/profile-avatars/${submitted!.customAvatarPath}` } } })
  })
  await edit(page)
  await selectImage(page)
  await page.getByLabel('Bio', { exact: true }).fill('First submitted bio')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => Boolean(upload)).toBe(true)
  await page.getByLabel('Bio', { exact: true }).fill('Newer draft while uploading')
  await upload!.fulfill({ json: { storagePath: `${aliceId}/00000000-0000-4000-8000-000000000098.png` } })
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Newer draft while uploading')
  expect(submitted!.bio).toBe('First submitted bio')
})

test('uncertain avatar save failures never clean up a possibly committed image', async ({ page }) => {
  await fixture(page)
  let removed = 0
  await page.route('**/api/uploads/cleanup', route => { removed++; return route.fulfill({ json: { ok: true } }) })
  await page.route('**/api/uploads/avatar', route => {
    return route.fulfill({ json: { storagePath: `${aliceId}/00000000-0000-4000-8000-000000000098.png` } })
  })
  await page.route('**/api/profile', route => route.fulfill({ status: 503, json: { error: 'Profile saving unavailable. Try again.' } }))
  await edit(page)
  await selectImage(page)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Profile saving unavailable')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible()
  expect(removed).toBe(0)
  await expect(page.locator('.profile-hero .avatar img')).toHaveAttribute('src', profile.avatar_url)
})

test('stalled avatar uploads time out, abort transport, and retain the staged image and text for retry', async ({ page }) => {
  await fixture(page)
  let upload: Route | undefined, patches = 0, uploadFailed = false
  page.on('requestfailed', request => { if (request.url().includes('/api/uploads/avatar')) uploadFailed = true })
  await page.route('**/api/uploads/avatar', route => { upload = route })
  await page.route('**/api/profile', route => { patches++; return route.fulfill({ json: { profile } }) })
  await edit(page)
  await selectImage(page)
  await page.getByLabel('Bio', { exact: true }).fill('Retained bio after timeout')
  await page.clock.install()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => Boolean(upload)).toBe(true)
  await page.clock.runFor(30_001)
  await expect(page.getByRole('alert')).toContainText('The request timed out. Try again.')
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Retained bio after timeout')
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => uploadFailed).toBe(true)
  expect(patches).toBe(0)
  await upload!.fulfill({ json: { storagePath: `${aliceId}/00000000-0000-4000-8000-000000000097.png` } }).catch(() => {})
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Retained bio after timeout')
  expect(patches).toBe(0)
})

async function openRoomProfile(page: Page) {
  const button = page.locator('.header-profile-button')
  if (await button.isVisible()) await button.click()
  else {
    await page.getByRole('button', { name: 'More room actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Your profile', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Alice', exact: true })).toBeVisible()
}

test('browser Back and Forward restore profile text, favorite songs, and a staged avatar until explicit discard', async ({ page }) => {
  await page.goto('/tests/social-room-harness/index.html')
  await page.evaluate(() => {
    const original = window.fetch
    window.fetch = async (input, init) => String(input).includes('/api/library')
      ? Response.json({ library: { picks: [{ id: 'one', savedAt: 1, track: { provider: 'youtube', providerId: 'abcdefghijk', title: 'First song' } }], sets: [] } })
      : original(input, init)
  })
  await openRoomProfile(page)
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Bio', { exact: true }).fill('Profile draft from the listening room')
  await page.getByLabel('Status', { exact: true }).fill('Unsaved status')
  await page.getByRole('button', { name: 'Add First song to favorites', exact: true }).click()
  await selectImage(page)
  const firstPreview = await page.locator('.avatar-upload .avatar img').getAttribute('src')
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/room\/lounge$/)
  await page.goForward()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Profile draft from the listening room')
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Unsaved status')
  await expect(page.getByRole('list', { name: 'Selected favorite songs' })).toContainText('First song')
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', /^blob:/)
  expect(await page.locator('.avatar-upload .avatar img').getAttribute('src')).not.toBe(firstPreview)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Discard changes?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await openRoomProfile(page)
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('')
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', '/avatars/pulse.svg')
  await expect(page.getByRole('list', { name: 'Selected favorite songs' })).toHaveCount(0)
})

test('account-change events clear retained drafts while the profile is unmounted', async ({ page }) => {
  await page.goto('/tests/social-room-harness/index.html')
  await openRoomProfile(page)
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Bio', { exact: true }).fill('Private account draft')
  await selectImage(page)
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('soundspin:account-change', { detail: { userId: null } })))
  await page.goForward()
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('')
  await expect(page.locator('.avatar-upload .avatar img')).toHaveAttribute('src', '/avatars/pulse.svg')
})
