import { expect, test, type Page } from '@playwright/test'
import type { ChatMessage } from '../../../src/features/chat/model'
import type { ChatHistoryRow } from '../../../src/features/chat/persistence'
import type { ChatPin } from '../../../shared/chat-pins'

const noteId = '30000000-0000-4000-8000-000000000001'
const musicId = '30000000-0000-4000-8000-000000000002'
const fallbackId = '30000000-0000-4000-8000-000000000003'
const note = 'Keep this recommendation for the next set'
const musicUrl = 'https://www.youtube.com/watch?v=dX3k_QDnzHE'
const fallbackUrl = 'https://example.org/unavailable'
type Row = ChatHistoryRow & { room_slug: string }
interface Database {
  rows: Row[]
  pins: Map<string, ChatPin[]>
  pinWrites: Array<{ room: string; userId: string; messageId: string; pinned: boolean }>
  failUnpin: boolean
}
interface HarnessWindow {
  chatCommandsTest: {
    acceptedMessages: Record<string, ChatMessage>
    addedMusicLinks: string[]
    savedMusicLinks: string[]
    currentSong: NonNullable<ChatMessage['song']>
    seekChanges: unknown[]
    remove: (messageId: string) => void
  }
}
const databases = new WeakMap<Page, Database>()
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message room chat', exact: true })
const messageRow = (page: Page, id: string) => page.locator(`#chat-message-${id}`)
const pinPanel = (page: Page) => page.getByRole('region', { name: 'Pinned messages', exact: true })

test.beforeEach(async ({ page }) => {
  const base: Row = { id: noteId, room_slug: 'lounge', content: note, message_type: 'text',
    media_url: null, storage_path: null, mentions: [], user_id: 'mira', user_name: 'Mira', avatar_seed: 'mira',
    created_at: '2026-10-08T10:00:00Z', reply_to_id: null, soundspin_message_reactions: [] }
  const database: Database = {
    rows: [base, { ...base, id: musicId, content: `Try this one ${musicUrl}`, created_at: '2026-10-08T10:01:00Z' },
      { ...base, id: fallbackId, content: fallbackUrl, created_at: '2026-10-08T10:02:00Z' }],
    pins: new Map(), pinWrites: [], failUnpin: false,
  }
  databases.set(page, database)
  await page.route('**/api/config', route => route.fulfill({ json: { giphyConfigured: false } }))
  await page.route('**/api/rooms/*/chat/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const [, , , room, , action, messageId] = url.pathname.split('/')
    const token = request.headers().authorization
    if (token !== 'Bearer alice-token' && token !== 'Bearer bob-token')
      return route.fulfill({ status: 401, json: { error: 'Sign in required.' } })
    const userId = token === 'Bearer alice-token' ? 'alice' : 'bob'
    const scope = database.rows.filter(row => row.room_slug === room)
    const payload = (rows: Row[]) => ({ rows, replies: [], profiles: [] })
    if (action === 'pins') {
      if (request.method() === 'POST') {
        if (userId !== 'alice') return route.fulfill({ status: 403, json: { error: 'Only moderators can pin messages.' } })
        const { pinned } = request.postDataJSON() as { pinned: boolean }
        database.pinWrites.push({ room, userId, messageId, pinned })
        if (!pinned && database.failUnpin) return route.fulfill({ status: 503, json: { error: 'Could not unpin. Try again.' } })
        if (!scope.some(row => row.id === messageId)) return route.fulfill({ status: 404, json: { error: 'Message unavailable.' } })
        const pins = (database.pins.get(room) || []).filter(pin => pin.messageId !== messageId)
        if (pinned) pins.push({ messageId, pinnedBy: userId, pinnedAt: new Date().toISOString() })
        database.pins.set(room, pins)
        return route.fulfill({ json: { messageId, pinned } })
      }
      const pins = database.pins.get(room) || []
      return route.fulfill({ json: { pins, ...payload(scope.filter(row => pins.some(pin => pin.messageId === row.id))) } })
    }
    if (action === 'link-preview') return route.fulfill({ json: { preview: url.searchParams.get('url') === musicUrl
      ? { url: musicUrl, siteName: 'YouTube', title: 'Midnight City', description: 'M83', musicProvider: 'youtube' }
      : null } })
    if (request.method() === 'POST' && action === 'messages') {
      const input = request.postDataJSON() as ChatMessage
      const message = await page.evaluate(message => (window as unknown as HarnessWindow).chatCommandsTest.acceptedMessages[message.id] || message, input)
      if (!database.rows.some(row => row.id === message.id)) database.rows.push({
        id: message.id, room_slug: room, content: message.content, message_type: message.type,
        media_url: message.mediaUrl || null, storage_path: message.storagePath || null, mentions: message.mentions || [],
        user_id: userId, user_name: message.user.name, avatar_seed: message.user.avatarSeed || userId,
        created_at: message.createdAt, reply_to_id: message.replyTo?.id || null,
        soundspin_message_reactions: [], song: message.song || null, game: message.game || null,
      })
      return route.fulfill({ json: { ok: true, message } })
    }
    if (action === 'context') return route.fulfill({ json: { ...payload(scope),
      olderCursor: scope[0] && { createdAt: scope[0].created_at, id: scope[0].id },
      newerCursor: scope.at(-1) && { createdAt: scope.at(-1)!.created_at, id: scope.at(-1)!.id },
      hasOlder: false, hasNewer: false } })
    if (action === 'messages') return route.fulfill({ json: payload(scope.filter(row => row.id === messageId)) })
    return route.fulfill({ json: { ...payload(scope), hasMore: false } })
  })
  await page.goto('/tests/browser/chat/harnesses/commands/index.html')
  await expect(composer(page)).toBeEnabled()
  await expect(messageRow(page, noteId)).toBeVisible()
})

