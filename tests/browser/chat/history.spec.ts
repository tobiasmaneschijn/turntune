import { expect, test } from '@playwright/test'

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const incoming = (index: number) => ({ id: id(index), content: 'Hello @Alice', type: 'text',
  user: { id: 'mira', name: 'Mira', avatarSeed: 'mira' }, createdAt: new Date().toISOString(),
  mentions: [{ userId: 'alice', userName: 'Alice', handle: 'Alice' }] })

declare global { interface Window {
  chatHistoryTest: { receive(message: unknown): void }
  notificationTest: { permission: string; requests: number; events: Array<{ title: string; tag: string }>; setAttention(visible: boolean, focused: boolean): void }
} }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = { permission: 'granted', requests: 0, events: [] as Array<{ title: string; tag: string }>, visible: true, focused: true,
      setAttention(visible: boolean, focused: boolean) {
        state.visible = visible; state.focused = focused
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event(focused ? 'focus' : 'blur'))
      } }
    class TestNotification {
      static get permission() { return state.permission }
      static requestPermission() { state.requests++; state.permission = 'denied'; return Promise.resolve('denied') }
      constructor(title: string, options: { tag: string }) { state.events.push({ title, tag: options.tag }) }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.visible ? 'visible' : 'hidden' })
    document.hasFocus = () => state.focused
    Object.assign(window, { notificationTest: state })
  })
  const rows = Array.from({ length: 420 }, (_, index) => ({ id: id(index + 1), room_slug: 'lounge',
    created_at: '2026-10-06T10:00:00.000001+00:00', reply_to_id: null,
    content: index >= 4 && index < 50 ? `needle message ${index + 1}` : `Room message ${index + 1}`,
    user_id: 'mira', user_name: 'Mira', avatar_seed: 'mira', message_type: 'text', mentions: [], soundspin_message_reactions: [] }))
  rows.push({ ...rows[0], id: id(800), room_slug: 'other-room', content: 'Other room message' },
    { ...rows[0], id: id(900), room_slug: 'secret-room', content: 'needle private message' })
  const payload = (selected: typeof rows) => ({ rows: selected, replies: [], profiles: [] })
  await page.route('**/api/rooms/*/chat/**', async route => {
    const url = new URL(route.request().url())
    const parts = url.pathname.split('/')
    if (!route.request().headers().authorization) return route.fulfill({ status: 401, json: { error: 'Sign in required' } })
    const scope = rows.filter(row => row.room_slug === parts[3])
    const action = parts[5]
    if (action === 'messages' || action === 'context') {
      const target = scope.find(row => row.id === parts[6])
      if (!target) return route.fulfill({ json: null })
      if (action === 'messages') return route.fulfill({ json: payload([target]) })
      const index = scope.indexOf(target)
      const selected = scope.slice(Math.max(0, index - 20), index + 21)
      return route.fulfill({ json: { ...payload(selected),
        olderCursor: { createdAt: selected[0].created_at, id: selected[0].id },
        newerCursor: { createdAt: selected.at(-1)!.created_at, id: selected.at(-1)!.id },
        hasOlder: index > 20, hasNewer: index + 21 < scope.length } })
    }
    const query = url.searchParams.get('q')
    const cursor = url.searchParams.get('beforeId')
    const older = url.searchParams.get('direction') !== 'newer'
    const matches = scope.filter(row => (!query || row.content.toLowerCase().includes(query.toLowerCase())) &&
      (!cursor || (older ? row.id < cursor : row.id > cursor)))
    const ordered = older ? matches.reverse() : matches
    const selected = ordered.slice(0, action === 'search' ? 40 : Number(url.searchParams.get('pageSize') || 200))
    const next = selected.at(-1)
    return route.fulfill({ json: { ...payload(older ? selected.reverse() : selected),
      cursor: next ? { createdAt: next.created_at, id: next.id } : undefined, hasMore: ordered.length > selected.length } })
  })
  await page.route('**/api/config', route => route.fulfill({ json: { giphyConfigured: true } }))
  await page.route('**/api/giphy*', route => route.fulfill({ json: { results: [{ id: 'dance', title: 'Room dance',
    url: 'https://media.giphy.com/media/soundspin-fixture/dance.gif', preview: 'https://media.giphy.com/media/soundspin-fixture/dance.gif' }] } }))
  const image = { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="32" fill="#ffcc4d"/></svg>' }
  await page.route('https://media.giphy.com/media/soundspin-fixture/**', route => route.fulfill(image))
  await page.route(/^https:\/\/cdn\.jsdelivr\.net\/gh\/jdecked\/twemoji@17\.0\.3\/assets\/svg\/[0-9a-f-]+\.svg$/, route => route.fulfill(image))
  await page.goto('/tests/browser/chat/harnesses/history/index.html')
  await expect(page.getByText('Room message 420', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toBeEnabled()
})

test('Browse older messages, find a saved conversation and return to live chat', async ({ page }) => {
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
  await expect(page.getByText('Room message 220', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Search room messages', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search all saved room messages' }).fill('needle')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'More search results', exact: true })).toBeVisible()
  await expect(page.getByText('needle private message')).toHaveCount(0)
  await page.getByRole('button', { name: 'More search results', exact: true }).click()
  await page.getByRole('button', { name: 'View message from Mira: needle message 5', exact: true }).click()
  await expect(page.getByText('Earlier messages', { exact: true })).toBeVisible()
  await expect(page.locator(`#chat-message-${id(5)}`)).toContainText('needle message 5')
  await page.evaluate(message => window.chatHistoryTest.receive(message), incoming(999))
  await page.getByRole('button', { name: 'Back to live messages', exact: true }).click()
  await expect(page.locator(`#chat-message-${id(999)}`).getByText('Hello @Alice', { exact: true })).toBeVisible()
  await expect(page.getByText('Earlier messages', { exact: true })).toHaveCount(0)
})

