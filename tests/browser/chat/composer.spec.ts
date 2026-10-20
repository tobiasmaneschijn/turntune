import { expect, test } from '@playwright/test'

declare global { interface Window { chatQolTest: {
  broadcastIds: string[]; saveIds: string[]; failSave: boolean; failSend: boolean; holdDelivery: boolean
  disconnect(): void; releaseDelivery(id?: string): void
} } }

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { giphyConfigured: false } }))
  await page.goto('/tests/browser/chat/harnesses/composer/index.html')
  await expect(page.getByRole('textbox', { name: 'Message room chat' })).toBeEnabled()
})

test('Send a reply with a listener mention and emoji', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  // Vite fixtures do not send the production image policy. Enforce its pinned
  // emoji source so blocked picker images cannot silently disappear.
  await page.evaluate(() => {
    const policy = document.createElement('meta')
    policy.httpEquiv = 'Content-Security-Policy'
    policy.content = "img-src 'self' data: blob: https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/"
    document.head.append(policy)
  })
  await page.route(/^https:\/\/cdn\.jsdelivr\.net\/gh\/jdecked\/twemoji@17\.0\.3\/assets\/svg\/[0-9a-f-]+\.svg$/, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="32" fill="#ffcc4d"/></svg>',
  }))
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  expect(await composer.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    await page.locator('.chat-message-body').first().evaluate((element) => getComputedStyle(element).fontSize)
  )
  const tools = page.getByRole('group', { name: 'Message tools', exact: true })
  for (const button of await tools.getByRole('button').all()) {
    const bounds = await button.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByRole('button', { name: 'Message actions for Mira' }).first().click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  await expect(composer).toBeFocused()
  await composer.fill('@Mi')
  await page.getByRole('listbox', { name: 'Tag a listener' }).getByRole('option').first().click()
  await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
  const picker = page.getByRole('tabpanel', { name: 'Emoji', exact: true })
  const grinningFace = picker.getByRole('button', { name: 'grinning face', exact: true })
  await expect(grinningFace).toBeVisible()
  await expect.poll(() => grinningFace.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await picker.getByRole('tab', { name: 'Food & drink', exact: true }).click()
  const food = picker.getByRole('rowgroup', { name: 'Food & drink', exact: true }).getByRole('button').first()
  await expect(food).toBeVisible()
  await expect.poll(() => food.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await picker.getByRole('searchbox', { name: 'Search emoji' }).fill('red heart')
  const heart = picker.getByRole('button', { name: 'red heart', exact: true })
  await expect(heart.locator('img')).toHaveAttribute('src', 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/2764.svg')
  await expect.poll(() => heart.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await heart.click()
  await expect(composer).toBeFocused()
  await expect(composer).toHaveValue('@Mira ❤️')
  await composer.pressSequentially(' Great track')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  const reply = page.locator('.chat-message-item').filter({ hasText: 'Great track' })
  await expect(reply).toHaveCount(1)
  await expect(reply).toContainText('@Mira')
  const sentEmoji = reply.getByRole('img', { name: '❤️', exact: true })
  await expect(sentEmoji).toBeVisible()
  await expect.poll(() => sentEmoji.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(reply.locator('.chat-message-reply')).toContainText('A song for tonight')
  await expect.poll(() => page.evaluate(() => window.chatQolTest.saveIds.length)).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth)
  )
})

test('Queue another message while delivery is delayed and keep the next draft', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await page.evaluate(() => { window.chatQolTest.holdDelivery = true })
  await composer.fill('First queued message')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  await expect(composer).toBeFocused()
  await expect(page.locator('.chat-message-item').filter({ hasText: 'First queued message' })).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.chatQolTest.broadcastIds.length)).toBe(1)

  await composer.fill('Second queued message')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(composer).toHaveValue('')
  await expect(composer).toBeFocused()
  await expect(page.locator('.chat-message-item').filter({ hasText: 'Second queued message' })).toHaveCount(1)
  expect(await page.evaluate(() => window.chatQolTest.broadcastIds.length)).toBe(1)

  await composer.fill('Still writing this')
  await page.evaluate(() => window.chatQolTest.releaseDelivery())
  await expect.poll(() => page.evaluate(() => window.chatQolTest.broadcastIds.length)).toBe(2)
  await page.evaluate(() => window.chatQolTest.releaseDelivery())
  await expect.poll(() => page.evaluate(() => window.chatQolTest.saveIds.length)).toBe(2)
  await expect(composer).toHaveValue('Still writing this')
  await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toHaveCount(0)
  expect(new Set(await page.evaluate(() => window.chatQolTest.broadcastIds)).size).toBe(2)
})

