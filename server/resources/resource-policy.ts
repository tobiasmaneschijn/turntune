import { serverT } from "../lib/i18n.js";
import type { SupabaseClient } from '@supabase/supabase-js'
import { BoundedCache } from '../lib/bounded-cache.js'
import { defaultResourcePolicy, resolvedResourcePolicySchema, type ResolvedResourcePolicy, type GlobalResourceLimits } from '../../shared/resource-policy.js'

/** Server credentials are the only source of plans. Never accept a plan claim
 * from request bodies, JWT user_metadata, or browser storage. No billing hooks. */
export class ResourcePolicyStore {
  private readonly cache: BoundedCache<{ policy: ResolvedResourcePolicy; expiresAt: number }>
  private readonly pending = new Map<string, Promise<ResolvedResourcePolicy>>()
  private readonly now: () => number
  private readonly ttlMs: number
  private generation = 0
  constructor(private readonly client: SupabaseClient | null, options: { now?: () => number; ttlMs?: number; capacity?: number } = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = Math.min(30_000, Math.max(1, options.ttlMs ?? 30_000))
    this.cache = new BoundedCache(options.capacity ?? 1000, this.now)
  }
  async get(actorId?: string): Promise<ResolvedResourcePolicy> {
    if (!this.client) return defaultResourcePolicy()
    const key = actorId || ''
    const cached = this.cache.get(key)
    if (cached) return structuredClone(cached.policy)
    const underway = this.pending.get(key)
    if (underway) return structuredClone(await underway)
    if (this.pending.size >= 1000) throw new Error(serverT("resource_policy_lookup_is_busy_try_again_shortly"))
    const generation = this.generation
    const lookup = (async () => {
      const { data, error } = await this.client!.rpc('soundspin_resource_policy', { p_actor: actorId ?? null }).abortSignal(AbortSignal.timeout(5000))
      if (error) throw new Error(serverT("resource_limits_are_unavailable_try_again_shortly"))
      const policy = resolvedResourcePolicySchema.parse(data)
      if (generation === this.generation) this.cache.set(key, { policy, expiresAt: this.now() + this.ttlMs })
      return policy
    })()
    this.pending.set(key, lookup)
    try { return structuredClone(await lookup) } finally { this.pending.delete(key) }
  }
  getAccount(actorId: string) { return this.get(actorId) }
  async getGlobal(): Promise<GlobalResourceLimits> { return (await this.get()).global }
  async getRoom(roomId: string, ownerId?: string): Promise<ResolvedResourcePolicy> {
    if (ownerId || !this.client) return this.get(ownerId)
    const { data, error } = await this.client.from('soundspin_rooms').select('owner_id').eq('slug', roomId).abortSignal(AbortSignal.timeout(5000)).maybeSingle()
    if (error || !data?.owner_id) throw new Error(serverT("room_resource_limits_are_unavailable"))
    return this.get(data.owner_id)
  }
  invalidate(actorId?: string) { this.generation++; if (actorId) this.cache.delete(actorId); else this.cache.clear() }
}