test.describe('Touch chat media', () => {
test.use({ hasTouch: true, isMobile: true })

test('Share a GIF and react to a message while keeping a text draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 })
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('My next message')
  await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
  await page.getByRole('tab', { name: 'GIFs', exact: true }).click()
  await page.getByPlaceholder('Search GIFs').fill('dance')
  await composer.tap()
  await expect(page.getByRole('tabpanel', { name: 'GIFs', exact: true })).toHaveCount(0)
  await expect(composer).toHaveValue('My next message')
  await page.getByRole('button', { name: 'Add GIF', exact: true }).tap()
  await expect(page.getByPlaceholder('Search GIFs')).toHaveValue('dance')
  await page.locator('.chat-gif-tile').first().click()
  await expect(page.locator('.chat-message-item').last().locator('.chat-media-link')).toBeVisible()
  await expect(composer).toHaveValue('My next message')
  const message = page.locator(`#chat-message-${id(420)}`)
  const actions = message.getByRole('button', { name: 'Message actions for Mira', exact: true })
  await message.getByText('Room message 420', { exact: true }).tap()
  await expect.poll(() => actions.evaluate(element => element.checkVisibility({ checkOpacity: true }))).toBe(true)
  await actions.tap()
  await page.getByRole('menuitem', { name: 'React', exact: true }).click()
  const picker = page.getByRole('dialog', { name: "React to Mira's message" })
  await picker.getByPlaceholder('Find an emoji').fill('heart')
  await picker.locator('button.epr-emoji').first().click()
  await expect(picker).toHaveCount(0)
  await expect(message.locator('.chat-message-reactions > button')).toHaveCount(1)
  await expect(actions).toBeFocused()
  await expect(composer).toHaveValue('My next message')
})
})

test('Reopen an uploaded image after its link expires and retry a failed refresh', async ({ page }) => {
  await page.evaluate(async () => {
    const policy = await import('/src/lib/remote-images.ts')
    policy.setTrustedImageStorageOrigin('https://example.supabase.co')
  })
  let available = false
  const authorizations: Array<string | undefined> = []
  await page.route('**/api/rooms/lounge/chat/media-url', route => {
    authorizations.push(route.request().headers().authorization)
    if (!available) return route.fulfill({ status: 503, json: { error: 'Image temporarily unavailable.' } })
    const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')}.signature`
    return route.fulfill({ json: { url: `https://example.supabase.co/storage/v1/object/sign/chat-media/fixture/image.png?token=${token}&refreshed=1`, expiresAt: Date.now() + 300_000 } })
  })
  await page.route('https://example.supabase.co/storage/v1/object/sign/chat-media/fixture/**', route =>
    route.request().url().includes('refreshed=1')
      ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#889955"/></svg>' })
      : route.fulfill({ status: 403, body: 'Expired image link' }))
  await page.evaluate(message => window.chatHistoryTest.receive(message), { ...incoming(997),
    content: 'Private room image', type: 'image', mentions: [], storagePath: 'mira/lounge/image.png',
    mediaUrl: 'https://example.supabase.co/storage/v1/object/sign/chat-media/fixture/image.png?expired=true' })
  const row = page.locator(`#chat-message-${id(997)}`)
  const retry = row.getByRole('button', { name: 'Retry image', exact: true })
  await expect(retry).toBeVisible()
  available = true
  await retry.click()
  await expect.poll(() => row.locator('.chat-media-link img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(retry).toHaveCount(0)
  expect(authorizations).toEqual(['Bearer alice-token', 'Bearer alice-token'])
  await expect(row).toHaveCount(1)
})

test('Mute mention notifications for this room', async ({ page }) => {
  await page.evaluate(() => window.notificationTest.setAttention(false, false))
  await page.evaluate(message => window.chatHistoryTest.receive(message), incoming(999))
  await expect.poll(() => page.evaluate(() => window.notificationTest.events.length)).toBe(1)
  await page.getByRole('button', { name: 'Mute room', exact: true }).click()
  await page.evaluate(message => window.chatHistoryTest.receive(message), incoming(1000))
  expect(await page.evaluate(() => window.notificationTest.events.length)).toBe(1)
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mute room', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Room muted', exact: true })).toBeVisible()
})

test('Choose notification preferences and recover from browser permission denial', async ({ page }) => {
  await page.evaluate(() => { window.notificationTest.permission = 'default' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Notifications', exact: true }).click()
  await page.getByRole('switch', { name: 'Chat mentions', exact: true }).click()
  await page.getByRole('switch', { name: 'Chat mentions', exact: true }).click()
  expect(await page.evaluate(() => window.notificationTest.requests)).toBe(0)
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click()
  await expect(page.getByText(/System notifications are blocked/)).toBeVisible()
  expect(await page.evaluate(() => window.notificationTest.requests)).toBe(1)
  await page.getByRole('switch', { name: 'Background notifications only', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.notificationTest.setAttention(false, false))
  await page.evaluate(message => window.chatHistoryTest.receive(message), incoming(999))
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
  expect(await page.evaluate(() => window.notificationTest.events)).toEqual([])
})
