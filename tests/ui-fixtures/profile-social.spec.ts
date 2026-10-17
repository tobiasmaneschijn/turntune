import { expect, test, type Page, type Route } from '@playwright/test'

const aliceId = '00000000-0000-4000-8000-000000000001'
const bobId = '00000000-0000-4000-8000-000000000002'
const bob = { id: bobId, name: 'Bob', avatarSeed: bobId }
const tracks = [
  { provider: 'youtube', providerId: 'abcdefghijk', title: 'First song', artist: 'One' },
  { provider: 'spotify', providerId: 'abcdefghijklmnopqrstuv', title: 'Second song', artist: 'Two' },
  { provider: 'youtube', providerId: 'lmnopqrstuv', title: 'Third song', artist: 'Three' },
  { provider: 'youtube', providerId: 'wxyz1234567', title: 'Private fourth song', artist: 'Four' },
]
const profile = { user_id: aliceId, display_name: 'Alice', bio: 'Saved bio', handle: 'alice', status_text: 'Listening later',
  favorite_tracks: [tracks[0]], avatar_key: 'pulse', avatar_url: null, avatar_path: null, theme_key: 'afterglow',
  is_app_admin: false, created_at: '2026-01-15T12:00:00Z', updated_at: '2026-07-31T12:00:00Z' }
const library = { picks: tracks.map((track, index) => ({ id: `pick-${index}`, track, savedAt: index })), sets: [] }

async function fixture(page: Page) {
  await page.route('**/api/profiles/*', (route) => route.fulfill({ json: { profile: route.request().url().endsWith(bobId)
    ? { ...profile, user_id: bobId, display_name: 'Bob', handle: 'bob', bio: '', status_text: '' } : profile, options: [] } }))
  await page.route('**/api/social', (route) => route.fulfill({ json: { people: [], shareActivity: false } }))
  await page.route('**/api/library', (route) => route.fulfill({ json: { library } }))
}

