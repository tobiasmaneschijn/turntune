import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ json: { giphyConfigured: false } }))
  await page.goto('/tests/chat-qol-harness/index.html')
})

test('emoji replaces a multiline selection and restores the caret for continued typing', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('hello\nworld')
  await composer.evaluate((input: HTMLTextAreaElement) => { input.focus(); input.setSelectionRange(6, 11); input.dispatchEvent(new Event('select', { bubbles: true })) })
  await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('grinning face')
  await page.getByRole('button', { name: 'grinning face', exact: true }).click()
  await expect(composer).toHaveValue('hello\n😀')
  await expect(composer).toBeFocused()
  await composer.press('!')
  await expect(composer).toHaveValue('hello\n😀!')
})

test('mention textbox and both picker modes have resolved relationships and a separate Close action', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('@Mi')
  await expect(page.getByRole('listbox', { name: 'Tag a listener' })).toBeVisible()
  await expect(composer).not.toHaveAttribute('aria-expanded')
  await composer.press('Enter')
  await expect(composer).toHaveValue('@Mira ')
  await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search emoji' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Message media' }).getByRole('button', { name: 'Close media picker' })).toHaveCount(0)
  const unresolved = await page.evaluate(() => [...document.querySelectorAll('[aria-controls],[aria-activedescendant],[aria-labelledby]')].flatMap((element) => ['aria-controls', 'aria-activedescendant', 'aria-labelledby'].flatMap((attribute) => (element.getAttribute(attribute) || '').split(/\s+/).filter((id) => id && !document.getElementById(id)))))
  expect(unresolved).toEqual([])
  await page.getByRole('searchbox', { name: 'Search emoji' }).press('Escape')
  await expect(composer).toBeFocused()
})

for (const theme of ['light', 'dark']) {
  test(`${theme} picker uses project theme and readable header/control ink`, async ({ page }) => {
    await page.evaluate((theme) => localStorage.setItem('soundspin-theme', theme), theme)
    await page.reload()
    await page.getByRole('button', { name: 'Add emoji', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: 'Search emoji' })).toBeVisible()
    await expect(page.locator('.EmojiPickerReact')).toBeVisible()
    if (theme === 'dark') await expect(page.locator('.EmojiPickerReact')).toHaveClass(/epr-dark-theme/)
    else await expect(page.locator('.EmojiPickerReact')).not.toHaveClass(/epr-dark-theme/)
    const colors = await page.locator('.chat-picker-close').evaluate((element) => {
      const style = getComputedStyle(element)
      const reference = document.createElement('span'); reference.style.color = 'var(--muted-foreground)'; element.append(reference)
      const expected = getComputedStyle(reference).color; reference.remove()
      return { actual: style.color, expected }
    })
    expect(colors.actual).toEqual(colors.expected)
    await expect(page.locator('.chat-picker-tabs').getByRole('tab', { name: 'Emoji', exact: true })).toHaveCSS('font-size', '14px')
  })
}

test('disconnecting during image upload preserves the attachment and draft before delivery takes ownership', async ({ page }) => {
  await page.unroute('**/api/config')
  await page.route('**/api/config', (route) => route.fulfill({ json: { giphyConfigured: false, supabase: { url: 'https://storage.fixture.test', anonKey: 'fixture-public-key' } } }))
  await page.reload()
  let finish!: () => void
  let started = false
  const held = new Promise<void>((resolve) => { finish = resolve })
  await page.route('**/storage/v1/object/chat-media/**', async (route) => {
    started = true; await held
    await route.fulfill({ json: { Id: 'object-id', Key: 'chat-media/object-path' } })
  })
  await page.route('**/storage/v1/object/chat-media', (route) => route.fulfill({ json: [] }))
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  await composer.fill('Keep the text')
  await page.locator('input[type=file]').setInputFiles({ name: 'attached.png', mimeType: 'image/png', buffer: Buffer.from('image') })
  try {
    await expect.poll(() => started).toBe(true)
    await expect(composer).toBeEnabled()
    await composer.fill('Newer text while uploading')
    await page.evaluate(() => (window as unknown as { chatQolTest: { disconnect(): void } }).chatQolTest.disconnect())
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
    finish()
    await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toBeVisible()
    await expect(page.getByText('attached.png', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('Newer text while uploading')
    expect(await page.evaluate(() => (window as unknown as { chatQolTest: { broadcastIds: string[] } }).chatQolTest.broadcastIds)).toEqual([])
  } finally { finish() }
})

test('a full recovery outbox retains an uploaded image when delivery rejects it before queueing', async ({ page }) => {
  test.setTimeout(90_000)
  await page.unroute('**/api/config')
  await page.route('**/api/config', (route) => route.fulfill({ json: { giphyConfigured: false, supabase: { url: 'https://storage.fixture.test', anonKey: 'fixture-public-key' } } }))
  await page.route('**/storage/v1/object/chat-media/**', (route) => route.fulfill({ json: { Id: 'object-id', Key: 'chat-media/object-path' } }))
  await page.route('**/storage/v1/object/chat-media', (route) => route.fulfill({ json: [] }))
  await page.reload()
  await page.evaluate(() => { (window as unknown as { chatQolTest: { failSend: boolean } }).chatQolTest.failSend = true })
  const composer = page.getByRole('textbox', { name: 'Message room chat' })
  for (let index = 0; index < 100; index++) {
    await composer.fill(`Pending ${index}`)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.locator('.chat-message-save-failed')).toHaveCount(index + 1)
  }
  await page.locator('input[type=file]').setInputFiles({ name: 'capacity.png', mimeType: 'image/png', buffer: Buffer.from('image') })
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toBeVisible()
  await expect(page.getByText('capacity.png', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Retry pending messages' })).toContainText('Retry pending messages')
  expect(await page.evaluate(() => (window as unknown as { chatQolTest: { broadcastIds: string[] } }).chatQolTest.broadcastIds.length)).toBe(100)
})
