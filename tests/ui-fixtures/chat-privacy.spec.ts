import { expect, test, type Locator, type Page } from '@playwright/test'

const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const sensitiveText = 'Sensitive account number 12345'
const mediaUrl = (type: string) => `https://media.giphy.com/media/privacy-fixture/${type}`
const rows = [
  { id: id(1), content: sensitiveText, message_type: 'text', reply_to_id: null, media_url: null },
  { id: id(2), content: 'A reply to the private message', message_type: 'text', reply_to_id: id(1), media_url: null },
  { id: id(3), content: 'Sensitive room image', message_type: 'image', reply_to_id: null, media_url: mediaUrl('image.png') },
  { id: id(4), content: 'Sensitive room GIF', message_type: 'gif', reply_to_id: null, media_url: mediaUrl('animation.gif') },
].map((message, index) => ({ ...message, room_slug: 'lounge', created_at: `2026-10-06T10:00:0${index}Z`,
  user_id: 'mira', user_name: 'Mira', avatar_seed: 'mira', storage_path: null, mentions: [],
  soundspin_message_reactions: index === 0 ? [{ emoji: '❤️', user_id: 'bob' }] : [] }))

const writes = new WeakMap<Page, string[]>()
const messageRow = (page: Page, index: number) => page.locator(`#chat-message-${id(index)}`)
const actions = (row: Locator) => row.getByRole('button', { name: 'Message actions for Mira', exact: true })
const visibilityKey = (userId = 'alice', roomName = 'soundspin:lounge') =>
  `soundspin-chat-hidden:${encodeURIComponent(userId)}:${encodeURIComponent(roomName)}`

async function changeDeviceVisibility(page: Page, ids: string[], userId = 'alice', roomName = 'soundspin:lounge') {
  await page.evaluate(({ key, ids }) => {
    const oldValue = localStorage.getItem(key)
    const newValue = ids.length ? JSON.stringify(ids) : null
    if (newValue) localStorage.setItem(key, newValue)
    else localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }))
  }, { key: visibilityKey(userId, roomName), ids })
}

async function replayDeviceVisibility(page: Page) {
  await page.evaluate((key) => {
    const value = localStorage.getItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue: value, newValue: value, storageArea: localStorage }))
  }, visibilityKey())
}

async function setHidden(page: Page, row: Locator, hidden: boolean) {
  await actions(row).click()
  await page.getByRole('menuitem', { name: hidden ? 'Hide message' : 'Unhide message', exact: true }).click()
  await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0)
  await expect(actions(row)).toBeFocused()
}

test.beforeEach(async ({ page }) => {
  const mutations: string[] = []
  writes.set(page, mutations)
  await page.route('**/api/config', (route) => route.fulfill({ json: { giphyConfigured: false } }))
  await page.route('https://media.giphy.com/media/privacy-fixture/**', (route) => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#667755"/></svg>' }))
  await page.route('**/api/rooms/*/chat/**', (route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      mutations.push(request.url())
      return route.fulfill({ json: {} })
    }
    const url = new URL(request.url())
    const parts = url.pathname.split('/')
    const action = parts[5]
    // Reuse IDs across fixture rooms to verify the room is part of the privacy scope.
    const scope = rows.map((row) => ({ ...row, room_slug: parts[3] }))
    const payload = (selected: typeof scope) => ({ rows: selected, replies: scope, profiles: [] })
    if (action === 'messages') return route.fulfill({ json: payload(scope.filter((row) => row.id === parts[6])) })
    if (action === 'context') return route.fulfill({ json: { ...payload(scope),
      olderCursor: { createdAt: scope[0].created_at, id: scope[0].id },
      newerCursor: { createdAt: scope.at(-1)!.created_at, id: scope.at(-1)!.id }, hasOlder: false, hasNewer: false } })
    const term = url.searchParams.get('q')?.toLowerCase()
    return route.fulfill({ json: { ...payload(term ? scope.filter((row) => row.content.toLowerCase().includes(term)) : scope), hasMore: false } })
  })
  await page.goto('/tests/chat-history-harness/index.html')
  await expect(page.locator('.chat-message-item')).toHaveCount(4)
})

