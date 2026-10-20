export const CHAT_GAME_COMMAND_NAMES = ['roll', 'pick', 'flip', 'rps', '8ball'] as const
export type ChatGameCommandName = typeof CHAT_GAME_COMMAND_NAMES[number]
export const CHAT_COMMAND_NAMES = ['queue', 'mute', 'search', 'poll', ...CHAT_GAME_COMMAND_NAMES] as const
export type ChatCommandName = typeof CHAT_COMMAND_NAMES[number]

export const CHAT_COMMAND_LABEL_KEYS: Record<ChatCommandName, string> = {
  queue: 'openQueue', mute: 'muteNotifications', search: 'searchRoomMessages', poll: 'createPoll',
  roll: 'rollDice', pick: 'pickRandomly', flip: 'flipCoin', rps: 'playRps', '8ball': 'askEightball',
}

export function isChatGameCommand(name: string): name is ChatGameCommandName {
  return CHAT_GAME_COMMAND_NAMES.includes(name as ChatGameCommandName)
}

export function parseChatCommand(text: string): { name: ChatCommandName | null; arguments: string } | null {
  const value = text.trim()
  if (!value.startsWith('/') || value.startsWith('//')) return null
  const match = /^\/([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(value)
  if (!match) return { name: null, arguments: '' }
  const name = match[1].toLowerCase()
  return { name: CHAT_COMMAND_NAMES.includes(name as ChatCommandName) ? name as ChatCommandName : null, arguments: (match[2] || '').trim() }
}

export function chatCommandSuggestions(text: string): ChatCommandName[] {
  const match = /^\/([a-z0-9]*)$/i.exec(text.trimStart())
  return match ? CHAT_COMMAND_NAMES.filter((name) => name.startsWith(match[1].toLowerCase())) : []
}
