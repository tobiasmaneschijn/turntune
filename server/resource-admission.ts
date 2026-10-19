import { SecurityBudget, SecurityLimitError } from './security-budget.js'
import type { ResolvedResourcePolicy } from '../shared/resource-policy.js'

/** Cleanup and playback keep independent capacity when additions are throttled. */
const recoveryActions = new Set(['queue:remove','queue:clear','dj:leave','playback:update','playback:ended','playback:resume','queue:next','playback:skip-vote'])
export class ResourceAdmission {
  constructor(private readonly budget: SecurityBudget) {}
  async roomAction<T>(event: string, actor: string, room: string | undefined, policy: ResolvedResourcePolicy, operation: () => Promise<T>): Promise<T> {
    if (!room || event === 'room:join' || event.startsWith('chat:')) return operation()
    const {limits,global}=policy
    if(recoveryActions.has(event))return this.budget.run(`room-recovery-flight:${actor}`,limits.roomWritesInFlight,async()=>{
      if(!this.budget.consume([
        {key:`room-recovery-user:${actor}`,maximum:limits.roomWritesPerMinute,windowMs:60_000},
        {key:`room-recovery-room:${room}`,maximum:global.roomWritesPerMinute,windowMs:60_000},
      ]))throw new SecurityLimitError()
      return operation()
    })
    return this.budget.run(`room-write-flight:${actor}`,limits.roomWritesInFlight,async()=>{
      if(!this.budget.consume([
        {key:`room-write-user:${actor}`,maximum:limits.roomWritesPerMinute,windowMs:60_000},
        {key:`room-write-room:${room}`,maximum:global.roomWritesPerMinute,windowMs:60_000},
      ]) || !this.budget.consumeBurst([{key:`room-write-burst:${actor}`,capacity:limits.roomWriteBurst,perMinute:limits.roomWritesPerMinute}])) throw new SecurityLimitError()
      return operation()
    })
  }
  importSet<T>(actor: string, policy: ResolvedResourcePolicy, operation: () => Promise<T>): Promise<T> {
    return this.budget.run(`set-import-flight:${actor}`,policy.limits.importsInFlight,async()=>{
      if(!this.budget.consume([{key:`set-import-rate:${actor}`,maximum:policy.limits.importsPerMinute,windowMs:60_000}]))throw new SecurityLimitError()
      return operation()
    })
  }
}
