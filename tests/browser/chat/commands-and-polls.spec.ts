import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ChatMessage, ChatPollVoteEvent } from '../../../src/features/chat/model'
import type { ChatHistoryRow } from '../../../src/features/chat/persistence'

const pollId = '20000000-0000-4000-8000-000000000002'
const noteId = '20000000-0000-4000-8000-000000000001'
type Row = ChatHistoryRow & { room_slug: string }
type Database = {
  rows: Row[]; messages: ChatMessage[]; votes: Array<{ messageId: string; userId: string; optionIndex: number }>
  searches: string[]; failVote: boolean
  triviaAnswers: Array<{ messageId: string; userId: string; optionIndex: number }>
  triviaClockOffset: number; failTriviaResponseOnce: boolean
  triviaLoadDelay: number; triviaActiveLoads: number; triviaMaxActiveLoads: number
}
type HarnessWindow = { chatCommandsTest: { broadcasts: ChatMessage[]; saves: ChatMessage[]; acceptedMessages: Record<string, ChatMessage>; failSend: boolean; holdDelivery: boolean; releaseDelivery(): void; peerVote(event: ChatPollVoteEvent, roomId?: string): void } }
const databases = new WeakMap<Page, Database>()
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message room chat' })
const pollRow = (page: Page, id = pollId) => page.locator(`#chat-message-${id}`)
const voteOption = (row: Locator, option: string) => row.getByRole('button', { name: new RegExp(`^${option}, \\d+ votes?`) })

async function runCommand(page: Page, command: string) {
  await composer(page).fill(command)
  await composer(page).press('Enter')
}

async function openGames(page: Page) {
  await page.getByRole('button', { name: 'Add to message', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Games', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Coin flip', exact: true })).toBeVisible()
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
    messages: [], votes: [], searches: [], failVote: false, triviaAnswers: [], triviaClockOffset: 0, failTriviaResponseOnce: false,
    triviaLoadDelay: 0, triviaActiveLoads: 0, triviaMaxActiveLoads: 0 }
  databases.set(page, database)
  await page.route('**/api/config', (route) => route.fulfill({ json: { giphyConfigured: false } }))
  await page.route('**/api/rooms/*/chat/**', async (route) => {
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
    if (action === 'pins') return route.fulfill({ json: { pins: [], rows: [], replies: [], profiles: [] } })
    if (action === 'trivia') {
      const row = scope.find((row) => row.id === parts[6])
      const game = row?.game as Extract<NonNullable<ChatMessage['game']>, { kind: 'trivia' }> | undefined
      if (!row || !game?.round) return route.fulfill({ status: 404, json: { error: 'This trivia round is unavailable.' } })
      if (request.method() === 'GET') {
        database.triviaActiveLoads++
        database.triviaMaxActiveLoads = Math.max(database.triviaMaxActiveLoads, database.triviaActiveLoads)
        const delay = database.triviaLoadDelay
        database.triviaLoadDelay = 0
        try { if (delay) await new Promise((resolve) => setTimeout(resolve, delay)) }
        finally { database.triviaActiveLoads-- }
      }
      const now = Date.now() + database.triviaClockOffset
      const closed = now >= Date.parse(game.round.endsAt)
      let answers = database.triviaAnswers.filter((answer) => answer.messageId === row.id)
      if (request.method() === 'POST' && parts[7] === 'answer') {
        const { optionIndex } = request.postDataJSON() as { optionIndex: number }
        if (!answers.some((answer) => answer.userId === userId)) {
          if (closed) return route.fulfill({ status: 409, json: { error: 'This trivia round has ended.' } })
          database.triviaAnswers.push({ messageId: row.id, userId, optionIndex })
          answers = database.triviaAnswers.filter((answer) => answer.messageId === row.id)
        }
        if (database.failTriviaResponseOnce) {
          database.failTriviaResponseOnce = false
          return route.fulfill({ status: 503, json: { error: "Couldn't confirm your answer. Try again." } })
        }
      }
      return route.fulfill({ json: { messageId: row.id, endsAt: game.round.endsAt, serverNow: new Date(now).toISOString(),
        answered: answers.length, selectedOption: answers.find((answer) => answer.userId === userId)?.optionIndex,
        ...(closed ? { correctOption: 0, counts: game.round.options.map((_, index) => answers.filter((answer) => answer.optionIndex === index).length) } : {}),
      } })
    }
    if (request.method() === 'POST' && action === 'messages') {
      const input = request.postDataJSON() as ChatMessage
      const message = await page.evaluate(message => (window as unknown as HarnessWindow).chatCommandsTest.acceptedMessages[message.id] || message, input)
      database.messages.push(message)
      database.rows.push({ id: message.id, room_slug: room, content: message.content, message_type: message.type,
        media_url: message.mediaUrl || null, storage_path: message.storagePath || null, mentions: message.mentions || [],
        user_id: userId, user_name: message.user.name, avatar_seed: message.user.avatarSeed || userId,
        created_at: message.createdAt, reply_to_id: message.replyTo?.id || null, soundspin_message_reactions: [],
        poll_options: message.poll?.options || null, soundspin_poll_votes: [], song: message.song || null, game: message.game || null })
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
  await page.goto('/tests/browser/chat/harnesses/commands/index.html')
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
  await composer(page).fill('/')
  await composer(page).press('ArrowUp')
  const lastCommand = page.getByRole('option', { name: '/8ball Ask the Magic 8 Ball', exact: true })
  await expect(lastCommand).toHaveAttribute('aria-selected', 'true')
  await expect(lastCommand).toBeInViewport({ ratio: 1 })
  await composer(page).press('Escape')
  await runCommand(page, '/unsupported')
  await expect(page.getByRole('alert').filter({ hasText: 'Unknown command.' })).toBeVisible()
  await expect(composer(page)).toHaveValue('/unsupported')
  expect(databases.get(page)!.messages).toEqual([])
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).chatCommandsTest.broadcasts)).toEqual([])
})

