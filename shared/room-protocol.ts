import { protocolT } from "./i18n.js";
import { z } from 'zod';
import { approvedRemoteImageUrl } from './remote-images.js';
import { MUSIC_PROVIDERS, validateProviderTrackLocator } from './provider-definitions.js';
import { artworkSourcesSchema } from './artwork.js';

export const userSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(32),
  avatarSeed: z.string().min(1).max(100)
});

export const joinSchema = z.object({
  roomId: z.string().regex(/^[a-z0-9-]{3,48}$/),
  roomName: z.string().trim().min(1).max(48).optional(),
  password: z.string().max(128).optional(),
  user: userSchema
});

export const trackSchema = z.object({
  provider: z.enum(MUSIC_PROVIDERS),
  providerId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120).optional(),
  artworkUrl: z.string().url().max(2048).refine(value => Boolean(approvedRemoteImageUrl(value)), protocolT("artwork_must_use_a_supported_image_host")).optional(),
  artworkSources: artworkSourcesSchema.optional(),
  permalinkUrl: z.string().url().max(2048).optional(),
  durationMs: z.number().int().positive().max(60 * 60 * 24 * 1000).optional()
}).superRefine((track, context) => {
  if (track.artworkUrl && !track.artworkUrl.startsWith("https://")) {
    context.addIssue({ code: "custom", path: ["artworkUrl"], message: protocolT("artwork_must_use_https") });
  }
  for (const issue of validateProviderTrackLocator(track.provider, track, "queue")) {
    context.addIssue({ code: "custom", path: [issue.path], message: protocolT(issue.messageKey) });
  }
});

export const playbackSchema = z.object({
  trackId: z.string().uuid(),
  playing: z.boolean(),
  position: z.number().min(0).max(60 * 60 * 24)
});

export const queueTrackSchema = z.object({
  trackId: z.string().uuid()
});

export const queueMoveSchema = queueTrackSchema.extend({
  toIndex: z.number().int().min(0).max(999)
});

export const queueNextSchema = z.object({
  trackId: z.string().uuid()
});

export const vibeVoteSchema = z.object({
  trackId: z.string().min(1).optional(),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)])
});

export const moderatorSchema = z.object({
  roomId: z.string().regex(/^[a-z0-9-]{3,48}$/).optional(),
  userId: z.string().uuid(),
  moderator: z.boolean()
});

export const djRoleSchema = z.object({
  roomId: z.string().regex(/^[a-z0-9-]{3,48}$/).optional(),
  userId: z.string().uuid(),
  dj: z.boolean()
});

export const roomCommandSchemas = {
  "room:join": joinSchema,
  "room:moderator:set": moderatorSchema,
  "room:dj-role:set": djRoleSchema,
  "dj:join": z.object({ override: z.boolean().optional() }).nullable().optional(),
  "dj:leave": z.unknown(),
  "queue:add": trackSchema,
  "queue:remove": queueTrackSchema,
  "queue:move": queueMoveSchema,
  "queue:play-next": queueTrackSchema,
  "queue:next": queueNextSchema,
  "playback:ended": queueNextSchema.extend({ revision: z.number().int().nonnegative().optional() }),
  "playback:stop-after": z.object({ enabled:z.boolean() }),
  "playback:resume": z.unknown(),
  "playback:skip-vote": queueNextSchema.extend({ vote:z.boolean() }),
  "queue:exception": queueTrackSchema,
  "queue:exception-request": queueTrackSchema,
  "fallback:set": z.object({ enabled:z.boolean(),setId:z.string().uuid().optional() }),
  "queue:undo": z.object({ token: z.string().uuid() }),
  "queue:set-add": z.object({ setId: z.string().uuid(), requestId: z.string().uuid() }),
  "playback:update": playbackSchema,
  "vibe:vote": vibeVoteSchema
} as const;

export type RoomCommandName = keyof typeof roomCommandSchemas;
export type RoomCommandInput<E extends RoomCommandName> = z.input<(typeof roomCommandSchemas)[E]>;

export function validateRoomCommand(event: string, payload: unknown): boolean {
  return !Object.hasOwn(roomCommandSchemas, event) || roomCommandSchemas[event as RoomCommandName].safeParse(payload).success;
}