test('Keep room pins across visits, respect private message hiding, and recover a failed unpin', async ({ page }) => {
  const database = databases.get(page)!
  const noteRow = messageRow(page, noteId)
  await noteRow.hover()
  await noteRow.getByRole('button', { name: 'Message actions for Mira', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin message', exact: true }).click()
  await expect.poll(() => database.pins.get('lounge')?.length).toBe(1)
  await page.getByRole('button', { name: 'Pinned messages', exact: true }).click()
  const jump = pinPanel(page).getByRole('button', { name: `View message from Mira: ${note}`, exact: true })
  await expect(jump).toBeVisible()
  await jump.click()
  await expect(pinPanel(page)).toHaveCount(0)
  await expect(noteRow).toBeFocused()
  await noteRow.hover()
  await noteRow.getByRole('button', { name: 'Message actions for Mira', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Hide message', exact: true }).click()
  await page.getByRole('button', { name: 'Pinned messages', exact: true }).click()
  await expect(pinPanel(page).getByRole('button', { name: 'View message from Mira: Hidden', exact: true })).toBeVisible()
  await expect(pinPanel(page).getByText(note, { exact: true })).toHaveCount(0)

  await page.reload()
  await page.getByRole('button', { name: 'Pinned messages', exact: true }).click()
  await expect(pinPanel(page).getByRole('button', { name: 'View message from Mira: Hidden', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.getByRole('button', { name: 'Pinned messages', exact: true }).click()
  await expect(pinPanel(page).getByRole('button', { name: `View message from Mira: ${note}`, exact: true })).toBeVisible()
  await expect(pinPanel(page).getByRole('button', { name: 'Unpin message', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close pinned messages', exact: true }).click()
  await noteRow.hover()
  await noteRow.getByRole('button', { name: 'Message actions for Mira', exact: true }).click()
  await expect(page.getByRole('menu', { name: 'Message actions for Mira', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Unpin message', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Message actions for Mira', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await page.getByRole('button', { name: 'Pinned messages', exact: true }).click()
  await expect(pinPanel(page).getByText('No pinned messages.', { exact: true })).toBeVisible()
  await expect(pinPanel(page).getByText(note, { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Switch room', exact: true }).click()
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.getByRole('button', { name: 'Pinned messages', exact: true }).click()
  database.failUnpin = true
  await pinPanel(page).getByRole('button', { name: 'Unpin message', exact: true }).click()
  await expect(pinPanel(page).getByRole('alert')).toContainText('Could not unpin. Try again.')
  await expect(pinPanel(page).getByRole('button', { name: 'View message from Mira: Hidden', exact: true })).toBeVisible()
  database.failUnpin = false
  await pinPanel(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(pinPanel(page).getByText('No pinned messages.', { exact: true })).toBeVisible()
  expect(database.pinWrites.map(write => write.pinned)).toEqual([true, false, false])
})

test('Save a shared track, draft a song comment by dropping, and open its visible timeline marker', async ({ page }) => {
  await page.goto('/tests/browser/chat/harnesses/commands/index.html?song-moments')
  const preview = messageRow(page, musicId).getByRole('article', { name: 'Link preview', exact: true })
  await expect(preview.getByText('Midnight City', { exact: true })).toBeVisible()
  await composer(page).fill('Keep this draft')
  await preview.getByRole('button', { name: 'Add to queue', exact: true }).dblclick()
  await expect(preview.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await preview.getByRole('button', { name: 'Save', exact: true }).dblclick()
  await expect(preview.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => ({ added: (window as unknown as HarnessWindow).chatCommandsTest.addedMusicLinks,
    saved: (window as unknown as HarnessWindow).chatCommandsTest.savedMusicLinks }))).toEqual({ added: [musicUrl], saved: [musicUrl] })
  await expect(composer(page)).toHaveValue('Keep this draft')
  const fallback = messageRow(page, fallbackId)
  await expect(fallback.getByRole('link', { name: fallbackUrl, exact: true })).toHaveAttribute('href', fallbackUrl)
  await expect(fallback.getByRole('article', { name: 'Link preview', exact: true })).toHaveCount(0)

  await messageRow(page, noteId).hover()
  await messageRow(page, noteId).getByRole('button', { name: 'Message actions for Mira', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  const drop = async (roomId: string, privateQueue = false) => {
    const data = await page.evaluateHandle(({ roomId, privateQueue, url }) => {
      const transfer = new DataTransfer()
      transfer.setData(privateQueue ? 'application/x-turntune-private-queue' : 'application/x-turntune-song',
        privateQueue ? 'private-track-id' : JSON.stringify({ roomId, song: (window as unknown as HarnessWindow).chatCommandsTest.currentSong }))
      transfer.setData('text/plain', privateQueue ? 'private-track-id' : url)
      return transfer
    }, { roomId, privateQueue, url: musicUrl })
    await composer(page).dispatchEvent('drop', { dataTransfer: data })
    await data.dispose()
  }
  await drop('other-room')
  await drop('lounge', true)
  await expect(page.locator('form').getByRole('group', { name: 'Attached song', exact: true })).toHaveCount(0)
  await expect(composer(page)).toHaveValue('Keep this draft')
  await drop('lounge')
  await expect(page.getByRole('group', { name: 'Attached song', exact: true })).toContainText('Midnight City')
  await expect(page.getByRole('group', { name: 'Attached song', exact: true })).toContainText('1:14')
  await expect(composer(page)).toHaveValue('Keep this draft')
  await expect(page.locator('form')).toContainText(note)
  expect(databases.get(page)!.rows).toHaveLength(3)
  await composer(page).fill('That transition is so good')
  await composer(page).press('Enter')
  const sent = page.locator('.chat-message-item').filter({ hasText: 'That transition is so good' })
  await expect(sent.getByRole('group', { name: 'Attached song', exact: true })).toContainText('Midnight City')
  await expect.poll(() => databases.get(page)!.rows.some(row => row.content === 'That transition is so good' && Boolean(row.song))).toBe(true)
  await expect(composer(page)).toHaveValue('')
  await page.getByRole('button', { name: 'Add to message', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Attach current song', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect.poll(() => databases.get(page)!.rows.some(row => row.content === '' && Boolean(row.song))).toBe(true)
  const attachmentId = databases.get(page)!.rows.find(row => row.content === '' && Boolean(row.song))!.id
  await page.reload()
  await expect(sent.getByRole('group', { name: 'Attached song', exact: true })).toContainText('Midnight City')
  await expect(sent.getByRole('group', { name: 'Attached song', exact: true })).toContainText('1:14')
  await expect(messageRow(page, attachmentId).getByRole('group', { name: 'Attached song', exact: true })).toContainText('Midnight City')
  const marker = page.getByRole('button', { name: 'Alice, 1:14: That transition is so good', exact: true })
  await marker.focus()
  await expect(page.getByRole('tooltip')).toContainText('That transition is so good')
  await marker.click()
  await expect(sent).toBeFocused()
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).chatCommandsTest.seekChanges)).toEqual([])
  await sent.hover()
  await sent.getByRole('button', { name: 'Actions for your message', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Hide message', exact: true }).click()
  await expect(marker).toHaveCount(0)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(marker).toBeVisible()
  const commentId = databases.get(page)!.rows.find(row => row.content === 'That transition is so good')!.id
  await page.evaluate(id => (window as unknown as HarnessWindow).chatCommandsTest.remove(id), commentId)
  await expect(marker).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(composer(page)).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await preview.getByRole('button', { name: 'Add to queue', exact: true }).scrollIntoViewIfNeeded()
  await expect(preview.getByRole('button', { name: 'Add to queue', exact: true })).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
})
