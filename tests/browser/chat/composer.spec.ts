import { expect, test } from '@playwright/test'

declare global { interface Window { chatQolTest: {
  broadcastIds: string[]; saveIds: string[]; failSave: boolean; failSend: boolean; disconnect(): void
} } }

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { giphyConfigured: false } }))
  await page.goto('/tests/browser/chat/harnesses/composer/index.html')
  await expect(page.getByRole('textbox', { name: 'Message room chat' })).toBeEnabled()
})

test('Send a reply with a listener mention and emoji', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await page.getByRole('button', { name: 'Message actions for Mira' }).first().click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  await expect(composer).toBeFocused()
  await composer.fill('@Mi')
  await page.getByRole('listbox', { name: 'Tag a listener' }).getByRole('option').first().click()
  await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('grinning face')
  await page.getByRole('button', { name: 'grinning face', exact: true }).click()
  await expect(composer).toBeFocused()
  await expect(composer).toHaveValue('@Mira 😀')
  await composer.pressSequentially(' Great track')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  const reply = page.locator('.chat-message-item').filter({ hasText: 'Great track' })
  await expect(reply).toHaveCount(1)
  await expect(reply).toContainText('@Mira')
  await expect(reply.getByRole('img', { name: '😀', exact: true }).or(reply.getByText('😀 Great track', { exact: true }))).toBeVisible()
  await expect(reply.locator('.chat-message-reply')).toContainText('A song for tonight')
  await expect.poll(() => page.evaluate(() => window.chatQolTest.saveIds.length)).toBe(1)
})

test('Retry a failed message without duplicates or losing the next draft', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await page.evaluate(() => { window.chatQolTest.failSend = true })
  await composer.fill('Keep this message')
  await composer.press('Enter')
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

test('Keep drafts when returning to a room and clear them on sign out', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('first line')
  await composer.press('Shift+Enter')
  await composer.pressSequentially('second line')
  await page.getByRole('button', { name: 'Navigate away' }).click()
  await page.getByRole('button', { name: 'Return to chat' }).click()
  await expect(composer).toHaveValue('first line\nsecond line')
  await page.reload()
  await expect(composer).toHaveValue('first line\nsecond line')
  await page.getByRole('button', { name: 'Switch room' }).click()
  await expect(composer).toHaveValue('')
  await page.getByRole('button', { name: 'Switch room' }).click()
  await expect(composer).toHaveValue('first line\nsecond line')
  await page.getByRole('button', { name: 'Switch account' }).click()
  await expect(composer).toHaveValue('')
  await page.getByRole('button', { name: 'Switch account' }).click()
  await expect(composer).toHaveValue('first line\nsecond line')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Return to chat' }).click()
  await expect(composer).toHaveValue('')
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
