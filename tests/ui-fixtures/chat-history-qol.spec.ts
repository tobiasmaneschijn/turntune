import { expect, test, type Page } from '@playwright/test'

type Row = { id: string; room_slug: string; created_at: string; reply_to_id: string | null; content: string; user_id: string; user_name: string; avatar_seed: string; message_type: string; mentions: unknown[]; soundspin_message_reactions: unknown[] }
type Database = { rows: Row[]; allowed: boolean; holdOlder: boolean; releaseOlder: (() => void) | null; holdSearch: boolean; releaseSearch: (() => void) | null; searches: string[]; mediaRequests: string[] }
const databases = new WeakMap<Page, Database>()
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
declare global { interface Window {
  chatHistoryTest: { sendIds: string[]; saveIds: string[]; failSend: boolean; failSave: boolean; failReaction: boolean; unread: number; receive(message: unknown): void; react(reaction: unknown): void; typing(userId: string, active: boolean): void; renamePeer(userId: string, name: string): void; reconnect(): void; rotateToken(): void }
  notificationTest: { permission: string; requests: number; events: Array<{ title: string; tag: string }>; visible: boolean; focused: boolean; setAttention(visible: boolean, focused: boolean): void; activateLatest(): void }
} }
const incoming = (index: number, mention = true) => ({ id: id(index), content: mention ? 'Hello @Alice' : 'Another live message', type: 'text', user: { id: 'mira', name: 'Mira', avatarSeed: 'mira' },
  createdAt: new Date().toISOString(), mentions: mention ? [{ userId: 'alice', userName: 'Alice', handle: 'Alice' }] : [] })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = { permission: 'granted', requests: 0, events: [] as Array<{ title: string; tag: string }>, visible: true, focused: true, activateLatest: () => {},
      setAttention(visible: boolean, focused: boolean) { state.visible = visible; state.focused = focused; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event(focused ? 'focus' : 'blur')) } }
    class TestNotification {
      static get permission() { return state.permission }
      static requestPermission() { state.requests++; state.permission = 'denied'; return Promise.resolve('denied') }
      onclick: (() => void) | null = null
      constructor(title: string, options: { tag: string }) { state.events.push({ title, tag: options.tag }); state.activateLatest = () => this.onclick?.() }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.visible ? 'visible' : 'hidden' })
    document.hasFocus = () => state.focused
    Object.assign(window, { notificationTest: state })
  })
  const rows: Row[] = Array.from({ length: 420 }, (_, index) => ({ id: id(index + 1), room_slug: 'lounge', created_at: '2026-10-06T10:00:00.000001+00:00', reply_to_id: index === 419 ? id(5) : null,
    content: index >= 4 && index < 50 ? `needle message ${index + 1}` : `Room message ${index + 1}`, user_id: 'mira', user_name: 'Mira', avatar_seed: 'mira', message_type: 'text',
    mentions: [{ userId: 'alice', userName: 'Alice', handle: 'Alice' }], soundspin_message_reactions: [] }))
  rows.push({ ...rows[0], id: id(800), room_slug: 'other-room', content: 'Other room message' }, { ...rows[0], id: id(900), room_slug: 'secret-room', content: 'needle private message' })
  const database: Database = { rows, allowed: true, holdOlder: false, releaseOlder: null, holdSearch: false, releaseSearch: null, searches: [], mediaRequests: [] }
  databases.set(page, database)
  const enrich = (selected: Row[]) => ({ rows: selected, replies: rows.filter((row) => selected.some((message) => message.reply_to_id === row.id) && row.room_slug === selected[0]?.room_slug), profiles: [] })
  await page.route('**/api/rooms/*/chat/**', async (route) => {
    const url = new URL(route.request().url())
    const parts = url.pathname.split('/')
    const room = parts[3]
    if (!route.request().headers().authorization) return route.fulfill({ status: 401, json: { error: 'Sign in required' } })
    if (!database.allowed || room === 'secret-room') return route.fulfill({ status: 403, json: { error: 'Join this room before reading its chat history.' } })
    const scope = rows.filter((row) => row.room_slug === room)
    const action = parts[5]
    if (action === 'media-url') {
      const body = route.request().postDataJSON() as { storagePath: string }
      database.mediaRequests.push(body.storagePath)
      const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')}.signature`
      return route.fulfill({ json: { url: `https://private.example.test/image.png?token=${token}&revision=${database.mediaRequests.length}`, expiresAt: Date.now() + 300_000 } })
    }
    if (action === 'messages' || action === 'context') {
      const target = scope.find((row) => row.id === parts[6])
      if (!target) return route.fulfill({ json: null })
      if (action === 'messages') return route.fulfill({ json: enrich([target]) })
      const index = scope.indexOf(target)
      const selected = scope.slice(Math.max(0, index - 20), index + 21)
      return route.fulfill({ json: { ...enrich(selected), olderCursor: { createdAt: selected[0].created_at, id: selected[0].id }, newerCursor: { createdAt: selected.at(-1)!.created_at, id: selected.at(-1)!.id }, hasOlder: index > 20, hasNewer: index + 21 < scope.length } })
    }
    const query = url.searchParams.get('q')
    if (action === 'search') database.searches.push(query || '')
    if (database.holdOlder && action === 'history' && url.searchParams.has('beforeId')) await new Promise<void>((resolve) => { database.releaseOlder = resolve })
    if (database.holdSearch && action === 'search') await new Promise<void>((resolve) => { database.releaseSearch = resolve })
    const direction = url.searchParams.get('direction') || 'older'
    const cursor = url.searchParams.get('beforeId')
    const matches = scope.filter((row) => (!query || row.content.toLowerCase().includes(query.toLowerCase())) && (!cursor || (direction === 'older' ? row.id < cursor : row.id > cursor)))
    const ordered = direction === 'older' ? matches.reverse() : matches
    const limit = action === 'search' ? 40 : Number(url.searchParams.get('pageSize') || 200)
    const selected = ordered.slice(0, limit)
    const next = selected.at(-1)
    return route.fulfill({ json: { ...enrich(direction === 'older' ? selected.reverse() : selected), cursor: next ? { createdAt: next.created_at, id: next.id } : undefined, hasMore: ordered.length > limit } })
  })
  await page.route('**/api/config', (route) => route.fulfill({ json: { giphyConfigured: true } }))
  await page.route('**/api/giphy*', (route) => route.fulfill({ json: { results: Array.from({ length: 8 }, (_, index) => ({ id: `gif-${index}`, title: `Room GIF ${index}`, url: `https://media.example.test/${index}.gif`, preview: `https://media.example.test/${index}.gif` })) } }))
  await page.route('https://media.example.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#556655"/></svg>' }))
  await page.goto('/tests/chat-history-harness/index.html')
  await expect(page.locator('.chat-message-item')).toHaveCount(200)
})