test('profile editing curates three songs, keeps drafts on token rotation, and publishes only selected songs', async ({ page }) => {
  await fixture(page)
  let libraryLoads = 0, saveToken = '', savedBody: Record<string, unknown> | undefined
  await page.route('**/api/library', (route) => { libraryLoads++; return route.fulfill({ json: { library } }) })
  await page.route('**/api/profile', (route) => {
    savedBody = route.request().postDataJSON()
    saveToken = route.request().headers().authorization
    return route.fulfill({ json: { profile: { ...profile, display_name: savedBody!.displayName, bio: savedBody!.bio,
      handle: savedBody!.handle, status_text: savedBody!.statusText, favorite_tracks: savedBody!.favoriteTracks } } })
  })
  await page.goto('/tests/frontend-session-harness/index.html?embedded')
  await expect(page.getByRole('heading', { name: 'Alice', exact: true })).toBeVisible()
  await expect(page.getByText('@alice', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Display name', { exact: true })).toHaveCount(0)
  expect(libraryLoads).toBe(0)
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Handle', { exact: true }).fill('alice_music')
  await page.getByLabel('Status', { exact: true }).fill('Friday at eight')
  await page.getByRole('button', { name: 'Add Second song to favorites', exact: true }).click()
  await page.getByRole('button', { name: 'Add Third song to favorites', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add Private fourth song to favorites', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Move Third song up', exact: true }).click()
  await page.getByRole('button', { name: 'Remove First song from favorites', exact: true }).click()
  await page.getByRole('button', { name: 'Rotate token', exact: true }).click()
  await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('alice_music')
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Friday at eight')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeVisible()
  await expect(page.getByText('@alice_music', { exact: true })).toBeVisible()
  expect(saveToken).toBe('Bearer token-two')
  expect(savedBody?.favoriteTracks).toEqual([tracks[2], tracks[1]])
  expect(JSON.stringify(savedBody)).not.toContain('Private fourth song')
  expect(libraryLoads).toBe(1)
  await expect(page.locator('.profile-page-header')).toHaveCount(0)
  await expect(page.getByRole('main')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('visitor can accept, invite, remove, request, cancel, and save a favorite song', async ({ page }) => {
  await fixture(page)
  let relationship: 'incoming' | 'friends' | 'outgoing' | null = 'incoming'
  const actions: string[] = []
  let savedTrack: unknown, libraryGets = 0
  await page.route('**/api/social', (route) => route.fulfill({ json: { people: relationship ? [{ user: bob, state: relationship }] : [], shareActivity: false } }))
  await page.route(`**/api/friends/${bobId}`, (route) => {
    const action = route.request().postDataJSON().action as string
    actions.push(action)
    relationship = action === 'accept' ? 'friends' : action === 'request' ? 'outgoing' : null
    return route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/library', (route) => {
    if (route.request().method() === 'GET') libraryGets++
    else savedTrack = route.request().postDataJSON()
    return route.fulfill({ json: { library } })
  })
  await page.goto('/tests/frontend-session-harness/index.html?profile=other&embedded')
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'First song', exact: true })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk')
  await page.getByRole('button', { name: "Accept Bob's friend request", exact: true }).click()
  await page.getByRole('button', { name: 'Invite Bob to this room', exact: true }).click()
  await expect(page.getByRole('status')).toContainText([`Invited ${bobId}`])
  await page.getByRole('button', { name: 'Remove friend Bob', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove friend Bob', exact: true }).click()
  await page.getByRole('button', { name: 'Add friend Bob', exact: true }).click()
  await expect(page.getByText('Requested', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel request to Bob', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add friend Bob', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save First song to my picks', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved First song', exact: true })).toBeDisabled()
  expect(savedTrack).toEqual({ type: 'save-pick', track: tracks[0] })
  expect(libraryGets).toBe(0)
  expect(actions).toEqual(['accept', 'remove', 'request', 'decline'])
  await expect(page.getByText('No bio yet.', { exact: true })).toHaveCount(0)
})

test('failed activity setting keeps the saved value and can be retried', async ({ page }) => {
  await fixture(page)
  const changes: boolean[] = []
  await page.route('**/api/social/settings', (route) => {
    changes.push(route.request().postDataJSON().shareActivity)
    return changes.length === 1 ? route.fulfill({ status: 500, json: { error: 'Setting unavailable' } }) : route.fulfill({ json: { shareActivity: true } })
  })
  await page.goto('/tests/frontend-session-harness/index.html?embedded')
  const activity = page.getByRole('switch', { name: 'Share activity with friends', exact: true })
  await expect(activity).not.toBeChecked()
  await activity.click()
  await expect(page.getByRole('alert')).toContainText('Setting unavailable')
  await expect(activity).not.toBeChecked()
  await activity.click()
  await expect(activity).toBeChecked()
  expect(changes).toEqual([true, true])
})

test('typing during a profile save keeps the newer draft open', async ({ page }) => {
  await fixture(page)
  let pending: Route | undefined
  await page.route('**/api/profile', (route) => { pending = route })
  await page.goto('/tests/frontend-session-harness/index.html?embedded')
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Handle', { exact: true }).fill('alice_first')
  await page.getByLabel('Status', { exact: true }).fill('First status')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => Boolean(pending)).toBe(true)
  await page.getByLabel('Handle', { exact: true }).fill('alice_next')
  await page.getByLabel('Status', { exact: true }).fill('Next status')
  await pending!.fulfill({ json: { profile: { ...profile, handle: 'alice_first', status_text: 'First status' } } })
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('alice_next')
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Next status')
  await expect(page.getByText('@alice_first', { exact: true })).toBeVisible()
})

test('switching accounts discards a pending profile save and resets the editor', async ({ page }) => {
  await fixture(page)
  let pending: Route | undefined
  await page.route('**/api/profile', (route) => { pending = route })
  await page.goto('/tests/frontend-session-harness/index.html?embedded')
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await page.getByLabel('Display name', { exact: true }).fill('Old account draft')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => Boolean(pending)).toBe(true)
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bob', exact: true })).toBeVisible()
  await pending!.fulfill({ json: { profile: { ...profile, display_name: 'Old account draft' } } }).catch(() => {})
  await expect(page.getByTestId('profile-updated')).toHaveText('')
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Bob')
})

test('profile blocking revokes friendship controls and request preferences are usable',async({page})=>{
  await fixture(page)
  let blocked=false,receiveRequests=true
  await page.route('**/api/social',route=>route.fulfill({json:{people:blocked?[]:[{user:bob,state:'friends'}],shareActivity:false,blockedPeople:blocked?[bob]:[],receiveRequests}}))
  await page.route(`**/api/social/blocks/${bobId}`,route=>{blocked=route.request().postDataJSON().blocked;return route.fulfill({json:{blocked}})})
  await page.route('**/api/social/settings',route=>{receiveRequests=route.request().postDataJSON().receiveRequests;return route.fulfill({json:{receiveRequests}})})
  await page.goto('/tests/frontend-session-harness/index.html?profile=other&embedded')
  await page.getByRole('button',{name:'Block Bob',exact:true}).click()
  await expect(page.getByRole('button',{name:'Invite Bob to this room',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Add friend Bob',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Unblock Bob',exact:true}).click()
  await expect(page.getByRole('button',{name:'Block Bob',exact:true})).toBeVisible()
  await page.goto('/tests/frontend-session-harness/index.html?embedded')
  const requests=page.getByRole('switch',{name:'Receive friend requests',exact:true})
  await expect(requests).toBeChecked();await requests.click();await expect(requests).not.toBeChecked()
  expect(receiveRequests).toBe(false)
})
