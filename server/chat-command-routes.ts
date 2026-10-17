import express, { type Express, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import type { ChatHistoryRouteOptions } from './chat-history.js'
import type { ChatCommandService, ChatReadCursor } from './chat-command-service.js'
import { cleanupChatUpload, resolveChatMediaUrl, uploadChatMedia } from './chat-media.js'
import { managedUploadAdmission, type UploadLease } from './managed-uploads.js'
import { PublicRequestError, publicRequestFailure } from './public-request-error.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function cursor(request: Request): ChatReadCursor | undefined {
  const { beforeAt, beforeId } = request.query
  if (beforeAt === undefined && beforeId === undefined) return
  if (
    typeof beforeAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(beforeAt) ||
    !Number.isFinite(Date.parse(beforeAt)) ||
    typeof beforeId !== 'string' ||
    !UUID.test(beforeId)
  )
    throw new PublicRequestError('Invalid history position.')
  return { createdAt: beforeAt, id: beforeId }
}
export function mountDurableChatRoutes(app: Express, options: ChatHistoryRouteOptions, commands: ChatCommandService) {
  const route =
    (write: boolean, run: (room: string, userId: string, request: Request) => Promise<unknown>) =>
    async (request: Request, response: Response) => {
      response.setHeader('Cache-Control', 'no-store')
      try {
        const userId = await options.getUserId(request)
        if (!userId) {
          response.status(401).json({ error: 'Sign in to use room chat.' })
          return
        }
        const room = request.params.roomSlug
        if (typeof room !== 'string' || !/^[a-z0-9-]{3,48}$/.test(room)) throw new PublicRequestError('Invalid room.')
        const admitted = write ? await options.canWriteRoom?.(userId, room) : await options.canReadRoom(userId, room)
        if (!admitted) {
          response.status(403).json({ error: 'Join this room before using its chat.' })
          return
        }
        const result = await run(room, userId, request)
        if (!(await options.canReadRoom(userId, room))) {
          response.status(403).json({ error: 'This room session has ended.' })
          return
        }
        response.json(result)
      } catch (error) {
        const failure = publicRequestFailure(error, 'Chat is unavailable. Try again later.')
        response.status(failure.status).json({ error: failure.message })
      }
    }
  const payload = async (room: string, request: Request, search?: string) => {
    const direction = request.query.direction === 'newer' ? 'newer' : 'older'
    if (request.query.direction !== undefined && !['newer', 'older'].includes(String(request.query.direction)))
      throw new PublicRequestError('Invalid history page.')
    const limit = search ? 40 : request.query.pageSize === undefined ? 200 : Number(request.query.pageSize)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new PublicRequestError('Invalid history page.')
    const page = await commands.readPage(room, cursor(request), direction, limit, search)
    return { ...(await commands.readPayload(room, page.rows)), cursor: page.cursor, hasMore: page.hasMore }
  }
  app.get(
    '/api/rooms/:roomSlug/chat/history',
    route(false, (room, _user, request) => payload(room, request))
  )
  app.get(
    '/api/rooms/:roomSlug/chat/search',
    route(false, (room, _user, request) => {
      if (
        typeof request.query.q !== 'string' ||
        request.query.q.trim().length < 2 ||
        request.query.q.trim().length > 100
      )
        throw new PublicRequestError('Enter 2–100 characters to search room messages.')
      return payload(room, request, request.query.q.trim())
    })
  )
  app.get(
    '/api/rooms/:roomSlug/chat/messages/:messageId',
    route(false, (room, _user, request) => {
      const id = request.params.messageId
      if (typeof id !== 'string' || !UUID.test(id)) throw new PublicRequestError('Invalid message.')
      return commands.readMessage(room, id)
    })
  )
  app.get(
    '/api/rooms/:roomSlug/chat/context/:messageId',
    route(false, async (room, _user, request) => {
      const id = request.params.messageId
      if (typeof id !== 'string' || !UUID.test(id)) throw new PublicRequestError('Invalid message.')
      const record = await commands.loadMessage(id)
      if (!record || record.roomId !== room) return null
      const at = { id, createdAt: record.message.createdAt }
      const [older, newer] = await Promise.all([
        commands.readPage(room, at, 'older', 20),
        commands.readPage(room, at, 'newer', 20)
      ])
      const target = await commands.readMessage(room, id)
      return {
        ...(await commands.readPayload(room, [...older.rows, ...target!.rows, ...newer.rows])),
        olderCursor: older.cursor || at,
        newerCursor: newer.cursor || at,
        hasOlder: older.hasMore,
        hasNewer: newer.hasMore
      }
    })
  )
  app.post(
    '/api/rooms/:roomSlug/chat/messages',
    express.json({ limit: '16kb' }),
    route(true, async (room, user, request) => ({
      ok: true,
      message: await commands.message(room, user, request.body)
    }))
  )
  app.post(
    '/api/rooms/:roomSlug/chat/reactions',
    express.json({ limit: '2kb' }),
    route(true, async (room, user, request) => ({
      ok: true,
      reaction: await commands.reaction(room, user, request.body)
    }))
  )
  app.post(
    '/api/rooms/:roomSlug/chat/polls/:messageId/vote',
    express.json({ limit: '2kb' }),
    route(true, (room, user, request) =>
      commands.pollVote(
        room,
        user,
        String(request.params.messageId),
        request.body?.optionIndex,
        request.body?.id || randomUUID()
      )
    )
  )
  app.post(
    '/api/rooms/:roomSlug/chat/media-url',
    express.json({ limit: '2kb' }),
    route(false, async (room, user, request) => {
      const storagePath = request.body?.storagePath
      if (typeof storagePath !== 'string') throw new PublicRequestError('Invalid chat image.')
      return resolveChatMediaUrl(options.client, room, storagePath, user, true)
    })
  )
  app.post(
    '/api/rooms/:roomSlug/chat/uploads',
    managedUploadAdmission({
      client: options.client, getUserId: async request => (await options.getUserId(request)) || null, purpose: 'chat',
      room: request => {
        const room = request.params.roomSlug
        if (typeof room !== 'string' || !/^[a-z0-9-]{3,48}$/.test(room)) throw new PublicRequestError('Invalid room.')
        return room
      },
      check: async (user, room) => {
        if (!room || !(await options.canWriteRoom?.(user, room))) throw new PublicRequestError('Join this room before uploading chat images.', 403)
        await commands.checkParticipation(room, user, 'media')
      }
    }),
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '6mb' }),
    route(true, async (room, user, request) => {
      await commands.checkParticipation(room, user, 'media')
      const result = await uploadChatMedia(options.client, room, user, request.body, request.get('content-type') || '',
        () => commands.checkParticipation(room, user, 'media'), request.res!.locals.uploadLease as UploadLease)
      request.res!.locals.uploadComplete = true
      return result
    })
  )
  app.post(
    '/api/rooms/:roomSlug/chat/uploads/cleanup',
    express.json({ limit: '2kb' }),
    route(true, (room, user, request) => cleanupChatUpload(options.client, room, user, request.body?.storagePath))
  )
}
