import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, Music2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ChatTriviaRound, ChatTriviaState } from '../../../../shared/chat-trivia'
import type { ChatMessageFeatures } from '../message-features'
import '@/styles/chat-trivia.css'

type TriviaFeatures = NonNullable<ChatMessageFeatures['trivia']>

/** A round owns its answers, rather than posting a new chat message for each player. */
export function ChatTriviaCard({ messageId, round, features }: {
  messageId: string
  round: ChatTriviaRound
  features?: TriviaFeatures
}) {
  const { t, i18n } = useTranslation('chat')
  const id = useId()
  const cardRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(document.visibilityState === 'visible')
  const [state, setState] = useState<ChatTriviaState>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [, tick] = useState(0)
  const stateRef = useRef<ChatTriviaState | undefined>(undefined)
  const errorRef = useRef(false)
  const pendingRef = useRef(false)
  const loadController = useRef<AbortController | null>(null)
  const revisionRef = useRef(0)
  const lifetimeRef = useRef({ active: true })
  const clockRef = useRef<{ server: number; received: number } | null>(null)
  const source = features?.source
  const active = features?.active ?? false
  const enabled = active && inView && documentVisible

  useEffect(() => {
    const lifetime = { active: true }
    lifetimeRef.current = lifetime
    stateRef.current = undefined; clockRef.current = null
    errorRef.current = false; pendingRef.current = false
    setState(undefined); setError(''); setPending(false); setLoading(false)
    return () => {
      lifetime.active = false; revisionRef.current++
      const controller = loadController.current
      loadController.current = null
      controller?.abort()
    }
  }, [messageId, source, features?.scope])

  useEffect(() => {
    const element = cardRef.current
    if (!element) return
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.target === element) setInView(entry.isIntersecting)
    })
    observer.observe(element)
    const visibility = () => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', visibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility) }
  }, [])

  const acceptState = useCallback((next: ChatTriviaState) => {
    stateRef.current = next
    clockRef.current = { server: Date.parse(next.serverNow), received: performance.now() }
    errorRef.current = false
    setState(next); setError('')
  }, [])

  const refresh = useCallback(async () => {
    // Polling and expiry checks share one read. A slow response must be allowed
    // to finish rather than being cancelled by the next polling interval.
    if (!source || pendingRef.current || loadController.current) return
    const lifetime = lifetimeRef.current
    const revision = ++revisionRef.current
    const controller = new AbortController()
    loadController.current = controller
    if (!stateRef.current) setLoading(true)
    try {
      const next = await source.loadTrivia(messageId, controller.signal)
      if (lifetime.active && revisionRef.current === revision) acceptState(next)
    } catch (cause) {
      if (!lifetime.active || controller.signal.aborted || revisionRef.current !== revision) return
      errorRef.current = true
      setError(cause instanceof Error ? cause.message : t('trivia.loadFailed'))
    } finally {
      if (loadController.current === controller) loadController.current = null
      if (lifetime.active && revisionRef.current === revision) setLoading(false)
    }
  }, [source, messageId, acceptState, t])

  useEffect(() => {
    if (!enabled || !source || state?.correctOption !== undefined) return
    void refresh()
    const interval = setInterval(() => {
      if (stateRef.current?.correctOption === undefined && !errorRef.current) void refresh()
    }, 2500)
    return () => {
      clearInterval(interval); revisionRef.current++
      const controller = loadController.current
      loadController.current = null
      controller?.abort()
    }
  }, [enabled, source, refresh, features?.disabled, state?.correctOption])

  const closed = state?.correctOption !== undefined
  useEffect(() => {
    if (!enabled || closed) return
    const interval = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(interval)
  }, [enabled, closed])

  const clock = clockRef.current
  const remaining = clock && state ? Math.max(0, Math.ceil((Date.parse(state.endsAt) - clock.server - (performance.now() - clock.received)) / 1000)) : undefined
  useEffect(() => {
    if (enabled && remaining === 0 && !closed && !errorRef.current) void refresh()
  }, [enabled, remaining, closed, refresh])

  const answer = async (optionIndex: number) => {
    if (!source || !enabled || features?.disabled || pendingRef.current || errorRef.current || !stateRef.current ||
      stateRef.current.selectedOption !== undefined || stateRef.current.correctOption !== undefined || remaining === 0) return
    const lifetime = lifetimeRef.current
    revisionRef.current++
    loadController.current?.abort()
    loadController.current = null
    pendingRef.current = true
    setPending(true); setError('')
    try {
      const next = await source.answerTrivia(messageId, optionIndex)
      if (lifetime.active) acceptState(next)
    } catch {
      if (lifetime.active) {
        errorRef.current = true
        setError(t('trivia.answerFailed'))
      }
    } finally {
      if (lifetime.active) { pendingRef.current = false; setPending(false) }
    }
  }

  const status = closed ? t('trivia.finished') : remaining === undefined ? t('trivia.loading')
    : remaining === 0 ? t('trivia.revealing') : t('trivia.secondsLeft', { count: remaining })
  const answered = state?.answered ?? 0
  const selected = state?.selectedOption
  const ownResult = selected === undefined ? closed ? '' : t('trivia.oneAnswer')
    : closed ? t(selected === state.correctOption ? 'trivia.correct' : 'trivia.incorrect') : t('trivia.answerSaved')

  return <section ref={cardRef} className="chat-trivia" role="region" aria-label={t('musicTrivia')} aria-busy={pending || loading || undefined}>
    <div className="chat-trivia-heading">
      <span><Music2 size={16} aria-hidden="true" /><strong>{t('musicTrivia')}</strong></span>
      {source && <span className="chat-trivia-time" role="timer" aria-live="off">{status}</span>}
    </div>
    <p id={`${id}-question`} className="chat-trivia-question">{round.question}</p>
    <div className="chat-trivia-options" role="group" aria-labelledby={`${id}-question`}>
      {round.options.map((option, index) => {
        const isSelected = index === selected
        const correct = index === state?.correctOption
        const count = state?.counts?.[index]
        const label = closed ? t(correct ? 'trivia.correctAnswerOption' : 'trivia.answerOption', { option, count: count ?? 0 }) : option
        return <button type="button" key={index} className="chat-trivia-option" aria-label={label} aria-pressed={isSelected}
          data-correct={correct || undefined} disabled={!source || !state || features?.disabled || pending || Boolean(error) || selected !== undefined || remaining === 0 || closed}
          onClick={() => void answer(index)}>
          <span className="chat-trivia-option-copy">{correct && <Check size={14} aria-hidden="true" />}{option}</span>
          {closed && count !== undefined && <span className="chat-trivia-count" aria-hidden="true">{count.toLocaleString(i18n.resolvedLanguage)}</span>}
        </button>
      })}
    </div>
    <div className="chat-trivia-footer" aria-live="polite" aria-atomic="true">
      <span>{source ? t('trivia.answered', { count: answered }) : t('trivia.unavailable')}</span>
      {source && ownResult && <span>{ownResult}</span>}
    </div>
    {error && <div className="chat-trivia-recovery"><p role="alert">{error}</p>
      <Button type="button" size="sm" variant="ghost" aria-label={t('trivia.retry')} disabled={pending || loading} onClick={() => void refresh()}>{t('retry')}</Button>
    </div>}
  </section>
}