test('older pages preserve the reader anchor and first unread marker while a new message arrives during loading', async ({ page }) => {
  const database = databases.get(page)!
  await page.evaluate(() => window.notificationTest.setAttention(false, false))
  await page.evaluate((message) => window.chatHistoryTest.receive(message), incoming(999))
  await expect.poll(() => page.evaluate(() => window.chatHistoryTest.unread)).toBe(1)
  await page.locator('.chat-message-scroll').evaluate((element) => { element.scrollTop = 0 })
  const anchor = page.locator(`#chat-message-${id(221)}`)
  const before = (await anchor.boundingBox())!.y
  database.holdOlder = true
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Loading older messages…' })).toBeDisabled()
  await expect.poll(() => Boolean(database.releaseOlder)).toBe(true)
  await page.evaluate((message) => window.chatHistoryTest.receive(message), incoming(1000, false))
  database.holdOlder = false; database.releaseOlder!()
  await expect(page.locator('.chat-message-item')).toHaveCount(402)
  await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0)
  await expect.poll(() => page.evaluate(() => window.chatHistoryTest.unread)).toBe(2)
  await expect(page.locator('.chat-unread-divider')).toHaveCount(1)
  await expect(page.locator('.chat-unread-divider').locator('..').locator('.chat-message-item')).toHaveAttribute('id', `chat-message-${id(999)}`)
  expect(await page.evaluate(() => window.notificationTest.events.length)).toBe(1)
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
  await expect(page.locator('.chat-message-item')).toHaveCount(422)
  await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toHaveCount(0)
  const ids = await page.locator('.chat-message-item').evaluateAll((elements) => elements.map((element) => element.id))
  expect(new Set(ids).size).toBe(422)
})

