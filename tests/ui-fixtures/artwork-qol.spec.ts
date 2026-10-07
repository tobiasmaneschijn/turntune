import { expect, test, type Route } from '@playwright/test'

declare global { interface Window { artworkQolTest: { mounts: number; unmounts: number } } }
const art = (name: string) => `/tests/artwork-qol-harness/art/${name}.svg`
const svg = (name: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${name === 'b' ? '#285968' : name === 'c' ? '#833c51' : '#565025'}"/><circle cx="200" cy="200" r="120" fill="#d8ff57"/><text x="200" y="220" text-anchor="middle" font-family="sans-serif" font-size="64" fill="#151a0d">${name.toUpperCase()}</text></svg>`
const fulfill = (route: Route, name = 'a') => route.fulfill({ contentType: 'image/svg+xml', body: svg(name) })

test.beforeEach(async ({ page }) => {
  await page.route('**/art/*.svg', (route) => route.request().url().endsWith('/broken.svg')
    ? route.fulfill({ status: 404, body: 'missing' }) : fulfill(route, route.request().url().split('/').at(-1)!.replace('.svg', '')))
  await page.goto('/tests/artwork-qol-harness/index.html')
  await expect(page.locator('.album-art-preview')).toHaveAttribute('data-artwork-state', 'ready')
})

test('slow artwork retains its predecessor and keeps surface geometry until decode succeeds', async ({ page }) => {
  let slow: Route | undefined
  await page.route('**/art/slow.svg', (route) => { slow = route })
  const preview = page.locator('.album-art-preview')
  const stageBefore = await page.getByTestId('artwork-stage').boundingBox()
  const previewBefore = await preview.boundingBox()
  expect(previewBefore?.height).toBeGreaterThan(100)
  expect(previewBefore?.width).toBeCloseTo(previewBefore!.height, 0)
  await page.getByRole('button', { name: 'Set Slow', exact: true }).click()
  await expect(preview).toHaveAttribute('data-artwork-state', 'loading')
  await expect(preview).toHaveAttribute('data-current-source', art('a'))
  expect(await page.getByTestId('artwork-stage').boundingBox()).toEqual(stageBefore)
  expect(await preview.boundingBox()).toEqual(previewBefore)
  expect(await preview.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return document.elementFromPoint(x + width / 2, y + height / 2)?.closest('.album-art-preview') === element
  })).toBe(true)
  await expect.poll(() => Boolean(slow)).toBe(true)
  await fulfill(slow!, 'slow')
  await expect(preview).toHaveAttribute('data-current-source', art('slow'))
  await expect(preview).toHaveAttribute('data-artwork-state', 'ready')
  await expect(preview.locator('img')).toHaveCount(1)
  expect(await preview.boundingBox()).toEqual(previewBefore)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: test.info().outputPath('artwork-ready.png') })
})

test('a superseded slow source never wins over the newest image or remounts its neighboring lifetime', async ({ page }) => {
  let slow: Route | undefined
  await page.route('**/art/slow.svg', (route) => { slow = route })
  const preview = page.locator('.album-art-preview')
  await page.getByRole('button', { name: 'Set Slow', exact: true }).click()
  await expect.poll(() => Boolean(slow)).toBe(true)
  await page.getByRole('button', { name: 'Set B', exact: true }).click()
  await expect(preview).toHaveAttribute('data-current-source', art('b'))
  await page.getByRole('button', { name: 'Set C', exact: true }).click()
  await expect(preview).toHaveAttribute('data-current-source', art('c'))
  await fulfill(slow!, 'slow').catch(() => {})
  await expect(preview).toHaveAttribute('data-artwork-state', 'ready')
  await expect(preview.locator('img')).toHaveCount(1)
  await expect(preview).toHaveAttribute('data-current-source', art('c'))
  expect(await page.evaluate(() => window.artworkQolTest)).toEqual({ mounts: 1, unmounts: 0 })
})

test('broken or missing newest artwork replaces an unrelated predecessor with a stable provider fallback', async ({ page }) => {
  const preview = page.locator('.album-art-preview')
  const before = await preview.boundingBox()
  await page.getByRole('button', { name: 'Set Broken', exact: true }).click()
  await expect(preview).toHaveAttribute('data-artwork-state', 'fallback')
  await expect(preview.locator('img')).toHaveCount(0)
  await expect(preview.locator('.provider-artwork.spotify')).toBeVisible()
  expect(await preview.boundingBox()).toEqual(before)
  await page.getByRole('button', { name: 'Set B', exact: true }).click()
  await expect(preview).toHaveAttribute('data-current-source', art('b'))
  await page.getByRole('button', { name: 'Set Missing', exact: true }).click()
  await expect(preview).toHaveAttribute('data-artwork-state', 'fallback')
  await expect(preview.locator('img')).toHaveCount(0)
  expect(await preview.boundingBox()).toEqual(before)
})

test('OS and app reduced-motion changes remove outgoing layers and disable artwork animation', async ({ page }) => {
  const preview = page.locator('.album-art-preview')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Set B', exact: true }).click()
  await expect(preview).toHaveAttribute('data-current-source', art('b'))
  await expect(preview.locator('img')).toHaveCount(1)
  await expect(preview.locator('img')).toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Toggle motion', exact: true }).click()
  await page.getByRole('button', { name: 'Set C', exact: true }).click()
  await expect(preview).toHaveAttribute('data-current-source', art('c'))
  await expect(preview.locator('img')).toHaveCount(1)
  await expect(preview.locator('img')).toHaveCSS('animation-name', 'none')
})

test('compact artwork remains sharp, bounded and decorative while hiding the large preview', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle compact', exact: true }).click()
  await expect(page.locator('.album-art-preview')).toBeHidden()
  const ambient = page.locator('.ambient-artwork')
  await expect(ambient).toHaveAttribute('aria-hidden', 'true')
  await expect(ambient.locator('.track-artwork-current')).toHaveCSS('filter', 'none')
  await expect(ambient.locator('.track-artwork-current')).toHaveCSS('transform', 'none')
  const bounds = await page.getByTestId('artwork-stage').boundingBox()
  expect(bounds?.width).toBe(84)
  expect(bounds?.height).toBe(84)
})

test('mobile pane arrival uses opacity only and honors live reduced-motion preferences', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tests/ui-harness/index.html?scenario=workspace-controls')
  const chatTab = page.getByRole('tab', { name: 'Chat, 3 unread' })
  await chatTab.click()
  const chat = page.locator('.room-panels > #chat[data-panel]')
  await expect(chat).toHaveCSS('animation-name', 'room-pane-arrive')
  await expect(chat).toHaveCSS('transform', 'none')
  await expect(chatTab).toBeFocused()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(chat).toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => document.documentElement.classList.add('reduced-motion'))
  await page.getByRole('tab', { name: 'Radio', exact: true }).click()
  await expect(page.locator('.room-panels > #radio[data-panel]')).toHaveCSS('animation-name', 'none')
})