test('dots menu hides and restores text, reply context, images and GIFs without changing room messages', async ({ page }, testInfo) => {
  for (let index = 1; index <= 4; index++) {
    const row = messageRow(page, index)
    const fixture = rows[index - 1]
    await actions(row).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Reply', 'Hide message'])
    await expect(page.getByRole('menuitem', { name: /reaction|React with/i })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Hide message', exact: true }).click()
    await expect(actions(row)).toBeFocused()
    await expect(row.locator('.chat-message-body')).toHaveText('Hidden')
    await expect(row.locator('.chat-message-actions, .chat-message-reactions, .chat-media-link, .chat-message-reply')).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'More reactions', exact: true })).toHaveCount(0)
    expect(await row.evaluate((element) => element.innerHTML)).not.toContain(fixture.content)
    if (fixture.media_url) expect(await row.evaluate((element) => element.innerHTML)).not.toContain(fixture.media_url)
    await actions(row).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Unhide message'])
    if (index === 1) await page.screenshot({ path: testInfo.outputPath('hidden-message-menu.png') })
    await page.getByRole('menuitem', { name: 'Unhide message', exact: true }).click()
    await expect(actions(row)).toBeFocused()
    if (fixture.message_type === 'text') await expect(row.locator('.chat-message-body')).toHaveText(fixture.content)
    else await expect(row.locator('.chat-media-link img')).toHaveAttribute('alt', fixture.content)
    if (index === 1) await expect(row.locator('.chat-message-reactions > button')).toHaveCount(1)
    if (index === 2) await expect(row.locator('.chat-message-reply')).toContainText(sensitiveText)
  }
  expect(writes.get(page)).toEqual([])
  expect(await page.evaluate(() => {
    const harness = (window as unknown as { chatHistoryTest: { sendIds: string[]; saveIds: string[] } }).chatHistoryTest
    return { sendIds: harness.sendIds, saveIds: harness.saveIds }
  })).toEqual({ sendIds: [], saveIds: [] })
})

