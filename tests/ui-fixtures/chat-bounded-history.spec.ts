import { expect, test } from '@playwright/test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatCommandService } from '../../server/chat-command-service'
import { mountDurableChatRoutes } from '../../server/chat-command-routes'

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

for (const crowded of [false, true]) {
  test(`actual bounded history route preserves older-page access after a ${crowded ? '10-row child-budget' : '50-row message-budget'} first page`, async ({ page }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'soundspin-browser-history-'))
    let server: Server | undefined
    try {
      const messages = Object.fromEntries(Array.from({ length: 80 }, (_, index) => {
        const message = { id: id(index + 1), content: `Bounded message ${index + 1}`, type: 'text', createdAt: new Date(Date.UTC(2026, 9, 6, 10, 0, index)).toISOString(),
          user: { id: 'mira', name: 'Mira', avatarSeed: 'mira' }, mentions: [], ...(crowded ? {
            reactions: Array.from({ length: 300 }, (_, peer) => ({ userId: `peer-${peer}`, emoji: '👍' })),
            poll: { options: ['One', 'Two'], votes: Array.from({ length: 300 }, (_, peer) => ({ userId: `peer-${peer}`, optionIndex: 0, revision: 1 })) },
          } : {}) }
        return [message.id, { roomId: 'lounge', userId: 'mira', fingerprint: 'a'.repeat(64), message }]
      }))
      await writeFile(path.join(directory, 'soundspin-chat.json'), JSON.stringify({ messages, receipts: {}, cooldowns: {}, removals: [], tombstones: {}, mentionBudgets: {} }))
      const commands = new ChatCommandService({ client: null, dataDir: directory, getUser: async () => null, authorize: async () => {}, emit: async () => {} })
      const application = express()
      mountDurableChatRoutes(application, { client: null, getUserId: async request => request.headers.authorization === 'Bearer alice-token' ? 'alice' : null, canReadRoom: async () => true }, commands)
      server = await new Promise<Server>(resolve => { const listening = application.listen(0, '127.0.0.1', () => resolve(listening)) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Local fixture address is unavailable.')
      const origin = `http://127.0.0.1:${address.port}`
      const pages: Array<{ rows: unknown[]; hasMore: boolean }> = []
      await page.route('**/api/config', route => route.fulfill({ json: { giphyConfigured: false } }))
      await page.route('**/api/rooms/*/chat/**', async route => {
        const url = new URL(route.request().url())
        const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}` })
        const body = await response.json()
        if (url.pathname.endsWith('/history')) pages.push(body)
        await route.fulfill({ response })
      })
      await page.goto('/tests/chat-history-harness/index.html')
      const limit = crowded ? 10 : 50
      await expect(page.locator('.chat-message-item')).toHaveCount(limit, { timeout: 15_000 })
      expect(pages[0].rows).toHaveLength(limit)
      expect(pages[0].hasMore).toBe(true)
      await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toBeEnabled()
      await page.locator('.chat-message-scroll').evaluate(async element => {
        element.scrollTop = 0
        element.dispatchEvent(new Event('scroll'))
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })
      const anchor = page.locator(`#chat-message-${id(81 - limit)}`)
      const before = (await anchor.boundingBox())!.y
      await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
      await expect(page.locator('.chat-message-item')).toHaveCount(crowded ? 20 : 80)
      await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0)
      const visibleIds = await page.locator('.chat-message-item').evaluateAll(rows => rows.map(row => row.id))
      expect(new Set(visibleIds).size).toBe(visibleIds.length)
      expect(pages[1].hasMore).toBe(crowded)
      if (!crowded) await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toHaveCount(0)
    } finally {
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })
}
