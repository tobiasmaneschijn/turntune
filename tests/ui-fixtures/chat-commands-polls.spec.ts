import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ChatMessage, ChatPollVoteEvent } from '../../src/features/chat/model'
import type { ChatHistoryRow } from '../../src/features/chat/persistence'

const pollId = '20000000-0000-4000-8000-000000000002'
const noteId = '20000000-0000-4000-8000-000000000001'
type Row = ChatHistoryRow & { room_slug: string }
type Database = { rows: Row[]; messages: ChatMessage[]; votes: Array<{ messageId: string; userId: string; optionIndex: number }>; searches: string[]; failVote: boolean }
type HarnessWindow = { chatCommandsTest: { broadcasts: ChatMessage[]; saves: ChatMessage[]; failSend: boolean; holdDelivery: boolean; releaseDelivery(): void; peerVote(event: ChatPollVoteEvent, roomId?: string): void } }
const databases = new WeakMap<Page, Database>()
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message room chat' })
const pollRow = (page: Page, id = pollId) => page.locator(`#chat-message-${id}`)
const voteOption = (row: Locator, option: string) => row.getByRole('button', { name: new RegExp(`^${option}, \\d+ votes?`) })

async function runCommand(page: Page, command: string) {
  await composer(page).fill(command)
  await composer(page).press('Enter')
}

async function peerVote(page: Page, event: ChatPollVoteEvent, roomId = 'lounge') {
  const row = databases.get(page)!.rows.find((row) => row.id === event.messageId)!
  const existing = row.soundspin_poll_votes?.find((vote) => vote.user_id === event.userId)
  if (roomId === row.room_slug && (!existing || existing.revision < event.revision)) {
    row.soundspin_poll_votes = [...(row.soundspin_poll_votes || []).filter((vote) => vote.user_id !== event.userId),
      { user_id: event.userId, option_index: event.optionIndex, revision: event.revision }]
  }
  await page.evaluate(({ event, roomId }) => (window as unknown as HarnessWindow).chatCommandsTest.peerVote(event, roomId), { event, roomId })
}

test.beforeEach(async ({ page }) => {
  const base: Row = { id: noteId, room_slug: 'lounge', content: 'needle track notes', message_type: 'text',
    media_url: null, storage_path: null, mentions: [], user_id: 'mira', user_name: 'Mira', avatar_seed: 'mira',
    created_at: '2026-10-08T10:00:00Z', reply_to_id: null, soundspin_message_reactions: [] }
  const database: Database = { rows: [base, { ...base, id: pollId, content: 'Next room vibe?', created_at: '2026-10-08T10:01:00Z',
    poll_options: ['House', 'Ambient', 'Disco'], soundspin_poll_votes: [{ user_id: 'bob', option_index: 0, revision: 1 }] }],
    messages: [], votes: [], searches: [], failVote: false }
  databases.set(page, database)
  await page.route('**/api/config', (route) => route.fulfill({ json: { giphyConfigured: false } }))
  await page.route('**/api/rooms/*/chat/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const parts = url.pathname.split('/')
    const room = parts[3]
    const action = parts[5]
    const authorization = request.headers().authorization
    if (!authorization?.startsWith('Bearer ')) return route.fulfill({ status: 401, json: { error: 'Sign in required.' } })
    const userId = authorization.slice('Bearer '.length).replace(/-token$/, '')
    const scope = database.rows.filter((row) => row.room_slug === room)
    const payload = (selected: Row[]) => ({ rows: selected, replies: scope, profiles: [] })
    if (request.method() === 'POST' && action === 'messages') {
      const message = request.postDataJSON() as ChatMessage
      database.messages.push(message)
      database.rows.push({ id: message.id, room_slug: room, content: message.content, message_type: message.type,
        media_url: message.mediaUrl || null, storage_path: message.storagePath || null, mentions: message.mentions || [],
        user_id: userId, user_name: message.user.name, avatar_seed: message.user.avatarSeed || userId,
        created_at: message.createdAt, reply_to_id: message.replyTo?.id || null, soundspin_message_reactions: [],
        poll_options: message.poll?.options || null, soundspin_poll_votes: [] })
      return route.fulfill({ json: {} })
    }
    if (request.method() === 'POST' && action === 'polls' && parts[7] === 'vote') {
      if (database.failVote) return route.fulfill({ status: 403, json: { error: 'Join this room before voting.' } })
      const row = scope.find((row) => row.id === parts[6])!
      const { optionIndex } = request.postDataJSON() as { optionIndex: number }
      const old = row.soundspin_poll_votes?.find((vote) => vote.user_id === userId)
      const event: ChatPollVoteEvent = { messageId: row.id, userId, optionIndex, revision: (old?.revision || 0) + 1 }
      row.soundspin_poll_votes = [...(row.soundspin_poll_votes || []).filter((vote) => vote.user_id !== userId),
        { user_id: userId, option_index: optionIndex, revision: event.revision }]
      database.votes.push({ messageId: row.id, userId, optionIndex })
      return route.fulfill({ json: event })
    }
    if (action === 'messages') return route.fulfill({ json: payload(scope.filter((row) => row.id === parts[6])) })
    if (action === 'context') return route.fulfill({ json: { ...payload(scope),
      olderCursor: { createdAt: scope[0].created_at, id: scope[0].id }, newerCursor: { createdAt: scope.at(-1)!.created_at, id: scope.at(-1)!.id }, hasOlder: false, hasNewer: false } })
    const query = url.searchParams.get('q')
    if (action === 'search') database.searches.push(query || '')
    return route.fulfill({ json: { ...payload(query ? scope.filter((row) => row.content.toLowerCase().includes(query.toLowerCase())) : scope), hasMore: false } })
  })
  await page.goto('/tests/chat-commands-harness/index.html')
  await expect(composer(page)).toBeEnabled()
  await expect(page.locator('.chat-message-item')).toHaveCount(2)
})

