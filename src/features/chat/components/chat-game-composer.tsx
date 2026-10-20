import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { chatGameCommand, normalizeChatGame, RPS_CHOICES, type ChatGame } from '../../../../shared/chat-attachments'
import '@/styles/chat-games.css'

export type ChatGameComposerKind = 'rps' | 'pick' | 'eightball'
const titles = { rps: 'rockPaperScissors', pick: 'pickRandomly', eightball: 'magicEightball' } as const

interface Props {
  kind: ChatGameComposerKind
  disabled: boolean
  onSubmit: (game: ChatGame) => Promise<boolean>
  onClose: () => void
}

/** Only games needing a choice or question open a composer; the text draft stays separate. */
export function ChatGameComposer({ kind, disabled, onSubmit, onClose }: Props) {
  const { t } = useTranslation('chat')
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (choice?: typeof RPS_CHOICES[number]) => {
    if (disabled || submittingRef.current) return
    const game = normalizeChatGame(kind === 'rps' ? { kind, choice } : kind === 'pick'
      ? { kind, options: value.split(',').map(option => option.trim()) }
      : { kind, question: value.trim() })
    if (!game || chatGameCommand(game).length > 500) {
      setError(t(kind === 'pick' ? 'gameChoicesRequired' : value.trim().length > 200 ? 'questionTooLong' : 'questionRequired'))
      inputRef.current?.focus()
      return
    }
    submittingRef.current = true; setSubmitting(true); setError('')
    try { if (await onSubmit(game)) onClose() }
    catch { setError(t('gameStartFailed')) }
    finally { submittingRef.current = false; setSubmitting(false) }
  }

  return <section className="chat-game-composer" aria-labelledby={`${id}-title`} aria-busy={submitting || undefined}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
    }}>
    <div className="chat-game-composer-heading"><h3 id={`${id}-title`}>{t(titles[kind])}</h3>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('closeGame')} onClick={onClose}><X size={16} /></Button>
    </div>
    {kind === 'rps' ? <div className="chat-game-choices">
      {RPS_CHOICES.map((choice, index) => <Button key={choice} type="button" variant="outline" size="sm" autoFocus={index === 0}
        disabled={disabled || submitting} onClick={() => void submit(choice)}>{t(`gameChoiceLabels.${choice}`)}</Button>)}
    </div> : <div className="chat-game-inputs">
      <div className="chat-game-field"><label htmlFor={`${id}-input`}>{t(kind === 'pick' ? 'gameChoices' : 'question')}</label>
        <Input id={`${id}-input`} ref={inputRef} autoFocus autoComplete="off" value={value} maxLength={kind === 'pick' ? 494 : 200}
          placeholder={kind === 'pick' ? t('gameChoicesPlaceholder') : undefined} disabled={disabled || submitting}
          aria-invalid={Boolean(error) || undefined} aria-describedby={[kind === 'pick' ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
          onChange={event => { setValue(event.target.value); setError('') }} />
      </div>
      <Button type="button" size="sm" disabled={disabled || submitting} onClick={() => void submit()}>{t(kind === 'pick' ? 'gamePick' : 'gameAsk')}</Button>
    </div>}
    {kind === 'pick' && <p id={`${id}-hint`} className="chat-game-hint">{t('gameChoicesHint')}</p>}
    {error && <p id={`${id}-error`} className="chat-game-error" role="alert">{error}</p>}
  </section>
}
