import type { Express, Request, Response } from 'express'
import type { ChatHistoryRouteOptions } from './chat-history.js'
import { chatWebUrl } from '../../../shared/chat-link-preview.js'
import { createLinkPreviewService } from './link-preview.js'
import { PublicRequestError, publicRequestFailure } from '../../lib/public-request-error.js'
import { SecurityBudget, SecurityLimitError } from '../../security/security-budget.js'

type Access = Pick<ChatHistoryRouteOptions, 'getUserId' | 'canReadRoom'>

/** Preview access follows current room admission, including cached results. */
export function mountChatLinkPreviewRoutes(app: Express, options: Access,
  service = createLinkPreviewService(), budget = new SecurityBudget()) {
  app.get('/api/rooms/:roomSlug/chat/link-preview', async (request: Request, response: Response) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      const userId = await options.getUserId(request)
      if (!userId) throw new PublicRequestError('Sign in to use room chat.', 401)
      const room = request.params.roomSlug
      if (typeof room !== 'string' || !/^[a-z0-9-]{3,48}$/.test(room)) throw new PublicRequestError('Invalid room.')
      if (!await options.canReadRoom(userId, room)) throw new PublicRequestError('Join this room before using its chat.', 403)
      const url = chatWebUrl(request.query.url)
      if (!url) throw new PublicRequestError('Invalid link.')
      if (!budget.consume([
        { key: `link-preview:${userId}`, maximum: 120, windowMs: 60_000 },
        { key: 'link-preview:global', maximum: 600, windowMs: 60_000 },
      ])) throw new SecurityLimitError()
      const release = budget.acquire(`link-preview:${userId}`, 4)
      if (!release) throw new SecurityLimitError()
      try {
        const preview = await service.preview(url)
        if (!await options.canReadRoom(userId, room)) throw new PublicRequestError('This room session has ended.', 403)
        if (!response.destroyed) response.json({ preview })
      } finally { release() }
    } catch (error) {
      const failure = publicRequestFailure(error, 'Link preview is unavailable.', { operation: 'chat.link-preview' })
      if (!response.destroyed) response.status(failure.status).json({ error: failure.message })
    }
  })
}
