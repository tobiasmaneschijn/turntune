import { randomInt } from 'node:crypto'
import { COIN_SIDES, EIGHTBALL_ANSWERS, normalizeChatSong, RPS_CHOICES, type ChatGame, type ChatSongAttachment } from '../../../shared/chat-attachments.js'
import { PublicRequestError } from '../../lib/public-request-error.js'
import { createTriviaRound } from './chat-trivia.js'

export async function resolveSongAttachment(
  roomId: string,
  reference: { id: string; positionSeconds?: number },
  resolve?: (roomId: string, trackId: string) => Promise<ChatSongAttachment | null>
): Promise<ChatSongAttachment> {
  const song = normalizeChatSong(await resolve?.(roomId, reference.id))
  if (!song || song.id !== reference.id) throw new PublicRequestError('This song is no longer available in the room history.', 400)
  const positionSeconds = reference.positionSeconds === undefined ? undefined
    : Math.min(reference.positionSeconds, song.durationMs === undefined ? reference.positionSeconds : song.durationMs / 1000)
  return { ...song, positionSeconds }
}

/** Results are generated on the server; durable message receipts choose the winner. */
export function resolveChatGame(game: ChatGame, draw = randomInt, now = Date.now()): ChatGame {
  switch (game.kind) {
    case 'roll': return { kind: 'roll', dice: game.dice, sides: game.sides, result: Array.from({ length: game.dice }, () => draw(1, game.sides + 1)) }
    case 'pick': return { kind: 'pick', options: game.options, result: game.options[draw(0, game.options.length)] }
    case 'flip': return { kind: 'flip', result: COIN_SIDES[draw(0, COIN_SIDES.length)] }
    case 'rps': return { kind: 'rps', choice: game.choice, result: RPS_CHOICES[draw(0, RPS_CHOICES.length)] }
    case 'eightball': return { kind: 'eightball', question: game.question, result: EIGHTBALL_ANSWERS[draw(0, EIGHTBALL_ANSWERS.length)] }
    case 'trivia': return createTriviaRound(now, draw)
  }
}
