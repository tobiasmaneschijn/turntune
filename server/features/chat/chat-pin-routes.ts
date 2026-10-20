import express, { type Express, type Request, type Response } from 'express'
import type { ChatPinService } from './chat-pin-service.js'
import { PublicRequestError, publicRequestFailure } from '../../lib/public-request-error.js'

interface ChatPinRouteOptions {
  pins: ChatPinService
  getUserId: (request: Request) => Promise<string | null | undefined>
  readMessages: (roomId: string, messageIds: string[]) => Promise<{ rows: unknown[]; replies?: unknown[]; profiles?: unknown[] }>
  canReadRoom: (roomId: string, userId: string) => Promise<boolean>
}

export function mountChatPinRoutes(app: Express, options: ChatPinRouteOptions) {
  const route = (run: (roomId: string, userId: string, request: Request) => Promise<unknown>) =>
    async (request: Request, response: Response) => {
      response.setHeader('Cache-Control', 'no-store')
      try {
        const userId = await options.getUserId(request)
        if (!userId) throw new PublicRequestError('Sign in to use room chat.', 401)
        const roomId = request.params.roomSlug
        if (typeof roomId !== 'string' || !/^[a-z0-9-]{3,48}$/.test(roomId)) throw new PublicRequestError('Invalid room.', 400)
        if (!(await options.canReadRoom(roomId, userId))) throw new PublicRequestError('Join this room before using its chat.', 403)
        const payload = await run(roomId, userId, request)
        if (!(await options.canReadRoom(roomId, userId))) throw new PublicRequestError('This room session has ended.', 403)
        response.json(payload)
      } catch (error) {
        const failure = publicRequestFailure(error, 'Pinned messages are unavailable. Try again.', { operation: 'chat.pins' })
        response.status(failure.status).json({ error: failure.message })
      }
    }

  app.get('/api/rooms/:roomSlug/chat/pins', route(async (roomId, userId) => {
    const pins = await options.pins.list(roomId, userId)
    const payload = await options.readMessages(roomId, pins.map(pin => pin.messageId))
    return { pins, ...payload }
  }))
  app.post('/api/rooms/:roomSlug/chat/pins/:messageId', express.json({ limit: '1kb' }), route((roomId, userId, request) =>
    options.pins.setPinned(roomId, userId, String(request.params.messageId), request.body?.pinned)))
}
