import i18n from '@/i18n'
import { requestJson } from '@/lib/authenticated-http'
import { normalizeChatTriviaState, type ChatTriviaState } from '../../../shared/chat-trivia'

export interface ChatTriviaSource {
  loadTrivia(messageId: string, signal?: AbortSignal): Promise<ChatTriviaState>
  answerTrivia(messageId: string, optionIndex: number): Promise<ChatTriviaState>
}

export function createChatTriviaSource(accessToken: string, roomSlug: string, fetchImpl: typeof fetch = fetch): ChatTriviaSource {
  const prefix = `/api/rooms/${encodeURIComponent(roomSlug)}/chat/trivia`
  const request = (messageId: string, optionIndex?: number, signal?: AbortSignal) => requestJson<ChatTriviaState>(
    `${prefix}/${encodeURIComponent(messageId)}${optionIndex === undefined ? '' : '/answer'}`, {
      accessToken, signal, method: optionIndex === undefined ? 'GET' : 'POST',
      ...(optionIndex === undefined ? {} : { body: JSON.stringify({ optionIndex }) }),
      errorMessage: i18n.t('chat:trivia.requestFailed', { defaultValue: "Couldn't load trivia. Try again." }),
      validate: (value): value is ChatTriviaState => normalizeChatTriviaState(value)?.messageId === messageId,
    }, fetchImpl)
  return { loadTrivia: (id, signal) => request(id, undefined, signal), answerTrivia: (id, optionIndex) => request(id, optionIndex) }
}