test('Retry a failed message without duplicates or losing the next draft', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await page.evaluate(() => { window.chatQolTest.failSend = true })
  await composer.fill('Keep this message')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  await expect(page.getByText('Could not confirm send', { exact: true })).toBeVisible()
  await composer.fill('My next message')
  await page.evaluate(() => { window.chatQolTest.failSend = false; window.chatQolTest.failSave = true })
  await page.getByRole('button', { name: 'Retry send', exact: true }).click()
  await expect(page.getByText('Could not confirm save', { exact: true })).toBeVisible()
  await page.evaluate(() => { window.chatQolTest.failSave = false })
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toHaveCount(0)
  await expect(page.locator('.chat-message-item').filter({ hasText: 'Keep this message' })).toHaveCount(1)
  await expect(composer).toHaveValue('My next message')
  const attempts = await page.evaluate(() => ({ sends: window.chatQolTest.broadcastIds, saves: window.chatQolTest.saveIds }))
  expect(new Set(attempts.sends).size).toBe(1)
  expect(attempts.saves).toEqual([attempts.sends[0], attempts.sends[0]])
})

test('Recover queued messages and drafts without exposing another account\'s work', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  const queued = page.locator('.chat-message-item').filter({ hasText: 'Recover this queued message' })
  await page.evaluate(() => { window.chatQolTest.holdDelivery = true })
  await composer.fill('Recover this queued message')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  await expect.poll(() => page.evaluate(() => window.chatQolTest.broadcastIds.length)).toBe(1)
  await composer.fill('first line')
  await composer.press('Shift+Enter')
  await composer.pressSequentially('second line')
  await page.getByRole('button', { name: 'Navigate away' }).click()
  await page.getByRole('button', { name: 'Return to chat' }).click()
  await expect(composer).toHaveValue('first line\nsecond line')
  await expect(queued).toHaveCount(1)
  await page.reload()
  await expect(composer).toHaveValue('first line\nsecond line')
  await expect(queued).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch room' }).click()
  await expect(composer).toHaveValue('')
  await expect(queued).toHaveCount(0)
  await page.getByRole('button', { name: 'Switch room' }).click()
  await expect(composer).toHaveValue('first line\nsecond line')
  await page.getByRole('button', { name: 'Switch account' }).click()
  await expect(composer).toHaveValue('')
  await expect(queued).toHaveCount(0)
  await page.getByRole('button', { name: 'Switch account' }).click()
  await expect(composer).toHaveValue('first line\nsecond line')
  await expect(queued).toHaveCount(1)
  await page.getByRole('button', { name: 'Retry send', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.chatQolTest.saveIds.length)).toBe(1)
  await page.reload()
  await expect(queued).toHaveCount(1)
  await expect(composer).toHaveValue('first line\nsecond line')
  const attempts = await page.evaluate(() => window.chatQolTest.broadcastIds)
  expect(attempts).toHaveLength(2)
  expect(new Set(attempts).size).toBe(1)

  await page.evaluate(() => { window.chatQolTest.holdDelivery = true })
  await composer.fill('Clear this pending message on sign out')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  await composer.fill('Clear this draft too')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Return to chat' }).click()
  await expect(composer).toHaveValue('')
  await expect(page.locator('.chat-message-item').filter({ hasText: 'Clear this pending message on sign out' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toHaveCount(0)
})

test('An interrupted image upload keeps the attachment and edited draft', async ({ page }) => {
  await page.unroute('**/api/config')
  await page.route('**/api/config', route => route.fulfill({ json: {
    giphyConfigured: false, supabase: { url: 'https://storage.fixture.test', anonKey: 'fixture-public-key' },
  } }))
  await page.reload()
  let finish!: () => void
  let started = false
  const held = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/storage/v1/object/chat-media/**', async route => {
    started = true
    await held
    await route.fulfill({ json: { Id: 'object-id', Key: 'chat-media/object-path' } })
  })
  await page.route('**/storage/v1/object/chat-media', route => route.fulfill({ json: [] }))
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('Keep the text')
  await page.locator('input[type=file]').setInputFiles({ name: 'attached.png', mimeType: 'image/png', buffer: Buffer.from('image') })
  try {
    await expect.poll(() => started).toBe(true)
    await composer.fill('Newer text while uploading')
    await page.evaluate(() => window.chatQolTest.disconnect())
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
    finish()
    await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toBeVisible()
    await expect(page.getByText('attached.png', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('Newer text while uploading')
    expect(await page.evaluate(() => window.chatQolTest.broadcastIds)).toEqual([])
  } finally { finish() }
})
