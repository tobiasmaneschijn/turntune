import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

async function preloadFixture(page: Page, hidden = false) {
  const requests = { queue: [] as string[], history: [] as string[], pick: [] as string[] }
  await page.route('**/art/*.svg', async (route) => {
    const name = route.request().url().split('/').at(-1)!
    const group = name.split('-')[0] as keyof typeof requests
    requests[group]?.push(name)
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#455b50"/></svg>' })
  })
  await page.route('**/api/library', (route) => route.fulfill({ json: { library: {
    picks: Array.from({ length: 500 }, (_, index) => ({ id: `pick-${index}`, savedAt: 1, track: {
      provider: 'spotify', providerId: `pick-${index}`, title: `Library pick ${index}`, artworkUrl: `/tests/qol-harness/art/pick-${index}.svg`
    } })), sets: []
  } } }))
  await page.goto(`/tests/qol-harness/music.html?scenario=library-artwork-preload${hidden ? '&hideMusic=1' : ''}`)
  await expect(page.locator('.music-history-row')).toHaveCount(100)
  return requests
}

test('hidden history and library issue no artwork requests; active scroll panes load only visible rows', async ({ page }, testInfo) => {
  // This workflow mounts 500 private picks and traverses three scroll panes.
  // Keep artwork request bounds exact while allowing shared CI setup/render work.
  test.setTimeout(120_000)
  const requests = await preloadFixture(page)
  await expect(page.locator('.queue-track .track-artwork').first()).toHaveAttribute('data-artwork-state', 'ready')
  await page.waitForTimeout(250)
  expect(requests.queue.length).toBeGreaterThan(0)
  expect(requests.queue.length).toBeLessThan(40)
  expect(requests.history.length).toBe(0)
  expect(requests.pick.length).toBe(0)
  const initialQueueCount = requests.queue.length
  await expect(page.locator('.queue-track .track-artwork').last()).toHaveAttribute('data-artwork-state', 'deferred')

  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.locator('.music-history-row .track-artwork').first()).toHaveAttribute('data-artwork-state', 'ready')
  await page.getByRole('textbox', { name: 'Filter recently played tracks' }).fill('history')
  await page.waitForTimeout(250)
  const initialHistoryCount = requests.history.length
  expect(initialHistoryCount).toBeGreaterThan(0)
  expect(initialHistoryCount).toBeLessThan(40)
  expect(requests.pick.length).toBe(0)
  await expect(page.locator('.music-history-row .track-artwork').last()).toHaveAttribute('data-artwork-state', 'deferred')
  await page.locator('.music-history-pane').evaluate((pane) => { pane.scrollTop = pane.scrollHeight })
  await expect(page.locator('.music-history-row .track-artwork').last()).toHaveAttribute('data-artwork-state', 'ready')
  expect(requests.history.length).toBeGreaterThan(initialHistoryCount)
  expect(requests.history.length).toBeLessThan(100)
  expect(requests.queue.length).toBe(initialQueueCount)

  await page.getByRole('tab', { name: 'My picks', exact: true }).click()
  await expect(page.locator('.music-library-row')).toHaveCount(500)
  await expect(page.locator('.music-library-row .track-artwork').first()).toHaveAttribute('data-artwork-state', 'ready')
  await page.getByRole('textbox', { name: 'Filter private picks and sets' }).fill('Library')
  await page.waitForTimeout(250)
  const initialPickCount = requests.pick.length
  expect(initialPickCount).toBeGreaterThan(0)
  expect(initialPickCount).toBeLessThan(40)
  await expect(page.locator('.music-library-row .track-artwork').last()).toHaveAttribute('data-artwork-state', 'deferred')
  await page.locator('.music-library-row').last().scrollIntoViewIfNeeded()
  await expect(page.locator('.music-library-row .track-artwork').last()).toHaveAttribute('data-artwork-state', 'ready')
  expect(requests.pick.length).toBeGreaterThan(initialPickCount)
  expect(requests.pick.length).toBeLessThan(500)

  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Filter recently played tracks' })).toHaveValue('history')
  await page.getByRole('tab', { name: 'My picks', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Filter private picks and sets' })).toHaveValue('Library')
  const evidence = testInfo.outputPath('artwork-request-counts.json')
  await writeFile(evidence, JSON.stringify({
    initial: { queue: initialQueueCount, history: initialHistoryCount, picks: initialPickCount },
    afterScroll: { queue: requests.queue.length, history: requests.history.length, picks: requests.pick.length }
  }, null, 2))
  await testInfo.attach('real-artwork-request-counts', { contentType: 'application/json', path: evidence })
})

test('a display-none music pane stays idle until it becomes visible', async ({ page }) => {
  const requests = await preloadFixture(page, true)
  await page.waitForTimeout(300)
  expect(requests.queue.length + requests.history.length + requests.pick.length).toBe(0)
  await page.locator('.music-qol-harness').evaluate((pane) => { (pane as HTMLElement).style.removeProperty('display') })
  await expect(page.locator('.queue-track .track-artwork').first()).toHaveAttribute('data-artwork-state', 'ready')
  expect(requests.queue.length).toBeGreaterThan(0)
  expect(requests.queue.length).toBeLessThan(40)
  expect(requests.history.length).toBe(0)
  expect(requests.pick.length).toBe(0)
})
