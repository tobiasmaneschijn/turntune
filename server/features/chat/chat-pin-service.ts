import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CHAT_MAX_PINS, type ChatPin, type ChatPinEvent } from '../../../shared/chat-pins.js'
import { PublicRequestError, trustedSqlRequestError } from '../../lib/public-request-error.js'
import type { DurableChatRecord } from './chat-command-service.js'

interface PinRow {
  message_id: string
  pinned_by: string
  pinned_at: string
}

export interface ChatPinServiceOptions {
  client: SupabaseClient | null
  dataDir?: string
  authorizeRead: (roomId: string, userId: string) => Promise<void>
  authorizeManage: (roomId: string, userId: string) => Promise<void>
  loadMessage: (id: string) => Promise<DurableChatRecord | null>
  withRoomOperation?: <T>(roomId: string, run: () => Promise<T>) => Promise<T>
  onChanged?: (roomId: string, event: ChatPinEvent, actorId: string) => Promise<void>
  now?: () => number
}

type LocalPins = Record<string, Record<string, ChatPin>>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Stores references only: the chat store remains the authority for message content. */
export class ChatPinService {
  private initialized?: Promise<void>
  private data: LocalPins = {}
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: ChatPinServiceOptions) {}

  private get file() {
    return path.join(this.options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'soundspin-chat-pins.json')
  }

  private async initialize() {
    this.initialized ||= (async () => {
      try { this.data = JSON.parse(await readFile(this.file, 'utf8')) as LocalPins }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    })()
    await this.initialized
  }

  private local<T>(change: (draft: LocalPins) => Promise<T>): Promise<T> {
    const result = this.chain.catch(() => {}).then(async () => {
      await this.initialize()
      const draft = structuredClone(this.data)
      const value = await change(draft)
      if (JSON.stringify(draft) !== JSON.stringify(this.data)) {
        await mkdir(path.dirname(this.file), { recursive: true })
        await writeFile(`${this.file}.tmp`, JSON.stringify(draft), 'utf8')
        await rename(`${this.file}.tmp`, this.file)
        this.data = draft
      }
      return value
    })
    this.chain = result
    return result
  }

  private operation<T>(roomId: string, run: () => Promise<T>) {
    return this.options.withRoomOperation ? this.options.withRoomOperation(roomId, run) : run()
  }

  private async pruneLocal(roomId: string, pins: Record<string, ChatPin>) {
    for (const messageId of Object.keys(pins)) {
      const record = await this.options.loadMessage(messageId)
      if (!record || record.roomId !== roomId || record.removedAt || record.message.removedAt) delete pins[messageId]
    }
  }

  async list(roomId: string, userId: string): Promise<ChatPin[]> {
    await this.options.authorizeRead(roomId, userId)
    let pins: ChatPin[]
    if (this.options.client) {
      const { data, error } = await this.options.client.from('soundspin_chat_pins')
        .select('message_id,pinned_by,pinned_at,message:soundspin_messages!inner(id,room_slug,removed_at)')
        .eq('room_slug', roomId).eq('message.room_slug', roomId).is('message.removed_at', null)
        .order('pinned_at', { ascending: false }).order('message_id', { ascending: false }).limit(CHAT_MAX_PINS)
      if (error) throw error
      pins = ((data || []) as PinRow[]).map(row => ({ messageId: row.message_id, pinnedBy: row.pinned_by, pinnedAt: row.pinned_at }))
    } else {
      pins = await this.operation(roomId, () => this.local(async draft => {
        const roomPins = Object.hasOwn(draft, roomId) ? draft[roomId] : {}
        await this.pruneLocal(roomId, roomPins)
        if (Object.keys(roomPins).length) draft[roomId] = roomPins
        else delete draft[roomId]
        return Object.values(roomPins).sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt) || b.messageId.localeCompare(a.messageId)).slice(0, CHAT_MAX_PINS)
      }))
    }
    await this.options.authorizeRead(roomId, userId)
    return pins
  }

  async setPinned(roomId: string, userId: string, messageId: string, pinned: boolean): Promise<ChatPinEvent> {
    if (!uuid.test(messageId) || typeof pinned !== 'boolean') throw new PublicRequestError('Invalid pinned message.', 400)
    return this.operation(roomId, async () => {
      await this.options.authorizeManage(roomId, userId)
      let changed: boolean
      if (this.options.client) {
        const { data, error } = await this.options.client.rpc('soundspin_set_chat_pin', {
          p_room: roomId, p_user: userId, p_message: messageId, p_pinned: pinned,
        })
        if (error) throw trustedSqlRequestError(error, {
          'This message is unavailable.': 404,
          'This room has 50 pinned messages. Unpin one first.': 409,
          'Invalid pinned message.': 400,
        }, 'Could not update pinned messages. Try again.')
        changed = data === true
      } else {
        changed = await this.local(async draft => {
          const pins = Object.hasOwn(draft, roomId) ? draft[roomId] : {}
          await this.pruneLocal(roomId, pins)
          if (!pinned) {
            const existed = Boolean(pins[messageId])
            delete pins[messageId]
            if (Object.keys(pins).length) draft[roomId] = pins
            else delete draft[roomId]
            return existed
          }
          const message = await this.options.loadMessage(messageId)
          if (!message || message.roomId !== roomId || message.removedAt || message.message.removedAt)
            throw new PublicRequestError('This message is unavailable.', 404)
          if (pins[messageId]) return false
          if (Object.keys(pins).length >= CHAT_MAX_PINS) throw new PublicRequestError('This room has 50 pinned messages. Unpin one first.', 409)
          pins[messageId] = { messageId, pinnedBy: userId, pinnedAt: new Date((this.options.now || Date.now)()).toISOString() }
          draft[roomId] = pins
          return true
        })
      }
      const event = { messageId, pinned }
      if (changed) await this.options.onChanged?.(roomId, event, userId)
      return event
    })
  }
}
