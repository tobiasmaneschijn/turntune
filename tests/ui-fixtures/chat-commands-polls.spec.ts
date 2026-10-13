import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ChatMessage, ChatPollVoteEvent } from '../../src/chat/model'
import type { ChatHistoryRow } from '../../src/chat/persistence'

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

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title === 'an old poll acknowledgement does not close or overwrite a newly opened poll draft in the same room') {
    await page.clock.install({ time: new Date('2026-10-13T00:00:00Z') })
  }
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

test('slash commands support keyboard and pointer selection and never become room messages', async ({ page }, testInfo) => {
  const commands = page.getByRole('listbox', { name: 'Chat commands' })
  await composer(page).fill('/')
  await expect(commands.getByRole('option')).toHaveCount(4)
  await page.screenshot({ path: testInfo.outputPath('chat-command-suggestions.png') })
  await composer(page).press('ArrowDown')
  await expect(commands.getByRole('option', { name: '/mute Mute room notifications', exact: true })).toHaveAttribute('aria-selected', 'true')
  await composer(page).press('Enter')
  await expect(page.getByRole('button', { name: 'Room muted', exact: true })).toBeVisible()
  await expect(composer(page)).toHaveValue('')
  await composer(page).fill('/mu')
  await commands.getByRole('option', { name: '/mute Unmute room notifications', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mute room', exact: true })).toBeVisible()
  await composer(page).fill('/que')
  await commands.getByRole('option', { name: '/queue Open queue', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Queue destination' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click()
  await expect(composer(page)).toHaveValue('')
  await runCommand(page, '/search')
  await expect(page.getByRole('textbox', { name: 'Search all saved room messages' })).toBeFocused()
  await page.getByRole('button', { name: 'Close room message search' }).click()
  await composer(page).fill('/search needle')
  await page.getByRole('button', { name: 'Run chat command', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Search all saved room messages' })).toHaveValue('needle')
  await expect(page.getByRole('button', { name: 'View message from Mira: needle track notes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close room message search' }).click()
  await runCommand(page, '/unsupported')
  await expect(page.getByRole('alert').filter({ hasText: 'Unknown command.' })).toBeVisible()
  await expect(composer(page)).toHaveValue('/unsupported')
  const sent = await page.evaluate(() => {
    const harness = (window as unknown as HarnessWindow).chatCommandsTest
    return { broadcasts: harness.broadcasts, saves: harness.saves }
  })
  expect(sent).toEqual({ broadcasts: [], saves: [] })
  expect(databases.get(page)!.messages).toEqual([])
  expect(databases.get(page)!.searches).toEqual(['needle'])
})

test('poll command prefills the question, validates options and saves a four-option poll across reload', async ({ page }, testInfo) => {
  await page.locator(`#chat-message-${noteId}`).getByRole('button', { name: 'Message actions for Mira' }).click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  await runCommand(page, '/poll Next set?')
  const form = page.getByRole('region', { name: 'New poll' })
  await expect(form.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Next set?')
  await expect(form.getByRole('textbox', { name: 'Question', exact: true })).toBeFocused()
  await composer(page).fill('Keep this ordinary reply draft')
  await form.getByRole('textbox', { name: 'Option 1', exact: true }).fill('House')
  await form.getByRole('textbox', { name: 'Option 2', exact: true }).fill('house')
  await form.getByRole('button', { name: 'Post poll', exact: true }).click()
  await expect(form.getByRole('alert')).toHaveText('Use different options.')
  await expect(form.getByRole('textbox', { name: 'Option 2', exact: true })).toBeFocused()
  expect(databases.get(page)!.messages).toHaveLength(0)
  await form.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Ambient')
  await form.getByRole('button', { name: 'Add option', exact: true }).click()
  await form.getByRole('textbox', { name: 'Option 3', exact: true }).fill('Disco')
  await form.getByRole('button', { name: 'Add option', exact: true }).click()
  await form.getByRole('textbox', { name: 'Option 4', exact: true }).fill('Garage')
  await expect(form.getByRole('button', { name: 'Add option', exact: true })).toHaveCount(0)
  await form.getByRole('button', { name: 'Post poll', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('poll-composer.png') })
  await form.getByRole('button', { name: 'Post poll', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(composer(page)).toHaveValue('Keep this ordinary reply draft')
  await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toBeVisible()
  await expect.poll(() => databases.get(page)!.messages.length).toBe(1)
  const saved = databases.get(page)!.messages[0]
  expect(saved).toMatchObject({ content: 'Next set?', type: 'text', user: { id: 'alice' }, poll: { options: ['House', 'Ambient', 'Disco', 'Garage'], votes: [] } })
  await expect(pollRow(page, saved.id).getByRole('group', { name: 'Poll options' }).getByRole('button')).toHaveCount(4)
  await page.reload()
  await expect(pollRow(page, saved.id).getByRole('group', { name: 'Poll options' }).getByRole('button')).toHaveCount(4)
  await expect(pollRow(page, saved.id).locator('.chat-message-body')).toContainText('Next set?')
})

test('single account votes can change, peer updates stay current and votes persist after reload', async ({ page }, testInfo) => {
  const row = pollRow(page)
  await expect(row.locator('.chat-poll-total')).toHaveText('1 vote')
  await voteOption(row, 'Ambient').click()
  await expect(voteOption(row, 'Ambient')).toHaveAttribute('aria-pressed', 'true')
  await expect(row.locator('.chat-poll-total')).toHaveText('2 votes')
  await peerVote(page, { messageId: pollId, userId: 'mira', optionIndex: 1, revision: 2 })
  await expect(voteOption(row, 'Ambient')).toHaveAccessibleName('Ambient, 2 votes, your vote')
  await expect(row.locator('.chat-poll-total')).toHaveText('3 votes')
  await peerVote(page, { messageId: pollId, userId: 'mira', optionIndex: 0, revision: 1 })
  await peerVote(page, { messageId: pollId, userId: 'mira', optionIndex: 0, revision: 3 }, 'other-room')
  await expect(voteOption(row, 'Ambient')).toHaveAccessibleName('Ambient, 2 votes, your vote')
  await voteOption(row, 'Disco').click()
  await expect(voteOption(row, 'Ambient')).toHaveAttribute('aria-pressed', 'false')
  await expect(voteOption(row, 'Disco')).toHaveAccessibleName('Disco, 1 vote, your vote')
  await expect(row.locator('.chat-poll-total')).toHaveText('3 votes')
  await page.screenshot({ path: testInfo.outputPath('poll-votes.png') })
  await page.reload()
  await expect(voteOption(row, 'Disco')).toHaveAttribute('aria-pressed', 'true')
  await expect(row.locator('.chat-poll-total')).toHaveText('3 votes')
  databases.get(page)!.failVote = true
  await voteOption(row, 'House').click()
  await expect(row.getByRole('alert')).toHaveText('Join this room before voting.')
  await expect(voteOption(row, 'Disco')).toHaveAttribute('aria-pressed', 'true')
  await expect(voteOption(row, 'House')).toHaveAttribute('aria-pressed', 'false')
  databases.get(page)!.failVote = false
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(voteOption(row, 'House')).toHaveAttribute('aria-pressed', 'true')
  await expect(voteOption(row, 'Disco')).toHaveAttribute('aria-pressed', 'false')
  expect(databases.get(page)!.votes).toEqual([{ messageId: pollId, userId: 'alice', optionIndex: 1 }, { messageId: pollId, userId: 'alice', optionIndex: 2 }])
})

test('failed poll delivery closes the owned form and retry saves the original poll once', async ({ page }) => {
  await runCommand(page, '/poll Retry this poll?')
  const form = page.getByRole('region', { name: 'New poll' })
  await form.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Now')
  await form.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Later')
  await page.evaluate(() => { (window as unknown as HarnessWindow).chatCommandsTest.failSend = true })
  await form.getByRole('button', { name: 'Post poll', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toBeVisible()
  await expect(form).toHaveCount(0)
  await expect(composer(page)).toBeFocused()
  await expect(page.locator('.chat-message-item').filter({ hasText: 'Retry this poll?' })).toHaveCount(1)
  expect(databases.get(page)!.messages).toHaveLength(0)
  await page.evaluate(() => { (window as unknown as HarnessWindow).chatCommandsTest.failSend = false })
  await page.getByRole('button', { name: 'Retry send', exact: true }).click()
  await expect.poll(() => databases.get(page)!.messages.length).toBe(1)
  const broadcasts = await page.evaluate(() => (window as unknown as HarnessWindow).chatCommandsTest.broadcasts.map((message) => message.id))
  expect(broadcasts).toEqual([databases.get(page)!.messages[0].id, databases.get(page)!.messages[0].id])
  expect(databases.get(page)!.messages[0]).toMatchObject({ content: 'Retry this poll?', poll: { options: ['Now', 'Later'], votes: [] } })
})

test('an old poll acknowledgement does not close or overwrite a newly opened poll draft in the same room', async ({ page }) => {
  await runCommand(page, '/poll Older poll?')
  const form = page.getByRole('region', { name: 'New poll' })
  await form.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Now')
  await form.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Later')
  await page.clock.pauseAt(new Date('2026-10-13T00:01:00Z'))
  await page.evaluate(() => { (window as unknown as HarnessWindow).chatCommandsTest.holdDelivery = true })
  await form.getByRole('button', { name: 'Post poll', exact: true }).click()
  await expect(form.getByRole('button', { name: 'Posting…', exact: true })).toBeDisabled()
  await form.getByRole('button', { name: 'Close poll', exact: true }).click()
  await expect(form).toHaveCount(0)
  await runCommand(page, '/poll Fresh poll?')
  await expect(form.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Fresh poll?')
  await page.evaluate(() => { (window as unknown as HarnessWindow).chatCommandsTest.releaseDelivery() })
  await expect.poll(() => databases.get(page)!.messages.length).toBe(1)
  await expect(form.getByRole('button', { name: 'Post poll', exact: true })).toBeEnabled()
  await expect(form.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Fresh poll?')
  await expect(form.getByRole('textbox', { name: 'Option 1', exact: true })).toHaveValue('')
  await expect(form.getByRole('textbox', { name: 'Option 2', exact: true })).toHaveValue('')
  await form.getByRole('textbox', { name: 'Option 1', exact: true }).fill('A fresh option')
  await expect(form).toBeVisible()
  await expect(form.getByRole('textbox', { name: 'Option 1', exact: true })).toHaveValue('A fresh option')
  expect(databases.get(page)!.messages[0]).toMatchObject({ content: 'Older poll?', poll: { options: ['Now', 'Later'] } })
  await page.clock.resume()
})