test('full saved-room search pages through older results and opens chronological context without mixing another room', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Search room messages', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search all saved room messages' }).fill('needle')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('.chat-history-results > button')).toHaveCount(40)
  await expect(page.getByText('needle private message')).toHaveCount(0)
  await page.getByRole('button', { name: 'More search results', exact: true }).click()
  await expect(page.locator('.chat-history-results > button')).toHaveCount(46)
  await page.getByRole('button', { name: 'View message from Mira: needle message 5', exact: true }).click()
  await expect(page.getByText('Earlier messages', { exact: true })).toBeVisible()
  await expect(page.locator('.chat-message-jump-target')).toHaveAttribute('id', `chat-message-${id(5)}`)
  await expect(page.locator('.chat-message-item')).toHaveCount(25)
  await page.getByRole('button', { name: 'Load newer messages', exact: true }).click()
  await expect(page.locator('.chat-message-item')).toHaveCount(65)
  await page.getByRole('button', { name: 'Back to live messages', exact: true }).click()
  await expect(page.locator('.chat-message-item')).toHaveCount(200)
  await expect.poll(() => page.evaluate(() => window.chatHistoryTest.unread)).toBe(0)
  expect(await page.evaluate(() => window.notificationTest.events)).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('chat-search.png') })
})

test('reply targets fetch context and explain a deleted target without silently failing', async ({ page }) => {
  await page.locator(`#chat-message-${id(420)} .chat-message-reply`).click()
  await expect(page.locator('.chat-message-jump-target')).toHaveAttribute('id', `chat-message-${id(5)}`)
  await page.getByRole('button', { name: 'Back to live messages', exact: true }).click()
  databases.get(page)!.rows.splice(databases.get(page)!.rows.findIndex((row) => row.id === id(5)), 1)
  await page.locator(`#chat-message-${id(420)} .chat-message-reply`).click()
  await expect(page.getByRole('alert')).toHaveText(/That message is unavailable/)
})

