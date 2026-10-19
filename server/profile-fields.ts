import { serverT } from "./i18n.js";
import { z } from "zod";
import { libraryTrackSchema } from "./private-library.js";

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  bio: z.string().trim().max(160).optional(),
  avatarKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  customAvatarPath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/).optional(),
  themeKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, serverT("use_3_24_letters_numbers_or_underscores")).nullable().optional(),
  statusText: z.string().trim().max(80).optional(),
  favoriteTracks: z.array(libraryTrackSchema).max(3).refine(tracks => new Set(tracks.map(track => `${track.provider}:${track.providerId}`)).size === tracks.length, serverT("that_song_is_already_featured")).optional()
}).refine(value => Object.keys(value).length > 0, serverT("no_profile_changes_supplied"))
  .refine(value => !(value.avatarKey && value.customAvatarPath), serverT("choose_an_avatar_or_an_upload"));

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
