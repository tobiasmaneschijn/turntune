import { useId, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ChatPollComposerProps {
  onSubmit: (question: string, options: string[]) => Promise<boolean>
  onClose: () => void
  disabled?: boolean
  initialQuestion?: string
}

interface PollValidationError {
  message: string
  field?: 'question' | number
}

export function ChatPollComposer({
  onSubmit,
  onClose,
  disabled = false,
  initialQuestion = '',
}: ChatPollComposerProps) {
  const id = useId()
  const [question, setQuestion] = useState(initialQuestion)
  const [options, setOptions] = useState(['', ''])
  const [error, setError] = useState<PollValidationError>()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const questionRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLInputElement | null>>([])
  const unavailable = disabled || submitting

  const submit = async () => {
    if (disabled || submittingRef.current) return
    const trimmedQuestion = question.trim()
    const trimmedOptions = options.map((option) => option.trim())
    let invalid: PollValidationError | undefined
    if (!trimmedQuestion) invalid = { message: 'Enter a question.', field: 'question' }
    else if (trimmedQuestion.length > 200) invalid = { message: 'Use 200 characters or fewer for the question.', field: 'question' }
    else {
      const seen = new Set<string>()
      for (const [index, option] of trimmedOptions.entries()) {
        if (!option) invalid = { message: `Enter option ${index + 1}.`, field: index }
        else if (option.length > 80) invalid = { message: `Use 80 characters or fewer for option ${index + 1}.`, field: index }
        else if (seen.has(option.toLowerCase())) invalid = { message: 'Use different options.', field: index }
        if (invalid) break
        seen.add(option.toLowerCase())
      }
    }
    setError(invalid)
    if (invalid) {
      if (invalid.field === 'question') questionRef.current?.focus()
      else if (typeof invalid.field === 'number') optionRefs.current[invalid.field]?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      if (await onSubmit(trimmedQuestion, trimmedOptions)) onClose()
    } catch {
      setError({ message: 'Could not send poll. Try again.' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <section
      className="chat-poll-composer"
      aria-labelledby={`${id}-title`}
      aria-busy={submitting || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) {
          event.preventDefault()
          void submit()
        }
      }}
    >
      <div className="chat-poll-composer-header">
        <h3 id={`${id}-title`}>New poll</h3>
        <Button type="button" variant="ghost" size="icon" className="chat-poll-close" aria-label="Close poll" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      <div className="chat-poll-field">
        <label htmlFor={`${id}-question`}>Question</label>
        <Input
          ref={questionRef}
          id={`${id}-question`}
          value={question}
          onChange={(event) => { setQuestion(event.target.value); setError(undefined) }}
          maxLength={200}
          required
          autoFocus
          autoComplete="off"
          disabled={unavailable}
          aria-invalid={error?.field === 'question' || undefined}
          aria-describedby={error?.field === 'question' ? `${id}-error` : undefined}
        />
      </div>
      <div className="chat-poll-option-fields">
        {options.map((option, index) => (
          <div className="chat-poll-field" key={index}>
            <label htmlFor={`${id}-option-${index}`}>Option {index + 1}</label>
            <div className="chat-poll-option-field">
              <Input
                ref={(node) => { optionRefs.current[index] = node }}
                id={`${id}-option-${index}`}
                value={option}
                onChange={(event) => {
                  setOptions((current) => current.map((value, optionIndex) => optionIndex === index ? event.target.value : value))
                  setError(undefined)
                }}
                maxLength={80}
                required
                autoComplete="off"
                disabled={unavailable}
                aria-invalid={error?.field === index || undefined}
                aria-describedby={error?.field === index ? `${id}-error` : undefined}
              />
              {index > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="chat-poll-remove-option"
                  aria-label={`Remove option ${index + 1}`}
                  disabled={unavailable}
                  onClick={() => {
                    setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))
                    setError(undefined)
                    optionRefs.current[index - 1]?.focus()
                  }}
                >
                  <X size={16} />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <p id={`${id}-error`} className="chat-poll-error" role="alert">{error.message}</p>}
      <div className="chat-poll-composer-actions">
        {options.length < 4 && (
          <Button
            type="button"
            variant="ghost"
            disabled={unavailable}
            onClick={() => {
              const nextIndex = options.length
              setOptions((current) => [...current, ''])
              setError(undefined)
              requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus())
            }}
          >Add option</Button>
        )}
        <Button type="button" className="chat-poll-post" disabled={unavailable} onClick={() => void submit()}>
          {submitting ? 'Posting…' : 'Post poll'}
        </Button>
      </div>
    </section>
  )
}