test('retry send reuses its UUID and one durable save while preserving a separately typed draft', async ({ page }) => {
  await page.evaluate(() => { window.chatHistoryTest.failSend = true })
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('original outgoing message')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Could not confirm send', { exact: true })).toBeVisible()
  await composer.fill('new draft during recovery')
  await page.evaluate(() => { window.chatHistoryTest.failSend = false })
  await page.getByRole('button', { name: 'Retry send', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('new draft during recovery')
  const ids = await page.evaluate(() => ({ sends: window.chatHistoryTest.sendIds, saves: window.chatHistoryTest.saveIds }))
  expect(ids.sends).toEqual([ids.saves[0], ids.saves[0]])
  expect(ids.saves).toHaveLength(1)
})

test('successful retry clears its unchanged draft and pressing Enter cannot duplicate the message', async ({ page }) => {
  await page.evaluate(() => { window.chatHistoryTest.failSend = true })
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('original outgoing message')
  await composer.press('Enter')
  await expect(page.getByText('Could not confirm send', { exact: true })).toBeVisible()
  await page.evaluate(() => { window.chatHistoryTest.failSend = false })
  await page.getByRole('button', { name: 'Retry send', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('')
  await composer.press('Enter')
  expect(await page.evaluate(() => window.chatHistoryTest.saveIds)).toHaveLength(1)
})

test('live-window rollover preserves the reader anchor and unread state, and returning live completes a pending saved search', async ({ page }) => {
  await page.evaluate((messages) => messages.forEach((message) => window.chatHistoryTest.receive(message)), Array.from({ length: 800 }, (_, index) => incoming(1000 + index, false)))
  await expect(page.locator('.chat-message-item')).toHaveCount(1000)
  await page.locator('.chat-message-scroll').evaluate((element) => { element.scrollTop = 0 })
  const anchor = page.locator(`#chat-message-${id(221)}`)
  await expect(anchor).toBeVisible()
  const before = (await anchor.boundingBox())!.y
  await page.evaluate((messages) => messages.forEach((message) => window.chatHistoryTest.receive(message)), Array.from({ length: 200 }, (_, index) => incoming(1800 + index, false)))
  await expect(page.locator('.chat-message-item')).toHaveCount(1000)
  await expect(anchor).toBeVisible()
  await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0)
  await expect.poll(() => page.evaluate(() => window.chatHistoryTest.unread)).toBe(200)
  const database = databases.get(page)!
  database.holdSearch = true
  await page.getByRole('button', { name: 'Search room messages', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search all saved room messages' }).fill('needle')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect.poll(() => Boolean(database.releaseSearch)).toBe(true)
  await page.getByRole('button', { name: '200 new', exact: true }).click()
  await expect(page.locator(`#chat-message-${id(1999)}`)).toBeVisible()
  await expect(page.locator('.chat-message-item')).toHaveCount(1000)
  await expect.poll(() => page.evaluate(() => window.chatHistoryTest.unread)).toBe(0)
  await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toHaveCount(1)
  database.holdSearch = false; database.releaseSearch!()
  await expect(page.locator('.chat-history-results > button')).toHaveCount(40)
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
  await expect(page.getByText('Searching saved room messages…')).toHaveCount(0)
})

test('background mentions use one system notification, duplicates/reconnect/history do not replay, and room mute is scoped', async ({ page }) => {
  await page.evaluate(() => window.notificationTest.setAttention(false, false))
  const message = incoming(999)
  await page.evaluate((item) => { window.chatHistoryTest.receive(item); window.chatHistoryTest.receive(item) }, message)
  await expect.poll(() => page.evaluate(() => window.notificationTest.events.length)).toBe(1)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await expect(page).toHaveTitle(/^\(1\) /)
  await page.evaluate(() => window.chatHistoryTest.reconnect())
  await page.evaluate((item) => window.chatHistoryTest.receive(item), message)
  expect(await page.evaluate(() => window.notificationTest.events.length)).toBe(1)
  await page.getByRole('button', { name: 'Mute room', exact: true }).click()
  await page.evaluate((item) => window.chatHistoryTest.receive(item), incoming(1000))
  expect(await page.evaluate(() => window.notificationTest.events.length)).toBe(1)
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mute room', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Room muted', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mute room', exact: true })).toBeVisible()
})

test('permission is requested only from Enable, denial is explained and preference toggles never reprompt', async ({ page }) => {
  await page.evaluate(() => { window.notificationTest.permission = 'default' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Notifications', exact: true }).click()
  await page.getByRole('switch', { name: 'Chat mentions', exact: true }).click()
  await page.getByRole('switch', { name: 'Chat mentions', exact: true }).click()
  expect(await page.evaluate(() => window.notificationTest.requests)).toBe(0)
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click()
  await expect(page.getByText(/System notifications are blocked/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable notifications', exact: true })).toHaveCount(0)
  await page.getByRole('switch', { name: 'Chat mentions', exact: true }).click()
  await page.getByRole('switch', { name: 'Chat mentions', exact: true }).click()
  expect(await page.evaluate(() => window.notificationTest.requests)).toBe(1)
  await page.getByRole('switch', { name: 'Background notifications only', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Background notifications only', exact: true })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.notificationTest.setAttention(false, false))
  await page.evaluate((message) => window.chatHistoryTest.receive(message), incoming(999))
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
  expect(await page.evaluate(() => window.notificationTest.events.length)).toBe(0)
})

test('unsupported permission is clear, focused chat stays quiet, and inline send recovery remains available', async ({ page }) => {
  await page.evaluate(() => { Reflect.deleteProperty(window, 'Notification') })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Notifications', exact: true }).click()
  await expect(page.getByText(/This browser does not support system notifications/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate((message) => window.chatHistoryTest.receive(message), incoming(999))
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page.evaluate(() => { window.chatHistoryTest.failSend = true })
  await page.getByRole('textbox', { name: 'Message room chat' }).fill('still recover this')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toBeVisible()
})

test('authorization revocation is visible on older-page and search attempts', async ({ page }) => {
  databases.get(page)!.allowed = false
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(/Older messages could not be loaded/)
  await page.getByRole('button', { name: 'Search room messages', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search all saved room messages' }).fill('needle')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByText('Join this room before reading its chat history.')).toBeVisible()
})

test('heavy reaction updates preserve the row and use static selection without repeated live announcements', async ({ page }) => {
  const message = page.locator(`#chat-message-${id(420)}`)
  await message.evaluate((element) => element.setAttribute('data-lifetime', 'same'))
  await page.evaluate((messageId) => {
    for (let index = 0; index < 100; index++) window.chatHistoryTest.react({ id: `event-${index}`, messageId, action: 'add', userId: `peer-${index}`, userName: `Peer ${index}`, emoji: '❤️' })
  }, id(420))
  await expect(message).toHaveAttribute('data-lifetime', 'same')
  const reaction = message.locator('.chat-message-reactions > button').first()
  await expect(reaction.locator('strong')).toHaveText('100')
  await expect(reaction).toHaveCSS('animation-name', 'none')
  await expect(reaction.locator('[aria-live]')).toHaveCount(0)
  await reaction.click()
  await expect(reaction).toBeFocused()
  await expect(reaction).toHaveClass(/active/)
  await expect(reaction.locator('strong')).toHaveText('101')
  await expect(reaction).toHaveCSS('animation-name', 'none')
})

test('peer typing keeps the GIF search and chat layout stable in a short laptop pane, including replies', { tag: '@fixed-viewport' }, async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.locator('.supabase-chat-body').evaluate((element) => {
    element.style.maxHeight = '380px'
    element.style.width = '420px'
  })
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  const picker = page.locator('.chat-picker-popover')
  await composer.fill('Keep this draft')
  for (const replying of [false, true]) {
    if (replying) {
      await page.locator('.chat-message-item').last().getByRole('button', { name: 'Message actions for Mira' }).click()
      await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Add GIF', exact: true }).click()
    const search = picker.getByPlaceholder('Search GIFs')
    await search.fill('dance')
    await expect(picker.locator('.chat-gif-tile')).toHaveCount(8)
    const layout = async () => Promise.all([page.locator('.chat-message-scroll').boundingBox(), page.locator('.chat-composer').boundingBox(), picker.boundingBox(), search.boundingBox()])
    const before = await layout()
    for (const active of [true, false, true, false]) {
      await page.evaluate((value) => { window.chatHistoryTest.typing('mira', value); window.chatHistoryTest.typing('bob', value) }, active)
      await expect(page.locator('.chat-typing-indicator')).toHaveText(active ? 'Bob and Mira are typing…' : '')
      await expect.poll(layout).toEqual(before)
      await expect(search).toBeFocused()
      await expect(search).toHaveValue('dance')
      const surfaceBox = (await page.locator('[data-chat-surface]').boundingBox())!
      const pickerBox = (await picker.boundingBox())!
      const searchBox = (await search.boundingBox())!
      expect(pickerBox.y).toBeGreaterThanOrEqual(surfaceBox.y)
      expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual((await page.locator('.chat-typing-indicator').boundingBox())!.y)
      expect(searchBox.y).toBeGreaterThanOrEqual(pickerBox.y)
      expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(pickerBox.y + pickerBox.height)
    }
    if (replying) {
      const longName = 'Bob with a very long name '.repeat(8).trim()
      await page.evaluate((name) => { window.chatHistoryTest.renamePeer('bob', name); window.chatHistoryTest.typing('bob', true) }, longName)
      await expect(page.locator('.chat-typing-indicator')).toHaveText(`${longName} is typing…`)
      await expect.poll(layout).toEqual(before)
      await expect(page.locator('.chat-typing-indicator span')).toHaveCSS('white-space', 'nowrap')
      expect(await page.locator('.chat-typing-indicator span').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
      await expect(search).toBeFocused()
    }
    await search.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(composer).toHaveValue('Keep this draft')
  }
})

for (const viewport of [{ width: 390, height: 600 }, { width: 844, height: 390 }, { width: 390, height: 380 }]) {
  test(`media controls fit ${viewport.width}x${viewport.height} and remain reachable after keyboard resize`, { tag: '@fixed-viewport' }, async ({ page }) => {
    await page.setViewportSize(viewport)
    const composer = page.getByRole('textbox', { name: 'Message room chat' })
    await composer.fill('A draft stays here')
    await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
    const picker = page.locator('.chat-picker-popover')
    await expect(picker.getByPlaceholder('Find the perfect emoji')).toBeVisible()
    await expect.poll(async () => {
      const box = (await picker.boundingBox())!, composerBox = (await page.locator('.chat-composer').boundingBox())!
      return box.y >= 0 && box.y + box.height <= composerBox.y + 1 && box.x >= 0 && box.x + box.width <= viewport.width
    }).toBe(true)
    await expect(picker.getByRole('button', { name: 'Close media picker' })).toHaveCSS('height', '44px')
    await picker.getByRole('tab', { name: 'GIFs', exact: true }).click()
    await expect(picker.locator('.chat-gif-tile')).toHaveCount(8)
    await picker.getByPlaceholder('Search GIFs').fill('dance')
    await picker.getByPlaceholder('Search GIFs').press('Enter')
    await expect(picker.locator('.chat-gif-tile')).toHaveCount(8)
    await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height, 380) })
    await expect.poll(async () => {
      const box = (await picker.boundingBox())!, composerBox = (await page.locator('.chat-composer').boundingBox())!
      return box.y >= 0 && box.y + box.height <= composerBox.y + 1
    }).toBe(true)
    await picker.locator('.chat-gif-tile').first().click()
    await expect(picker).toHaveCount(0)
    await expect(composer).toHaveValue('A draft stays here')
    await expect(page.locator('.chat-message-item').last().locator('.chat-media-link')).toBeVisible()
    await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
    await picker.getByRole('button', { name: 'Close media picker' }).click()
    await expect(composer).toBeFocused()
  })
}

test('direct reaction control escapes row clipping, fits above the keyboard composer and returns focus to its message', { tag: '@fixed-viewport' }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 })
  // Keep the direct control's focus handoff stable while the lazy picker loads.
  let releasePicker!: () => void
  const pickerLoad = new Promise<void>((resolve) => { releasePicker = resolve })
  let pickerRequested = false
  await page.route('**/node_modules/.vite/deps/emoji-picker-react.js*', async (route) => {
    pickerRequested = true
    await pickerLoad
    await route.continue()
  })
  const message = page.locator(`#chat-message-${id(420)}`)
  const trigger = message.getByRole('button', { name: 'More reactions', exact: true })
  const dialog = page.getByRole('dialog', { name: "React to Mira's message" })
  const close = dialog.getByRole('button', { name: 'Close reactions' })
  try {
    await message.getByRole('button', { name: 'More reactions', exact: true }).click()
    await expect.poll(() => pickerRequested).toBe(true)
    await expect(dialog).toHaveCount(1)
    await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0)
    await expect(close).toBeFocused()
    releasePicker()
    await expect(dialog.getByPlaceholder('Find an emoji')).toBeVisible()
    await expect(close).toBeFocused()
  } finally {
    releasePicker()
  }
  await page.setViewportSize({ width: 390, height: 380 })
  await expect.poll(async () => {
    const box = await dialog.boundingBox(), composerBox = await page.locator('.chat-composer').boundingBox()
    return Boolean(box && composerBox && box.y >= 8 && box.y + box.height <= composerBox.y + 1 && box.x >= 0 && box.x + box.width <= 390)
  }).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Close reactions' })).toHaveCSS('height', '44px')
  await dialog.getByPlaceholder('Find an emoji').focus()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await message.getByRole('button', { name: 'More reactions', exact: true }).click()
  await dialog.getByPlaceholder('Find an emoji').fill('heart')
  const emoji = dialog.locator('button.epr-emoji').first()
  await expect(emoji).toBeVisible()
  await emoji.click()
  await expect(dialog).toHaveCount(0)
  await expect(message.locator('.chat-message-reactions > button')).toHaveCount(1)
  await page.setViewportSize({ width: 1440, height: 900 })
  await message.hover()
  await message.locator('.chat-message-actions').getByRole('button', { name: 'More reactions', exact: true }).click()
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('notification activation returns from old context to the correct live row and ignores departed-account actions', async ({ page }) => {
  await page.getByRole('button', { name: 'Search room messages', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search all saved room messages' }).fill('needle')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('button', { name: 'View message from Mira: needle message 25', exact: true }).click()
  await expect(page.locator('.chat-context-banner')).toBeVisible()
  await page.evaluate((message) => { window.notificationTest.setAttention(false, false); window.chatHistoryTest.receive(message) }, incoming(999))
  await expect.poll(() => page.evaluate(() => window.notificationTest.events.length)).toBe(1)
  await page.evaluate(() => { window.notificationTest.setAttention(true, true); window.notificationTest.activateLatest() })
  await expect(page.locator('.chat-context-banner')).toHaveCount(0)
  await expect(page.locator(`#chat-message-${id(999)}`)).toBeFocused()
  await expect(page.locator(`#chat-message-${id(999)}`)).toHaveClass(/chat-message-jump-target/)
  await page.getByRole('button', { name: 'Hide chat pane', exact: true }).click()
  await page.evaluate((message) => { window.notificationTest.setAttention(false, false); window.chatHistoryTest.receive(message) }, incoming(998))
  await expect.poll(() => page.evaluate(() => window.notificationTest.events.length)).toBe(2)
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.evaluate(() => window.notificationTest.activateLatest())
  await expect(page.getByRole('button', { name: 'Show chat pane', exact: true })).toBeVisible()
  await expect(page.locator(`#chat-message-${id(998)}`)).toHaveCount(0)
})

const attachment = (index: number, url: string) => ({ ...incoming(index, false), content: 'Private room image', type: 'image', mediaUrl: url, storagePath: `mira/lounge/${id(index)}.png` })

test('expired uploaded images refresh through the authorized room route without changing message identity', async ({ page }) => {
  await page.route('https://private.example.test/**', (route) => route.request().url().includes('revision=')
    ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#889955"/></svg>' })
    : route.fulfill({ status: 403, body: 'Expired image capability' }))
  await page.evaluate((message) => window.chatHistoryTest.receive(message), attachment(997, 'https://private.example.test/image.png?expired=true'))
  const row = page.locator(`#chat-message-${id(997)}`)
  await expect.poll(() => databases.get(page)!.mediaRequests.length).toBe(1)
  await expect(row.locator('img').last()).toHaveAttribute('src', /revision=1/)
  await expect(row.getByRole('button', { name: 'Retry image' })).toHaveCount(0)
  await row.evaluate((element) => element.setAttribute('data-lifetime', 'same'))
  await page.evaluate((message) => window.chatHistoryTest.receive(message), attachment(997, 'https://private.example.test/image.png?expired=true'))
  await expect(row).toHaveAttribute('data-lifetime', 'same')
  await expect.poll(() => databases.get(page)!.mediaRequests.length).toBe(1)
})

test('hidden near-expiry uploads wait for room visibility and refresh with the current account token', async ({ page }) => {
  await page.route('https://private.example.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#889955"/></svg>' }))
  const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 10 })).toString('base64url')}.signature`
  await page.getByRole('button', { name: 'Hide chat pane', exact: true }).click()
  await page.evaluate((message) => window.chatHistoryTest.receive(message), attachment(996, `https://private.example.test/image.png?token=${token}`))
  await expect(page.locator(`#chat-message-${id(996)}`)).toBeAttached()
  expect(databases.get(page)!.mediaRequests.length).toBe(0)
  const request = page.waitForRequest((request) => request.url().includes('/chat/media-url'))
  await page.getByRole('button', { name: 'Show chat pane', exact: true }).click()
  expect((await request).headers().authorization).toBe('Bearer alice-token')
  await expect.poll(() => databases.get(page)!.mediaRequests.length).toBe(1)
  await expect(page.locator(`#chat-message-${id(996)} img`).last()).toHaveAttribute('src', /revision=1/)
  const nextRequest = page.waitForRequest((request) => request.url().includes('/chat/media-url'))
  await page.evaluate(() => window.chatHistoryTest.rotateToken())
  expect((await nextRequest).headers().authorization).toBe('Bearer alice-token-1')
  await expect.poll(() => databases.get(page)!.mediaRequests.length).toBe(2)
  await expect(page.locator(`#chat-message-${id(996)}`)).toHaveCount(1)
})

test('broken or unauthorized uploaded image recovery is bounded and has an explicit retry', async ({ page }) => {
  await page.route('https://private.example.test/**', (route) => route.fulfill({ status: 403, body: 'Unavailable image' }))
  let requests = 0
  page.on('request', (request) => { if (request.url().includes('/chat/media-url')) requests++ })
  databases.get(page)!.allowed = false
  await page.evaluate((message) => window.chatHistoryTest.receive(message), attachment(995, 'https://private.example.test/image.png?expired=true'))
  const row = page.locator(`#chat-message-${id(995)}`)
  await expect(row.getByRole('button', { name: 'Retry image' })).toBeVisible()
  expect(requests).toBe(1)
  databases.get(page)!.allowed = true
  await row.getByRole('button', { name: 'Retry image' }).click()
  await expect(row.locator('img').last()).toHaveAttribute('src', /revision=1/)
  await expect(row.getByRole('button', { name: 'Retry image' })).toBeVisible()
  expect(requests).toBe(2)
  await page.getByRole('textbox', { name: 'Message room chat' }).fill('composer remains usable')
  expect(requests).toBe(2)
})
