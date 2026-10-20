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
async function setHidden(page: Page, row: Locator, hidden: boolean) {
  await row.hover()
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
  await page.goto('/tests/browser/chat/harnesses/history/index.html')
  await expect(page.locator('.chat-message-item')).toHaveCount(4)
})

test('Hide a message from the conversation, reply and search previews, then restore it', async ({ page }) => {
  const target = messageRow(page, 1)
  const reply = messageRow(page, 2).locator('.chat-message-reply')
  await target.hover()
  await actions(target).click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('Keep this reply draft')
  await page.getByRole('button', { name: 'Search room messages', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search all saved room messages' }).fill('Sensitive')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const searchResult = page.getByRole('button', { name: 'View message from Mira: ' + sensitiveText, exact: true })
  await expect(searchResult).toBeVisible()
  await setHidden(page, target, true)
  await expect(target).toContainText('Hidden')
  await expect(reply).toContainText('Hidden')
  await expect(page.locator('.chat-reply-composer small')).toHaveText('Hidden')
  await expect(page.getByRole('button', { name: 'View message from Mira: Hidden', exact: true })).toBeVisible()
  await expect(searchResult).toHaveCount(0)
  await expect(page.locator('[data-chat-surface]')).not.toContainText(sensitiveText)
  await expect(composer).toHaveValue('Keep this reply draft')
  await setHidden(page, target, false)
  await expect(reply).toContainText(sensitiveText)
  await expect(searchResult).toBeVisible()
  expect(writes.get(page)).toEqual([])
})

test('Keep hidden images private to this account and room after a reload', async ({ page }) => {
  const target = messageRow(page, 3)
  const image = target.getByRole('img', { name: 'Sensitive room image', exact: true })
  await setHidden(page, target, true)
  await expect(image).toHaveCount(0)
  await page.reload()
  await expect(target).toContainText('Hidden')
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(image).toBeVisible()
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await expect(target).toContainText('Hidden')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(image).toBeVisible()
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(target).toContainText('Hidden')
  await setHidden(page, target, false)
  await page.reload()
  await expect(image).toBeVisible()
  expect(writes.get(page)).toEqual([])
})