test('Create a poll, change a vote and keep the result after returning', async ({ page }) => {
  const form = page.getByRole('region', { name: 'New poll' })
  await composer(page).fill('Keep this text draft')
  await page.getByRole('button', { name: 'Add to message', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New poll', exact: true }).click()
  await expect(form.getByRole('textbox', { name: 'Question', exact: true })).toBeFocused()
  await expect(composer(page)).toHaveValue('Keep this text draft')
  await form.getByRole('button', { name: 'Close poll', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(composer(page)).toHaveValue('Keep this text draft')
  await expect(composer(page)).toBeFocused()

  await runCommand(page, '/poll Next set?')
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

test('Play chat games with confirmed results while keeping an invalid command for correction', async ({ page }) => {
  await runCommand(page, '/roll 99d999')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(composer(page)).toHaveValue('/roll 99d999')
  expect(databases.get(page)!.messages).toHaveLength(0)

  await page.evaluate(() => { (window as unknown as HarnessWindow).chatCommandsTest.holdDelivery = true })
  await runCommand(page, '/roll 2d6')
  await expect(composer(page)).toHaveValue('')
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).chatCommandsTest.broadcasts.length)).toBe(1)
  const sent = await page.evaluate(() => (window as unknown as HarnessWindow).chatCommandsTest.broadcasts[0])
  expect(sent.game?.result).toBeUndefined()
  const roll = pollRow(page, sent.id).getByRole('group', { name: 'Dice roll', exact: true })
  await expect(roll).toContainText('/roll 2d6')
  await expect(roll.getByText('4 + 4 = 8', { exact: true })).toHaveCount(0)
  await page.evaluate(() => (window as unknown as HarnessWindow).chatCommandsTest.releaseDelivery())
  await expect(roll.getByText('4 + 4 = 8', { exact: true })).toBeVisible()
  await expect.poll(() => databases.get(page)!.messages.length).toBe(1)
  expect(databases.get(page)!.messages[0].game?.result).toEqual([4,4])
  await page.reload()
  await expect(roll.getByText('4 + 4 = 8', { exact: true })).toBeVisible()

  await runCommand(page, '/pick deep house, ambient')
  const pick = page.getByRole('group', { name: 'Random pick', exact: true })
  await expect(pick).toContainText('/pick deep house, ambient')
  await expect(pick.getByText('ambient', { exact: true })).toBeVisible()
  await expect.poll(() => databases.get(page)!.messages.length).toBe(2)

  await composer(page).fill('/8b')
  await expect(page.getByRole('listbox', { name: 'Chat commands' }).getByRole('option', { name: '/8ball Ask the Magic 8 Ball', exact: true })).toBeVisible()
  await runCommand(page, '/flip')
  const flip = page.getByRole('group', { name: 'Coin flip', exact: true })
  await expect(flip.getByText('Heads', { exact: true })).toBeVisible()
  await runCommand(page, '/rps rock')
  const rps = page.getByRole('group', { name: 'Rock, paper, scissors', exact: true })
  await expect(rps).toContainText('vs scissors · Win')
  await runCommand(page, '/8ball Will the next track be a hit?')
  const eightball = page.getByRole('group', { name: 'Magic 8 Ball', exact: true })
  await expect(eightball.getByText('Ask again later', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(composer(page)).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect.poll(() => databases.get(page)!.messages.length).toBe(5)
  await page.reload()
  await expect(flip.getByText('Heads', { exact: true })).toBeVisible()
  await expect(rps).toContainText('vs scissors · Win')
  await expect(eightball.getByText('Ask again later', { exact: true })).toBeVisible()
})

test('Start games from the add menu while keeping a reply draft and correcting game input', async ({ page }) => {
  await page.goto('/tests/browser/chat/harnesses/commands/index.html?text-only')
  await expect(composer(page)).toBeEnabled()
  const noteRow = pollRow(page, noteId)
  await noteRow.hover()
  await noteRow.getByRole('button', { name: 'Message actions for Mira', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  await composer(page).fill('Keep this reply draft')
  const reply = page.locator('.chat-reply-composer')
  await expect(reply).toContainText('needle track notes')

  await openGames(page)
  await expect(page.getByRole('menuitem', { name: 'Upload image', exact: true })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'New poll', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Coin flip', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Coin flip', exact: true })).toContainText('Heads')
  await expect(composer(page)).toHaveValue('Keep this reply draft')
  await expect(reply).toContainText('needle track notes')
  await expect(composer(page)).toBeFocused()
  await expect.poll(() => databases.get(page)!.messages.length).toBe(1)
  expect(databases.get(page)!.messages[0].replyTo).toBeUndefined()

  await openGames(page)
  await page.getByRole('menuitem', { name: 'Rock, paper, scissors', exact: true }).click()
  const rps = page.getByRole('region', { name: 'Rock, paper, scissors', exact: true })
  await expect(rps.getByRole('button', { name: 'Rock', exact: true })).toBeVisible()
  await rps.getByRole('button', { name: 'Rock', exact: true }).press('Escape')
  await expect(rps).toHaveCount(0)
  await expect(composer(page)).toBeFocused()

  await openGames(page)
  await page.getByRole('menuitem', { name: 'Pick between options', exact: true }).click()
  const pick = page.getByRole('region', { name: 'Pick between options', exact: true })
  const choices = pick.getByRole('textbox', { name: 'Choices', exact: true })
  await expect(choices).toBeFocused()
  await choices.fill('House, House')
  await pick.getByRole('button', { name: 'Pick', exact: true }).click()
  await expect(pick.getByRole('alert')).toBeVisible()
  await expect(choices).toHaveValue('House, House')
  expect(databases.get(page)!.messages).toHaveLength(1)
  await choices.fill('House, Ambient')
  await pick.getByRole('button', { name: 'Pick', exact: true }).click()
  await expect(pick).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Random pick', exact: true })).toContainText('Ambient')
  await expect(composer(page)).toHaveValue('Keep this reply draft')
  await expect(reply).toContainText('needle track notes')

  await page.setViewportSize({ width: 390, height: 844 })
  await openGames(page)
  await expect(page.getByRole('menuitem', { name: 'Magic 8 Ball', exact: true })).toBeInViewport({ ratio: 1 })
  await page.getByRole('menuitem', { name: 'Magic 8 Ball', exact: true }).click()
  const eightball = page.getByRole('region', { name: 'Magic 8 Ball', exact: true })
  await expect(eightball.getByRole('textbox', { name: 'Question', exact: true })).toBeFocused()
  await expect(eightball.getByRole('button', { name: 'Ask', exact: true })).toBeVisible()
  await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await eightball.getByRole('button', { name: 'Close game', exact: true }).click()
  await expect(composer(page)).toHaveValue('Keep this reply draft')
  await expect(composer(page)).toBeFocused()
  await expect(reply).toContainText('needle track notes')
})

test('Play a shared trivia round, recover a saved answer and reveal the room result', async ({ page }) => {
  const database = databases.get(page)!
  // A slow first read must finish instead of being cancelled by the next refresh.
  database.triviaLoadDelay = 3100
  await composer(page).fill('Keep this track recommendation')
  await openGames(page)
  await page.getByRole('menuitem', { name: 'Music trivia', exact: true }).click()
  const trivia = page.getByRole('region', { name: 'Music trivia', exact: true })
  const daftPunk = trivia.getByRole('button', { name: /^Daft Punk(?:,|$)/ })
  const justice = trivia.getByRole('button', { name: /^Justice(?:,|$)/ })
  await expect(trivia).toContainText('Who released the album Discovery?')
  await expect(composer(page)).toHaveValue('Keep this track recommendation')
  await expect(daftPunk).toBeEnabled()
  expect(database.triviaMaxActiveLoads).toBe(1)
  await expect(trivia).toContainText('0 answered')
  await expect(trivia.getByText('Correct', { exact: true })).toHaveCount(0)

  // The server saved Alice's answer but its response was lost. Recovery must
  // restore that locked answer instead of offering another attempt.
  database.failTriviaResponseOnce = true
  await daftPunk.click()
  await expect(trivia.getByRole('alert')).toContainText("Couldn't confirm your answer.")
  expect(database.triviaAnswers).toHaveLength(1)
  await trivia.getByRole('button', { name: 'Retry trivia', exact: true }).click()
  await expect(daftPunk).toHaveAttribute('aria-pressed', 'true')
  await expect(justice).toBeDisabled()
  await page.reload()
  await expect(daftPunk).toHaveAttribute('aria-pressed', 'true')
  await expect(justice).toBeDisabled()
  await expect(trivia).toContainText('Answer saved')
  await expect(composer(page)).toHaveValue('Keep this track recommendation')

  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(daftPunk).toBeEnabled()
  await expect(daftPunk).toHaveAttribute('aria-pressed', 'false')
  await expect(trivia).toContainText('1 answered')
  await justice.click()
  await expect(justice).toHaveAttribute('aria-pressed', 'true')
  await expect(daftPunk).toBeDisabled()
  await expect(trivia).toContainText('2 answered')
  await expect(trivia.getByText('Incorrect', { exact: true })).toHaveCount(0)
  expect(database.triviaAnswers).toHaveLength(2)

  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await expect(daftPunk).toHaveAttribute('aria-pressed', 'true')
  await expect(trivia).toContainText('2 answered')
  database.triviaClockOffset = 31_000
  await expect(trivia.getByText('Correct', { exact: true })).toBeVisible()
  await expect(daftPunk).toHaveAccessibleName(/correct answer, 1 answer/)
  await expect(justice).toBeDisabled()
  await expect(composer(page)).toHaveValue('Keep this track recommendation')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(trivia).toBeInViewport({ ratio: 1 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const answerBounds = await daftPunk.boundingBox()
  expect(answerBounds!.height).toBeGreaterThanOrEqual(44)
})