test('Use chat commands to open the queue and find room messages', async ({ page }) => {
  await composer(page).fill('/que')
  await page.getByRole('listbox', { name: 'Chat commands' }).getByRole('option', { name: '/queue Open queue', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Queue destination' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
  await runCommand(page, '/search needle')
  await expect(page.getByRole('button', { name: 'View message from Mira: needle track notes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close room message search' }).click()
  await runCommand(page, '/unsupported')
  await expect(page.getByRole('alert').filter({ hasText: 'Unknown command.' })).toBeVisible()
  await expect(composer(page)).toHaveValue('/unsupported')
  expect(databases.get(page)!.messages).toEqual([])
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).chatCommandsTest.broadcasts)).toEqual([])
})

test('Create a poll, change a vote and keep the result after returning', async ({ page }) => {
  await runCommand(page, '/poll Next set?')
  const form = page.getByRole('region', { name: 'New poll' })
  await expect(form.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Next set?')
  await form.getByRole('textbox', { name: 'Option 1', exact: true }).fill('House')
  await form.getByRole('textbox', { name: 'Option 2', exact: true }).fill('house')
  await form.getByRole('button', { name: 'Post poll', exact: true }).click()
  await expect(form.getByRole('alert')).toHaveText('Use different options.')
  await form.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Ambient')
  await form.getByRole('button', { name: 'Post poll', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect.poll(() => databases.get(page)!.messages.length).toBe(1)
  const saved = databases.get(page)!.messages[0]
  const row = pollRow(page, saved.id)
  await voteOption(row, 'House').click()
  await expect(voteOption(row, 'House')).toHaveAttribute('aria-pressed', 'true')
  await voteOption(row, 'Ambient').click()
  await expect(voteOption(row, 'House')).toHaveAttribute('aria-pressed', 'false')
  await expect(voteOption(row, 'Ambient')).toHaveAttribute('aria-pressed', 'true')
  await expect(row.locator('.chat-poll-total')).toHaveText('1 vote')
  await peerVote(page, { messageId: saved.id, userId: 'bob', optionIndex: 0, revision: 1 })
  await expect(row.locator('.chat-poll-total')).toHaveText('2 votes')
  await page.reload()
  await expect(voteOption(row, 'Ambient')).toHaveAttribute('aria-pressed', 'true')
  await expect(row.locator('.chat-poll-total')).toHaveText('2 votes')
  databases.get(page)!.failVote = true
  await voteOption(row, 'House').click()
  await expect(row.getByRole('alert')).toHaveText('Join this room before voting.')
  await expect(voteOption(row, 'Ambient')).toHaveAttribute('aria-pressed', 'true')
})
