import { serverT } from "./i18n.js";
import express, { type Express, type Request } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { PublicRequestError, publicRequestFailure, trustedSqlRequestError } from './public-request-error.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const schema = z.object({
  id: z.string().regex(UUID), message: z.string().trim().min(1).max(4000).nullable(),
  screenshot_paths: z.array(z.string().max(200)).max(5), room_slug: z.string().regex(/^[a-z0-9-]{3,48}$/).nullable(),
  page_path: z.string().min(1).max(512).regex(/^\/[\w/.-]*$/),
  viewport: z.object({ width: z.number().int().min(1).max(32768), height: z.number().int().min(1).max(32768) }).strict(),
  category: z.enum(['bug', 'idea', 'playback', 'chat', 'account', 'other']), impact: z.enum(['minor', 'blocking', 'unusable']),
  diagnostics: z.record(z.unknown())
}).strict().refine(record => record.message !== null || record.screenshot_paths.length > 0)
function boundedDiagnostics(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true
  if (typeof value === 'string') return value.length <= 2000
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => boundedDiagnostics(item, depth + 1))
  if (value && typeof value === 'object') return Object.entries(value).length <= 100 && Object.entries(value).every(([key, item]) => key.length <= 100 && boundedDiagnostics(item, depth + 1))
  return false
}
export function validateFeedbackSubmission(body: unknown, userId: string) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new PublicRequestError(serverT("invalid_feedback_fields_check_the_message_and_attachments"))
  const value = parsed.data
  if (JSON.stringify(value.diagnostics).length > 16384 || !boundedDiagnostics(value.diagnostics)) throw new PublicRequestError(serverT("feedback_diagnostics_are_too_large"))
  if (new Set(value.screenshot_paths).size !== value.screenshot_paths.length || value.screenshot_paths.some(path => !new RegExp(`^${userId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`, 'i').test(path))) throw new PublicRequestError(serverT("feedback_attachments_must_belong_to_your_account"))
  return value
}
export function mountFeedbackRoutes(app: Express, options: { client: SupabaseClient | null; getUserId: (request: Request) => Promise<string | null> }) {
  const authenticate = async (request: Request, response: express.Response, next: express.NextFunction) => {
    try {
      const actor = await options.getUserId(request)
      if (!actor) { response.status(401).json({ error: serverT("sign_in_to_send_feedback") }); return }
      if (!options.client) { response.status(503).json({ error: serverT("feedback_is_unavailable") }); return }
      response.locals.feedbackActor = actor; next()
    } catch (error) { const failure = publicRequestFailure(error, 'Feedback is unavailable. Try again later.'); response.status(failure.status).json({ error: failure.message }) }
  }
  app.post('/api/feedback', authenticate, express.json({ limit: '24kb' }), async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      const actor = String(response.locals.feedbackActor), { id, ...record } = validateFeedbackSubmission(request.body, actor)
      // Normalized immutable fields are hashed, so an ID cannot confirm unrelated
      // content or another account's submission after an uncertain response.
      const fingerprint = createHash('sha256').update(JSON.stringify(record)).digest('hex')
      const { data, error } = await options.client!.rpc('soundspin_submit_feedback', { p_actor: actor, p_id: id, p_fingerprint: fingerprint, p_record: record })
      if (error) throw trustedSqlRequestError(error, {
        'This account is unavailable.': 403,
        'Feedback operation ID belongs to different content.': 409,
        'Invalid feedback submission.': 400,
        'Invalid feedback attachments.': 400,
        'This feedback attachment is unavailable.': 400,
        'Too many feedback submissions. Try again in an hour.': 429,
        'Too many feedback submissions. Try again tomorrow.': 429,
        'Too many retained feedback submissions. Contact support.': 429
      }, 'Feedback is unavailable. Try again later.')
      response.json(data)
    } catch (error) {
      const failure = publicRequestFailure(error, 'Feedback is unavailable. Try again later.')
      response.status(failure.status).json({ error: failure.message })
    }
  })
}
