import { CircleHelp, Coins, Dice5, Gamepad2, Hand, Music2, Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'
import type { ChatGame } from '../model'
import '@/styles/chat-games.css'

const games = [
  { kind: 'trivia', label: 'musicTrivia', Icon: Music2 },
  { kind: 'flip', label: 'coinFlip', Icon: Coins },
  { kind: 'roll', label: 'rollDice', Icon: Dice5 },
  { kind: 'rps', label: 'rockPaperScissors', Icon: Hand },
  { kind: 'pick', label: 'pickRandomly', Icon: Shuffle },
  { kind: 'eightball', label: 'magicEightball', Icon: CircleHelp },
] as const

export function ChatGamesMenu({ onChoose }: { onChoose: (kind: ChatGame['kind']) => void }) {
  const { t } = useTranslation('chat')
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger><Gamepad2 />{t('games')}</DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="chat-games-menu" aria-label={t('games')}>
      {games.map(({ kind, label, Icon }) => <DropdownMenuItem key={kind} onClick={() => onChoose(kind)}><Icon />{t(label)}</DropdownMenuItem>)}
    </DropdownMenuSubContent>
  </DropdownMenuSub>
}
