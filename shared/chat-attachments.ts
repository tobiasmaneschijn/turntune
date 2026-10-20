import { MUSIC_PROVIDERS, type Provider } from './provider-definitions.js'
import { normalizeChatTriviaRound, type ChatTriviaRound } from './chat-trivia.js'

/** Public room music only. Private waiting queues are never attachment sources. */
export interface ChatSongAttachment {
  id: string
  provider: Provider
  providerId: string
  title: string
  artist?: string
  artworkUrl?: string
  permalinkUrl?: string
  durationMs?: number
  positionSeconds?: number
}

export const COIN_SIDES = ['heads', 'tails'] as const
export const RPS_CHOICES = ['rock', 'paper', 'scissors'] as const
export const EIGHTBALL_ANSWERS = ['yes', 'no', 'likely', 'unlikely', 'maybe', 'askAgain', 'certain', 'doubtful'] as const
export type CoinSide = typeof COIN_SIDES[number]
export type RpsChoice = typeof RPS_CHOICES[number]
export type EightballAnswer = typeof EIGHTBALL_ANSWERS[number]

export type ChatGame =
  | { kind: 'roll'; dice: number; sides: number; result?: number[] }
  | { kind: 'pick'; options: string[]; result?: string }
  | { kind: 'flip'; result?: CoinSide }
  | { kind: 'rps'; choice: RpsChoice; result?: RpsChoice }
  | { kind: 'eightball'; question: string; result?: EightballAnswer }
  | { kind: 'trivia'; round?: ChatTriviaRound }

export function chatGameCommand(game: ChatGame): string {
  switch (game.kind) {
    case 'roll': return `/roll ${game.dice}d${game.sides}`
    case 'pick': return `/pick ${game.options.join(', ')}`
    case 'flip': return '/flip'
    case 'rps': return `/rps ${game.choice}`
    case 'eightball': return `/8ball ${game.question}`
    case 'trivia': return '/trivia'
  }
}

export function rpsOutcome(choice: RpsChoice, opponent: RpsChoice): 'win' | 'lose' | 'draw' {
  const beats: Record<RpsChoice, RpsChoice> = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
  return choice === opponent ? 'draw' : beats[choice] === opponent ? 'win' : 'lose'
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum
function enumValue<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === 'string' && values.includes(value as T) ? value as T : undefined
}
function publicUrl(value: unknown): string | undefined {
  if (!text(value, 4096)) return undefined
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

/** Normalize stored/broadcast metadata; this does not grant it server authority. */
export function normalizeChatSong(value: unknown): ChatSongAttachment | undefined {
  const song = object(value)
  if (!song || !text(song.id, 100) || !MUSIC_PROVIDERS.includes(song.provider as Provider) || !text(song.providerId, 2048) || !text(song.title, 500)) return undefined
  return {
    id: song.id, provider: song.provider as Provider, providerId: song.providerId, title: song.title,
    artist: text(song.artist, 500) ? song.artist : undefined,
    artworkUrl: publicUrl(song.artworkUrl), permalinkUrl: publicUrl(song.permalinkUrl),
    durationMs: typeof song.durationMs === 'number' && Number.isFinite(song.durationMs) && song.durationMs >= 0 && song.durationMs <= 7 * 86400_000 ? song.durationMs : undefined,
    positionSeconds: typeof song.positionSeconds === 'number' && Number.isFinite(song.positionSeconds) && song.positionSeconds >= 0 && song.positionSeconds <= 7 * 86400 ? song.positionSeconds : undefined,
  }
}

export function normalizeChatGame(value: unknown): ChatGame | undefined {
  const game = object(value)
  if (!game) return undefined
  if (game.kind === 'roll' && Number.isInteger(game.dice) && Number.isInteger(game.sides) && Number(game.dice) >= 1 && Number(game.dice) <= 10 && Number(game.sides) >= 2 && Number(game.sides) <= 100) {
    const dice = Number(game.dice), sides = Number(game.sides)
    const result = Array.isArray(game.result) && game.result.length === dice && game.result.every(value => Number.isInteger(value) && value >= 1 && value <= sides) ? game.result as number[] : undefined
    return { kind: 'roll', dice, sides, result }
  }
  if (game.kind === 'pick' && Array.isArray(game.options) && game.options.length >= 2 && game.options.length <= 20 && game.options.every(value => text(value, 80))) {
    const options = game.options.map(value => String(value).trim())
    if (options.some(value => !value) || new Set(options.map(value => value.toLocaleLowerCase())).size !== options.length) return undefined
    return { kind: 'pick', options, result: typeof game.result === 'string' && options.includes(game.result) ? game.result : undefined }
  }
  if (game.kind === 'flip') return { kind: 'flip', result: enumValue(game.result, COIN_SIDES) }
  if (game.kind === 'trivia') return { kind: 'trivia', round: normalizeChatTriviaRound(game.round) }
  if (game.kind === 'rps') {
    const choice = enumValue(game.choice, RPS_CHOICES)
    if (choice) return { kind: 'rps', choice, result: enumValue(game.result, RPS_CHOICES) }
  }
  if (game.kind === 'eightball' && text(game.question, 200) && game.question.trim()) {
    return { kind: 'eightball', question: game.question.trim(), result: enumValue(game.result, EIGHTBALL_ANSWERS) }
  }
  return undefined
}
