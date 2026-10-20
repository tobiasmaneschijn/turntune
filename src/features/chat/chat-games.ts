import { chatGameCommand, normalizeChatGame, type ChatGame } from '../../../shared/chat-attachments'
import i18n from '../../i18n'
import { isChatGameCommand, parseChatCommand } from './commands'

/** Commas/pipes preserve multiword choices; spaces support short one-word lists. */
export function parseChatGameCommand(content: string): ChatGame | null {
  const command = parseChatCommand(content)
  if (!command?.name || !isChatGameCommand(command.name)) return null
  const argument = command.arguments
  if (command.name === 'flip') {
    if (argument) throw new Error(i18n.t('chat:flipFormat'))
    return { kind: 'flip' }
  }
  if (command.name === 'rps') {
    const game = normalizeChatGame({ kind: 'rps', choice: argument.toLowerCase() })
    if (!game) throw new Error(i18n.t('chat:rpsFormat'))
    return game
  }
  if (command.name === '8ball') {
    const game = normalizeChatGame({ kind: 'eightball', question: argument })
    if (!game) throw new Error(i18n.t('chat:eightballFormat'))
    return game
  }
  if (command.name === 'roll') {
    const dice = /^(\d{1,2})?d(\d{1,3})$/i.exec(argument || '1d6')
    const game = dice && normalizeChatGame({ kind: 'roll', dice: Number(dice[1] || 1), sides: Number(dice[2]) })
    if (!game) throw new Error(i18n.t('chat:rollFormat'))
    return game
  }
  const options = argument.split(/[,|]/.test(argument) ? /\s*[,|]\s*/ : /\s+/).map(value => value.trim())
  const game = normalizeChatGame({ kind: 'pick', options })
  if (!game || chatGameCommand(game).length > 500) throw new Error(i18n.t('chat:pickFormat'))
  return game
}

export function formatChatGameCommand(game: ChatGame): string {
  return chatGameCommand(game)
}
