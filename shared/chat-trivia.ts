/** Public metadata only. Correct answers stay on the server until the round ends. */
export interface ChatTriviaRound {
  questionId: string
  question: string
  options: string[]
  endsAt: string
}

export interface ChatTriviaState {
  messageId: string
  endsAt: string
  serverNow: string
  answered: number
  selectedOption?: number
  correctOption?: number
  counts?: number[]
}

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const option = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 4

export function normalizeChatTriviaRound(value: unknown): ChatTriviaRound | undefined {
  const round = record(value)
  if (!round || !text(round.questionId, 80) || !text(round.question, 240) || !date(round.endsAt) ||
    !Array.isArray(round.options) || round.options.length !== 4 || !round.options.every(value => text(value, 100)) ||
    new Set(round.options).size !== 4) return undefined
  return { questionId: round.questionId, question: round.question, options: round.options as string[], endsAt: round.endsAt }
}

/** Reject partial/early results rather than letting untrusted payloads reveal an answer. */
export function normalizeChatTriviaState(value: unknown): ChatTriviaState | undefined {
  const state = record(value)
  if (!state || !text(state.messageId, 100) || !date(state.endsAt) || !date(state.serverNow) ||
    !Number.isInteger(state.answered) || Number(state.answered) < 0 || Number(state.answered) > 300 ||
    (state.selectedOption !== undefined && !option(state.selectedOption))) return undefined
  const closed = Date.parse(state.serverNow) >= Date.parse(state.endsAt)
  const hasResults = state.correctOption !== undefined || state.counts !== undefined
  if (hasResults && (!closed || !option(state.correctOption) || !Array.isArray(state.counts) || state.counts.length !== 4 ||
    !state.counts.every(value => Number.isInteger(value) && value >= 0 && value <= 300) ||
    state.counts.reduce((sum, value) => sum + value, 0) !== state.answered)) return undefined
  return {
    messageId: state.messageId, endsAt: state.endsAt, serverNow: state.serverNow, answered: Number(state.answered),
    ...(state.selectedOption === undefined ? {} : { selectedOption: state.selectedOption as number }),
    ...(hasResults ? { correctOption: state.correctOption as number, counts: state.counts as number[] } : {}),
  }
}