test('hiding a target redacts existing reply, composer and search previews including accessible labels', async ({ page }) => {
  const target = messageRow(page, 1)
  const reply = messageRow(page, 2).locator('.chat-message-reply')
  await actions(target).click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  await expect(page.locator('.chat-reply-composer small')).toHaveText(sensitiveText)
  await page.getByRole('textbox', { name: 'Message room chat' }).fill('Keep this reply draft')
  await page.getByRole('button', { name: 'Search room messages', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search all saved room messages' }).fill('Sensitive')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const searchResult = page.getByRole('button', { name: `View message from Mira: ${sensitiveText}`, exact: true })
  await expect(searchResult).toBeVisible()
  await setHidden(page, target, true)
  await expect(reply).toContainText('Hidden')
  await expect(reply).not.toContainText(sensitiveText)
  await expect(page.locator('.chat-reply-composer small')).toHaveText('Hidden')
  await expect(page.getByRole('button', { name: 'View message from Mira: Hidden', exact: true })).toBeVisible()
  await expect(searchResult).toHaveCount(0)
  const surface = page.locator('[data-chat-surface]')
  expect(await surface.evaluate((element) => element.innerHTML)).not.toContain(sensitiveText)
  await expect(page.getByRole('textbox', { name: 'Message room chat' })).toHaveValue('Keep this reply draft')
  await setHidden(page, target, false)
  await expect(reply).toContainText(sensitiveText)
  await expect(page.locator('.chat-reply-composer small')).toHaveText(sensitiveText)
  await expect(searchResult).toBeVisible()
})

test('hidden messages survive reload and remain isolated by account and room', async ({ page }) => {
  const target = messageRow(page, 1)
  await setHidden(page, target, true)
  await page.reload()
  await expect(target.locator('.chat-message-body')).toHaveText('Hidden')
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(target.locator('.chat-message-body')).toHaveText(sensitiveText)
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(target.locator('.chat-message-body')).toHaveText('Hidden')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(target.locator('.chat-message-body')).toHaveText(sensitiveText)
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(target.locator('.chat-message-body')).toHaveText('Hidden')
  await setHidden(page, target, false)
  await page.reload()
  await expect(target.locator('.chat-message-body')).toHaveText(sensitiveText)
  expect(writes.get(page)).toEqual([])
})

test('another tab can hide an open reaction picker without reopening it on unhide or stealing composer focus', async ({ page }) => {
  const target = messageRow(page, 1)
  const reaction = target.getByRole('button', { name: 'More reactions', exact: true })
  const dialog = page.getByRole('dialog', { name: "React to Mira's message" })
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await target.hover()
  await reaction.click()
  await expect(dialog.getByRole('button', { name: 'Close reactions' })).toBeFocused()
  await changeDeviceVisibility(page, [id(1)], 'bob')
  await changeDeviceVisibility(page, [id(1)], 'alice', 'soundspin:other-room')
  await expect(dialog).toBeVisible()
  await expect(target.locator('.chat-message-body')).toHaveText(sensitiveText)
  await changeDeviceVisibility(page, [id(1)])
  await expect(dialog).toHaveCount(0)
  await expect(target.locator('.chat-message-body')).toHaveText('Hidden')
  await expect(actions(target)).toBeFocused()
  await expect(messageRow(page, 2).locator('.chat-message-reply')).toContainText('Hidden')
  await changeDeviceVisibility(page, [])
  await expect(target.locator('.chat-message-body')).toHaveText(sensitiveText)
  await expect(dialog).toHaveCount(0)
  await expect(reaction).toHaveAttribute('aria-expanded', 'false')
  await target.hover()
  await reaction.click()
  await expect(dialog).toBeVisible()
  await composer.focus()
  await changeDeviceVisibility(page, [id(1)])
  await expect(dialog).toHaveCount(0)
  await expect(target.locator('.chat-message-body')).toHaveText('Hidden')
  await expect(composer).toBeFocused()
})

test('failed device writes keep both local hide and local unhide choices when another storage event arrives', async ({ page }) => {
  await changeDeviceVisibility(page, [id(1), id(3)])
  await expect(messageRow(page, 1).locator('.chat-message-body')).toHaveText('Hidden')
  // Block only privacy writes after loading, leaving themes, drafts and other app storage usable.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function(key: string, value: string) {
      if (this === localStorage && key.startsWith('soundspin-chat-hidden:')) throw new DOMException('Storage is unavailable', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  const hiddenLocally = messageRow(page, 2)
  await setHidden(page, hiddenLocally, true)
  await expect(hiddenLocally.locator('.chat-message-body')).toHaveText('Hidden')
  await replayDeviceVisibility(page)
  await expect(hiddenLocally.locator('.chat-message-body')).toHaveText('Hidden')
  const unhiddenLocally = messageRow(page, 1)
  await setHidden(page, unhiddenLocally, false)
  await expect(unhiddenLocally.locator('.chat-message-body')).toHaveText(sensitiveText)
  await replayDeviceVisibility(page)
  await expect(unhiddenLocally.locator('.chat-message-body')).toHaveText(sensitiveText)
  await expect(hiddenLocally.locator('.chat-message-body')).toHaveText('Hidden')
  await expect(messageRow(page, 3).locator('.chat-message-body')).toHaveText('Hidden')
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), visibilityKey())).toEqual([id(1), id(3)])
  await page.getByRole('textbox', { name: 'Message room chat' }).fill('Draft still works')
  await expect(page.getByRole('textbox', { name: 'Message room chat' })).toHaveValue('Draft still works')
})
