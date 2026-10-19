import { serverT } from "./i18n.js";
import { RoomCommandError } from './socket-handler.js'
import { SecurityLimitError } from './security-budget.js'
import { ChatRateLimit, ChatWriteConflict } from './chat-errors.js'
import { ZodError } from 'zod'

/** Only deliberately constructed application rejections expose their text. */
export class PublicRequestError extends RoomCommandError {
  constructor(message: string, readonly status = 400) { super(message) }
}
export function publicRequestFailure(error: unknown, fallback: string) {
  if (error instanceof PublicRequestError) return { status: error.status, message: error.message }
  if (error instanceof SecurityLimitError || error instanceof ChatRateLimit) return { status: 429, message: error.message }
  if (error instanceof ChatWriteConflict) return { status: 409, message: error.message }
  if (error instanceof RoomCommandError) return { status: 403, message: error.message }
  if (error instanceof ZodError) return { status: 400, message: serverT("invalid_request_fields") }
  return { status: 503, message: fallback }
}
/** SQL's intentional P0001 exceptions are classified by exact static messages.
 * A substring/regex match must never turn arbitrary database text into a public
 * error. Unknown SQL/Storage text is neither returned nor logged here. */
export function trustedSqlRequestError(error: unknown, allowed: Readonly<Record<string, number>>, fallback: string) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P0001' &&
    'message' in error && typeof error.message === 'string' && Object.hasOwn(allowed, error.message))
    return new PublicRequestError(error.message, allowed[error.message])
  return new PublicRequestError(fallback, 503)
}
