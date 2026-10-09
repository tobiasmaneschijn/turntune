import { z } from 'zod';
import { isMixcloudShowKey, mixcloudShowKey } from './mixcloud.js';

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
  provider: z.enum(["youtube", "spotify", "apple", "soundcloud", "mixcloud"]),
  providerId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120).optional(),
  artworkUrl: z.string().url().max(2048).optional(),
  permalinkUrl: z.string().url().max(2048).optional(),
  durationMs: z.number().int().positive().max(60 * 60 * 24 * 1000).optional()
}).superRefine((track, context) => {
  if (track.artworkUrl && !track.artworkUrl.startsWith("https://")) {
    context.addIssue({ code: "custom", path: ["artworkUrl"], message: "Artwork must use HTTPS." });
  }
  if (track.provider === "spotify" && !/^[A-Za-z0-9]{22}$/.test(track.providerId)) {
    context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid Spotify track ID." });
  }
  if (track.provider === "apple" && !/^\d+$/.test(track.providerId)) {
    context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid Apple Music song ID." });
  }
  if (track.provider === "mixcloud") {
    if (!isMixcloudShowKey(track.providerId)) {
      context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid Mixcloud show key." });
    }
    if (!track.permalinkUrl || mixcloudShowKey(track.permalinkUrl) !== track.providerId) {
      context.addIssue({ code: "custom", path: ["permalinkUrl"], message: "A matching Mixcloud show URL is required." });
    }
  }
  if (track.provider !== "soundcloud") return;
  if (!/^soundcloud:tracks:\d+$/.test(track.providerId)) {
    context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid SoundCloud track URN." });
  }
  if (!track.permalinkUrl) {
    context.addIssue({ code: "custom", path: ["permalinkUrl"], message: "A SoundCloud permalink is required." });
    return;
  }
  const hostname = new URL(track.permalinkUrl).hostname.toLowerCase();
  if (hostname !== "soundcloud.com" && !hostname.endsWith(".soundcloud.com")) {
    context.addIssue({ code: "custom", path: ["permalinkUrl"], message: "Invalid SoundCloud permalink." });
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
  "dj:join": z.unknown(),
  "dj:leave": z.unknown(),
  "queue:add": trackSchema,
  "queue:remove": queueTrackSchema,
  "queue:move": queueMoveSchema,
  "queue:play-next": queueTrackSchema,
  "queue:next": queueNextSchema,
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

