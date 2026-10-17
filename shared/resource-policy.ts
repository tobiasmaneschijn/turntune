import { z } from 'zod'

// These are code safety ceilings, not entitlements. Operator configuration may
// choose smaller values; plans cannot disable a protection with zero or null.
const integer = (maximum: number) => z.number().int().min(1).max(maximum)
export const uploadLimitsSchema = z.object({
  fileBytes: integer(6 * 1024 * 1024), storedBytes: integer(10 * 1024 ** 3), storedObjects: integer(10_000),
  hourlyBytes: integer(1024 ** 3), hourlyObjects: integer(1000), pendingBytes: integer(100 * 1024 ** 2), pendingObjects: integer(50),
}).strict()
export const planLimitsSchema = z.object({
  ownedRooms: integer(100), roomCreatesPerHour: integer(100), libraryPicks: integer(5000), librarySets: integer(100), librarySetTracks: integer(100),
  queueTracksPerRoom: integer(1000), queueTracksTotal: integer(5000), socketsPerAccount: integer(20),
  roomWritesPerMinute: integer(600), roomWriteBurst: integer(100), roomWritesInFlight: integer(8),
  importTracks: integer(100), importsPerMinute: integer(20), importsInFlight: integer(4),
  favoriteRooms: integer(1000), memberships: integer(1000), uploadsInFlight: integer(10),
  uploads: z.object({
    avatar: uploadLimitsSchema.extend({ fileBytes: integer(5 * 1024 * 1024) }),
    feedback: uploadLimitsSchema.extend({ fileBytes: integer(5 * 1024 * 1024) }),
    chat: uploadLimitsSchema,
  }).strict(),
}).strict()
export const globalLimitsSchema = z.object({
  socketsTotal: integer(1000), socketsPerRoom: integer(300), queueTracksPerRoom: integer(5000), roomWritesPerMinute: integer(1200),
  uploadsInFlight: integer(16), roomUploadObjects: integer(10_000), roomUploadBytes: integer(10 * 1024 ** 3),
  chatRetentionDays: integer(3650), chatRetentionMessages: integer(100_000),
}).strict()
export type UploadLimits = z.infer<typeof uploadLimitsSchema>
export type PlanLimits = z.infer<typeof planLimitsSchema>
export type GlobalResourceLimits = z.infer<typeof globalLimitsSchema>
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  ownedRooms: 10, roomCreatesPerHour: 3, libraryPicks: 500, librarySets: 30, librarySetTracks: 50,
  queueTracksPerRoom: 100, queueTracksTotal: 500, socketsPerAccount: 5,
  roomWritesPerMinute: 60, roomWriteBurst: 10, roomWritesInFlight: 2,
  importTracks: 50, importsPerMinute: 2, importsInFlight: 1, favoriteRooms: 100, memberships: 100, uploadsInFlight: 2,
  uploads: {
    avatar: { fileBytes: 5242880, storedBytes: 20971520, storedObjects: 4, hourlyBytes: 20971520, hourlyObjects: 4, pendingBytes: 10485760, pendingObjects: 2 },
    feedback: { fileBytes: 5242880, storedBytes: 104857600, storedObjects: 25, hourlyBytes: 26214400, hourlyObjects: 5, pendingBytes: 26214400, pendingObjects: 5 },
    chat: { fileBytes: 6291456, storedBytes: 209715200, storedObjects: 100, hourlyBytes: 52428800, hourlyObjects: 20, pendingBytes: 31457280, pendingObjects: 5 },
  },
}
export const DEFAULT_GLOBAL_LIMITS: GlobalResourceLimits = {
  socketsTotal: 100, socketsPerRoom: 25, queueTracksPerRoom: 500, roomWritesPerMinute: 120,
  uploadsInFlight: 4, roomUploadObjects: 1000, roomUploadBytes: 1073741824, chatRetentionDays: 90, chatRetentionMessages: 10_000,
}
export const resolvedResourcePolicySchema = z.object({
  plan: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), limits: planLimitsSchema, global: globalLimitsSchema,
}).strict()
export type ResolvedResourcePolicy = z.infer<typeof resolvedResourcePolicySchema>
export const defaultResourcePolicy = (): ResolvedResourcePolicy => structuredClone({ plan: 'free', limits: DEFAULT_PLAN_LIMITS, global: DEFAULT_GLOBAL_LIMITS })
