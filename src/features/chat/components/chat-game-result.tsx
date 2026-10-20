import { CircleHelp, Coins, Dice5, Hand, Music2, Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatGame } from '../../../../shared/chat-attachments'
import { chatGameCommand, rpsOutcome } from '../../../../shared/chat-attachments'
import type { ChatMessageFeatures } from '../message-features'
import { ChatTriviaCard } from './chat-trivia'
import '@/styles/chat-features.css'

const gameViews = {
  roll: { label: 'diceRoll', Icon: Dice5 },
  pick: { label: 'randomPick', Icon: Shuffle },
  flip: { label: 'coinFlip', Icon: Coins },
  rps: { label: 'rockPaperScissors', Icon: Hand },
  eightball: { label: 'magicEightball', Icon: CircleHelp },
} as const

export function ChatGameResult({ game, messageId, features }: { game: ChatGame; messageId?: string; features?: ChatMessageFeatures }) {
  const { t } = useTranslation('chat')
  if (game.kind === 'trivia') return game.round && messageId
    ? <ChatTriviaCard key={`${features?.trivia?.scope}:${messageId}`} messageId={messageId} round={game.round} features={features?.trivia} />
    : <div className="chat-game-result"><Music2 size={18} aria-hidden="true" /><strong>{t('musicTrivia')}</strong></div>
  const { label, Icon } = gameViews[game.kind]
  let result: string | undefined
  switch (game.kind) {
    case 'roll':
      if (game.result) result = game.result.join(' + ') + (game.result.length > 1 ? ` = ${game.result.reduce((sum, value) => sum + value, 0)}` : '')
      break
    case 'pick': result = game.result; break
    case 'flip': if (game.result) result = t(`coinSides.${game.result}`); break
    case 'rps':
      if (game.result) result = t('rpsResult', { opponent: t(`rpsChoices.${game.result}`), outcome: t(`rpsOutcomes.${rpsOutcome(game.choice, game.result)}`) })
      break
    case 'eightball': if (game.result) result = t(`eightballAnswers.${game.result}`); break
  }
  return <div className="chat-game-result" role="group" aria-label={t(label)}>
    <Icon size={18} aria-hidden="true" />
    <code>{chatGameCommand(game)}</code>
    {result !== undefined && <strong>{result}</strong>}
  </div>
}
