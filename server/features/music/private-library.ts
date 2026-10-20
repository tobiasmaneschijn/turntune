import { serverT } from "../../lib/i18n.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { approvedRemoteImageUrl } from "../../../shared/remote-images.js";
import { MUSIC_PROVIDERS, validateProviderTrackLocator } from "../../../shared/provider-definitions.js";
import { DEFAULT_PLAN_LIMITS, planLimitsSchema, type PlanLimits } from "../../../shared/resource-policy.js";
import { PublicRequestError } from "../../lib/public-request-error.js";

export class PrivateLibraryDataError extends Error {
  constructor() { super("Your library could not be read. Clear your library to reset it."); }
}
export const LIBRARY_LIMITS = { picks: DEFAULT_PLAN_LIMITS.libraryPicks, sets: DEFAULT_PLAN_LIMITS.librarySets, setTracks: DEFAULT_PLAN_LIMITS.librarySetTracks };
export const libraryTrackSchema = z.object({
  provider: z.enum(MUSIC_PROVIDERS),
  providerId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120).optional(),
  artworkUrl: z.string().url().max(2048).refine(value => Boolean(approvedRemoteImageUrl(value)), serverT("artwork_must_use_a_supported_image_host")).optional(),
  permalinkUrl: z.string().url().startsWith("https://").max(2048).optional(),
  durationMs: z.number().int().positive().max(86_400_000).optional()
}).superRefine((track, context) => {
  for (const issue of validateProviderTrackLocator(track.provider, track, "library")) {
    context.addIssue({ code: "custom", path: [issue.path], message: serverT(issue.path === "providerId" ? "invalid_individual_track_identifier" : issue.messageKey) });
  }
});
const id = z.string().uuid();
const setName = z.string().trim().min(1).max(60);
// Parsers accept supported saved data after a plan downgrade. Growth is checked
// against the effective plan when applying the mutation.
const trackList = z.array(libraryTrackSchema).min(1).max(planLimitsSchema.shape.librarySetTracks.maxValue!);
export const libraryMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save-pick"), track: libraryTrackSchema }),
  z.object({ type: z.literal("delete-pick"), id }),
  z.object({ type: z.literal("save-set"), id, name: setName, tracks: trackList }),
  z.object({ type: z.literal("rename-set"), id, name: setName }),
  z.object({ type: z.literal("delete-set"), id }),
  z.object({ type: z.literal("clear-library") })
]);
export const privateLibrarySchema = z.object({
  picks: z.array(z.object({ id, track: libraryTrackSchema, savedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(planLimitsSchema.shape.libraryPicks.maxValue!),
  sets: z.array(z.object({ id, name: setName, tracks: trackList, savedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(planLimitsSchema.shape.librarySets.maxValue!)
});
export type LibraryTrack = z.infer<typeof libraryTrackSchema>;
export type PrivateLibrary = z.infer<typeof privateLibrarySchema>;
export type LibraryMutation = z.infer<typeof libraryMutationSchema>;
export const emptyLibrary = (): PrivateLibrary => ({ picks: [], sets: [] });

/** Explicit field schemas remove room IDs, contributor data, mappings and tokens. */
export function changePrivateLibrary(current: PrivateLibrary, mutation: LibraryMutation, now = Date.now(), limits:Pick<PlanLimits,"libraryPicks"|"librarySets"|"librarySetTracks"> = DEFAULT_PLAN_LIMITS): PrivateLibrary {
  const library = structuredClone(current);
  switch (mutation.type) {
    case "save-pick": {
      const found = library.picks.find((pick) => pick.track.provider === mutation.track.provider && pick.track.providerId === mutation.track.providerId);
      if (found) found.track = mutation.track;
      else {
        if (library.picks.length >= limits.libraryPicks) throw new PublicRequestError(serverT("your_value1_saved_picks_are_full_delete_a_pick_before_saving_another", { value1: limits.libraryPicks }),429);
        library.picks.unshift({ id: randomUUID(), track: mutation.track, savedAt: now });
      }
      break;
    }
    case "delete-pick": library.picks = library.picks.filter((pick) => pick.id !== mutation.id); break;
    case "save-set": {
      const existing = library.sets.find((set) => set.id === mutation.id);
      const tracks = mutation.tracks.filter((track, index, all) => all.findIndex((item) => item.provider === track.provider && item.providerId === track.providerId) === index);
      if(tracks.length>limits.librarySetTracks&&tracks.length>(existing?.tracks.length??0))throw new PublicRequestError(serverT("sets_can_contain_up_to_value1_tracks", { value1: limits.librarySetTracks }),429);
      if (existing) { existing.name = mutation.name; existing.tracks = tracks; }
      else {
        if (library.sets.length >= limits.librarySets) throw new PublicRequestError(serverT("your_value1_saved_sets_are_full_delete_a_set_before_saving_another", { value1: limits.librarySets }),429);
        library.sets.unshift({ id: mutation.id, name: mutation.name, tracks, savedAt: now });
      }
      break;
    }
    case "rename-set": {
      const existing = library.sets.find((set) => set.id === mutation.id);
      if (!existing) throw new Error(serverT("that_set_was_deleted_refresh_your_picks_and_sets"));
      existing.name = mutation.name;
      break;
    }
    case "delete-set": library.sets = library.sets.filter((set) => set.id !== mutation.id); break;
    case "clear-library": return emptyLibrary();
  }
  return privateLibrarySchema.parse(library);
}
