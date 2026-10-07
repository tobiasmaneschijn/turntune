import { z } from "zod";
import { libraryTrackSchema } from "./private-library.js";

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  bio: z.string().trim().max(160).optional(),
  avatarKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  customAvatarPath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/).optional(),
  themeKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, "Use 3–24 letters, numbers, or underscores.").nullable().optional(),
  statusText: z.string().trim().max(80).optional(),
  favoriteTracks: z.array(libraryTrackSchema).max(3).refine(tracks => new Set(tracks.map(track => `${track.provider}:${track.providerId}`)).size === tracks.length, "That song is already featured.").optional()
}).refine(value => Object.keys(value).length > 0, "No profile changes supplied.")
  .refine(value => !(value.avatarKey && value.customAvatarPath), "Choose an avatar or an upload.");

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
