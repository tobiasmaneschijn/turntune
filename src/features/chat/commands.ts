export const CHAT_COMMAND_NAMES = ['queue', 'mute', 'search', 'poll'] as const
export type ChatCommandName = typeof CHAT_COMMAND_NAMES[number]

export function parseChatCommand(text: string): { name: ChatCommandName | null; arguments: string } | null {
  const value = text.trim()
  if (!value.startsWith('/') || value.startsWith('//')) return null
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(value)
  if (!match) return { name: null, arguments: '' }
  const name = match[1].toLowerCase()
  return { name: CHAT_COMMAND_NAMES.includes(name as ChatCommandName) ? name as ChatCommandName : null, arguments: (match[2] || '').trim() }
}

export function chatCommandSuggestions(text: string): ChatCommandName[] {
  const match = /^\/([a-z]*)$/i.exec(text.trimStart())
  return match ? CHAT_COMMAND_NAMES.filter((name) => name.startsWith(match[1].toLowerCase())) : []
}
