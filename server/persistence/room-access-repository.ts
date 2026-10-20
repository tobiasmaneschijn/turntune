import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Room, RoomRole } from '../types.js'
import { serverT } from '../lib/i18n.js'

export interface RoomAdmission {
  exists: boolean
  isPublic: boolean
  passwordHash: string | null
  role: RoomRole | null
  banned: boolean
  accessMode: 'public' | 'unlisted' | 'members'
  settings: Room['settings']
  roomActive: boolean
  /** Fresh restriction status; callers still verify the actor's trusted Auth identity. */
  accountActive: boolean
  readers: Set<string>
}

const admissionSchema = z.object({
  exists: z.boolean(), isPublic: z.boolean(), passwordHash: z.string().nullable(),
  role: z.enum(['owner', 'moderator', 'dj', 'member']).nullable(), banned: z.boolean(),
  accessMode: z.enum(['public', 'unlisted', 'members']), settings: z.record(z.unknown()),
  roomActive: z.boolean(), accountActive: z.boolean(), readers: z.array(z.string())
})

/** No cross-request cache: externally revoked access must affect the next operation. */
export class RoomAccessRepository {
  constructor(private readonly client: SupabaseClient) {}

  async visibleRooms(actorId: string, roomSlugs: string[]): Promise<Set<string>> {
    const ids = [...new Set(roomSlugs)]
    const visible = new Set<string>()
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100)
      const { data, error } = await this.client.rpc('soundspin_directory_visibility', { p_actor: actorId, p_rooms: batch })
      if (error) throw new Error(serverT('could_not_verify_room_restrictions_value1', { value1: error.message }))
      const parsed = z.array(z.string()).safeParse(data)
      if (!parsed.success) throw new Error(serverT('room_access_could_not_be_verified'))
      for (const id of parsed.data) if (batch.includes(id)) visible.add(id)
    }
    return visible
  }

  async getAccess(roomSlug: string, actorId: string | null, readerIds: string[] = []): Promise<RoomAdmission> {
    const ids = [...new Set(readerIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 100))]
    const readers = new Set<string>()
    let latest: z.infer<typeof admissionSchema> | undefined
    // Keep the RPC bounded while supporting the same large reader lists as before.
    for (let offset = 0; offset < Math.max(1, ids.length); offset += 100) {
      const batch = ids.slice(offset, offset + 100)
      const { data, error } = await this.client.rpc('soundspin_room_access', {
        p_room_slug: roomSlug, p_actor: actorId, p_readers: batch
      })
      if (error) throw new Error(serverT('could_not_check_room_access_value1', { value1: error.message }))
      const parsed = admissionSchema.safeParse(data)
      if (!parsed.success) throw new Error(serverT('room_access_could_not_be_verified'))
      latest = parsed.data
      if (!latest.roomActive) readers.clear()
      else for (const id of latest.readers) if (batch.includes(id)) readers.add(id)
    }
    return { ...latest!, settings: latest!.settings as Room['settings'], readers }
  }
}
