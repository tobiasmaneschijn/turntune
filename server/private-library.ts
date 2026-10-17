import { randomUUID } from "node:crypto";
import { z } from "zod";
import { approvedRemoteImageUrl } from "../shared/remote-images.js";
import { isMixcloudShowKey, mixcloudShowKey } from "../shared/mixcloud.js";

export class PrivateLibraryDataError extends Error {
  constructor() { super("Your library could not be read. Clear your library to reset it."); }
}
export const LIBRARY_LIMITS = { picks: 500, sets: 30, setTracks: 50 } as const;
export const libraryTrackSchema = z.object({
  provider: z.enum(["youtube", "spotify", "apple", "soundcloud", "mixcloud"]),
  providerId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120).optional(),
  artworkUrl: z.string().url().max(2048).refine(value => Boolean(approvedRemoteImageUrl(value)), "Artwork must use a supported image host.").optional(),
  permalinkUrl: z.string().url().startsWith("https://").max(2048).optional(),
  durationMs: z.number().int().positive().max(86_400_000).optional()
}).superRefine((track, context) => {
  const valid = track.provider === "youtube" ? /^[\w-]{11}$/.test(track.providerId)
    : track.provider === "spotify" ? /^[A-Za-z0-9]{22}$/.test(track.providerId)
    : track.provider === "apple" ? /^\d+$/.test(track.providerId)
    : track.provider === "mixcloud" ? isMixcloudShowKey(track.providerId)
    : /^soundcloud:tracks:\d+$/.test(track.providerId);
  if (!valid) context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid individual track identifier." });
  if (track.provider === "mixcloud" && (!track.permalinkUrl || mixcloudShowKey(track.permalinkUrl) !== track.providerId)) {
    context.addIssue({ code: "custom", path: ["permalinkUrl"], message: "A matching Mixcloud show URL is required." });
  }
});
const id = z.string().uuid();
const setName = z.string().trim().min(1).max(60);
const trackList = z.array(libraryTrackSchema).min(1).max(LIBRARY_LIMITS.setTracks);
export const libraryMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save-pick"), track: libraryTrackSchema }),
  z.object({ type: z.literal("delete-pick"), id }),
  z.object({ type: z.literal("save-set"), id, name: setName, tracks: trackList }),
  z.object({ type: z.literal("rename-set"), id, name: setName }),
  z.object({ type: z.literal("delete-set"), id }),
  z.object({ type: z.literal("clear-library") })
]);
export const privateLibrarySchema = z.object({
  picks: z.array(z.object({ id, track: libraryTrackSchema, savedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(LIBRARY_LIMITS.picks),
  sets: z.array(z.object({ id, name: setName, tracks: trackList, savedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(LIBRARY_LIMITS.sets)
});
export type LibraryTrack = z.infer<typeof libraryTrackSchema>;
export type PrivateLibrary = z.infer<typeof privateLibrarySchema>;
export type LibraryMutation = z.infer<typeof libraryMutationSchema>;
export const emptyLibrary = (): PrivateLibrary => ({ picks: [], sets: [] });

/** Explicit field schemas remove room IDs, contributor data, mappings and tokens. */
export function changePrivateLibrary(current: PrivateLibrary, mutation: LibraryMutation, now = Date.now()): PrivateLibrary {
  const library = structuredClone(current);
  switch (mutation.type) {
    case "save-pick": {
      const found = library.picks.find((pick) => pick.track.provider === mutation.track.provider && pick.track.providerId === mutation.track.providerId);
      if (found) found.track = mutation.track;
      else {
        if (library.picks.length >= LIBRARY_LIMITS.picks) throw new Error("Your 500 saved picks are full. Delete a pick before saving another.");
        library.picks.unshift({ id: randomUUID(), track: mutation.track, savedAt: now });
      }
      break;
    }
    case "delete-pick": library.picks = library.picks.filter((pick) => pick.id !== mutation.id); break;
    case "save-set": {
      const existing = library.sets.find((set) => set.id === mutation.id);
      const tracks = mutation.tracks.filter((track, index, all) => all.findIndex((item) => item.provider === track.provider && item.providerId === track.providerId) === index);
      if (existing) { existing.name = mutation.name; existing.tracks = tracks; }
      else {
        if (library.sets.length >= LIBRARY_LIMITS.sets) throw new Error("Your 30 saved sets are full. Delete a set before saving another.");
        library.sets.unshift({ id: mutation.id, name: mutation.name, tracks, savedAt: now });
      }
      break;
    }
    case "rename-set": {
      const existing = library.sets.find((set) => set.id === mutation.id);
      if (!existing) throw new Error("That set was deleted. Refresh your picks and sets.");
      existing.name = mutation.name;
      break;
    }
    case "delete-set": library.sets = library.sets.filter((set) => set.id !== mutation.id); break;
    case "clear-library": return emptyLibrary();
  }
  return privateLibrarySchema.parse(library);
}
